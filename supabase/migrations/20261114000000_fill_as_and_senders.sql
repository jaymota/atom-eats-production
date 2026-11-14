-- 1. Bulk stock can be filled as a different product (e.g. Truffle Peanuts bulk kept under the
--    50 g pouch, filled into the 120 g jar). The new batch keeps the lot's batch number.
-- 2. A per-person "can send stock" switch, so a warehouse login (Dashrath) can send from Gala 17
--    under his own name. Nobody (except admins) can receive a transfer they sent themselves.

alter table public.people add column can_send boolean not null default false;
update public.people set can_send = true where username = 'dashrath';

create or replace function public.can_send_stock()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_team() or (public.me_ok() and coalesce((select can_send from public.people where id = auth.uid()), false));
$$;
revoke all on function public.can_send_stock() from public, anon;
grant execute on function public.can_send_stock() to authenticated;

-- Senders need to see what's at Gala 17.
drop policy fg_moves_read on public.fg_moves;
create policy fg_moves_read on public.fg_moves for select to authenticated using (public.not_warehouse() or public.can_send_stock());

-- send_transfer: allow senders (same body otherwise).
do $$
declare d text;
begin
  d := pg_get_functiondef('public.send_transfer(jsonb, integer, text)'::regprocedure);
  d := replace(d, 'if not public.is_team() then raise exception ''Only the factory team can send stock.''; end if;',
                  'if not public.can_send_stock() then raise exception ''Only the factory team can send stock.''; end if;');
  execute d;
end;
$$;

-- receive_transfer: the person who sent it can't also receive it (admins excepted).
do $$
declare d text;
begin
  d := pg_get_functiondef('public.receive_transfer(uuid, jsonb, integer, text)'::regprocedure);
  d := replace(d, 'if t.status <> ''sent'' then raise exception ''This transfer was already received.''; end if;',
                  'if t.status <> ''sent'' then raise exception ''This transfer was already received.''; end if;
  if t.sent_by = auth.uid() and not public.is_admin() then
    raise exception ''You sent this transfer, so someone else at Gala 6 has to receive it.'';
  end if;');
  execute d;
end;
$$;

-- take_for_filling: optional product to fill as.
drop function public.take_for_filling(uuid, numeric, date, numeric);
create function public.take_for_filling(p_lot uuid, p_kg numeric, p_date date, p_grams numeric default null, p_product uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  lot public.bulk_stock;
  pr public.products;
  g numeric;
  b public.batches;
begin
  if not public.can_plan() then raise exception 'Only the production team can plan from bulk stock.'; end if;
  select * into lot from public.bulk_stock where id = p_lot;
  if lot is null then raise exception 'Bulk lot not found.'; end if;
  if p_kg is null or p_kg <= 0 then raise exception 'Please enter the kg to take.'; end if;
  if p_kg > lot.kg_left + 0.0005 then raise exception 'Only % kg left in this lot.', lot.kg_left; end if;
  select * into pr from public.products where id = coalesce(p_product, lot.product_id);
  if pr is null then raise exception 'Product not found.'; end if;
  g := coalesce(p_grams, pr.grammage_g);
  insert into public.batches (batch_no, product_id, planned_date, units_planned, grammage_g, pack_type, notes, stage,
    made_kg, made_on, from_lot, manufacturer_id, created_by)
  values (lot.batch_no, pr.id, coalesce(p_date, public.today_ist()), case when g > 0 then round(p_kg * 1000 / g)::int end, g,
    case when g >= 500 and g is distinct from pr.grammage_g then 'bulk'
         when pr.name ilike '%jar%' then 'jar' when pr.name ilike '%party pack%' then 'party_pack' else 'pouch' end,
    'From bulk stock' || coalesce(' (' || lot.batch_no || ')', '') ||
      case when pr.id <> lot.product_id then ' of ' || (select name from public.products where id = lot.product_id) else '' end,
    'made', p_kg, public.today_ist(), lot.id, null, auth.uid())
  returning * into b;
  insert into public.bulk_moves (lot_id, kg, kind, batch_id, person_id) values (lot.id, -p_kg, 'take', b.id, auth.uid());
  insert into public.batch_events (batch_id, person_id, from_stage, to_stage, note) values (b.id, auth.uid(), null, 'made', p_kg || ' kg taken from bulk stock');
  perform public.log_batch(b, 'bulk_taken', 'took ' || p_kg || ' kg from bulk stock' || coalesce(' (' || lot.batch_no || ')', '') || ' to fill as ' || pr.name);
  return b.id;
end;
$$;
revoke all on function public.take_for_filling(uuid, numeric, date, numeric, uuid) from public, anon;
grant execute on function public.take_for_filling(uuid, numeric, date, numeric, uuid) to authenticated;
