-- Expiry on the pack is the manufacturing date + shelf life, minus one day
-- (e.g. 6 months from 23.10.2026 = 22.04.2027), matching what the team prints.
create or replace view public.fg_stock with (security_invoker = true) as
  select m.location, m.product_id, m.grammage_g, m.batch_id, m.batch_no, m.made_on,
    sum(m.units)::int as units,
    case when p.shelf_life_months is not null then (m.made_on + make_interval(months => p.shelf_life_months) - interval '1 day')::date end as expires_on
  from public.fg_moves m join public.products p on p.id = m.product_id
  group by m.location, m.product_id, m.grammage_g, m.batch_id, m.batch_no, m.made_on, p.shelf_life_months
  having sum(m.units) <> 0;
grant select on public.fg_stock to authenticated;
