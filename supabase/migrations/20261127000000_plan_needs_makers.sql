-- Plan check now covers contract-manufacturer batches too (team, 27 Nov): the team plans by looking
-- at stock in hand and then sends RM/PM, so a shortage must show while planning.
--  * In-house batch: needs come from the main store.
--  * Manufacturer batch (still planned): our seasonings (recipe lines linked to a stock item) and
--    packaging come from what is already at that manufacturer first, then from the main store.
--    Ingredients the manufacturer supplies are not linked to stock items, so they are never counted.
--  * Manufacturer batch already made (came back in bulk): packaging is filled here, from the main store.
-- Earlier batches are counted first. A batch is short when the main store can't cover everything
-- asked of it so far, and (for a manufacturer batch) what's at that manufacturer doesn't cover it either.
drop function if exists public.mat_plan_needs(date, date);

create function public.mat_plan_needs(p_from date, p_to date)
returns table (batch_id uuid, planned_date date, item_id uuid, need numeric, short boolean, place_id uuid)
language sql stable security definer set search_path = '' as $$
  with b as (
    select x.*,
      case when x.manufacturer_id is not null and x.stage = 'planned' then
        (select p.id from public.mat_places p where p.kind = 'maker' and p.manufacturer_id = x.manufacturer_id order by p.active desc, p.sort limit 1)
      end as pool
    from public.batches x
    where public.not_warehouse() and x.stage in ('planned', 'made') and x.planned_date between p_from and p_to
  ), raw as (
    select b.id, b.planned_date, b.created_at, b.pool, l.item_id,
      (b.units_planned * b.grammage_g / 1000.0) / r.output_kg * l.grams / case when i.unit = 'kg' then 1000.0 else 1 end as need
    from b join public.mat_recipes r on r.product_id = b.product_id and r.output_kg is not null
    join public.mat_recipe_lines l on l.product_id = b.product_id and l.item_id is not null
    join public.mat_items i on i.id = l.item_id and not i.count_only
    where b.stage = 'planned' and b.from_lot is null and b.units_planned > 0 and b.grammage_g > 0
  ), pack as (
    select b.id, b.planned_date, b.created_at, b.pool, pr.item_id,
      b.units_planned * pr.qty / case when i.unit = 'kg' and i.pouches_per_kg is not null then i.pouches_per_kg else 1 end as need
    from b join public.mat_pack_rules pr on pr.product_id = b.product_id and pr.grammage_g = b.grammage_g
    join public.mat_items i on i.id = pr.item_id and not i.count_only and (i.unit = 'pcs' or i.pouches_per_kg is not null)
    where b.units_planned > 0
  ), alln as (
    select id, planned_date, created_at, pool, item_id, sum(need) as need
    from (select * from raw union all select * from pack) u
    group by id, planned_date, created_at, pool, item_id
  ), ord as (
    select a.*,
      row_number() over (partition by a.item_id order by a.planned_date, a.created_at, a.id) as rn,
      coalesce(public.mat_qty(a.item_id, a.pool), 0) as pool_stock
    from alln a
  ), run as (
    select o.*,
      sum(o.need) over (partition by o.item_id, o.pool order by o.rn) as pool_upto,
      public.mat_qty(o.item_id, public.mat_main()) as main_stock,
      (select sum(greatest(0, s.upto - case when s.pool is null then 0 else s.stock end))
         from (select o2.pool, sum(o2.need) as upto, max(o2.pool_stock) as stock
               from ord o2 where o2.item_id = o.item_id and o2.rn <= o.rn group by o2.pool) s) as main_upto
    from ord o
  )
  select r.id, r.planned_date, r.item_id,
    case when public.has_recipe() or r.item_id not in (select l.item_id from public.mat_recipe_lines l where l.item_id is not null) then round(r.need, 3) end,
    r.main_upto > r.main_stock and (r.pool is null or r.pool_upto > r.pool_stock),
    r.pool
  from run r;
$$;

revoke all on function public.mat_plan_needs(date, date) from public, anon;
grant execute on function public.mat_plan_needs(date, date) to authenticated;
