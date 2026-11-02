-- Two stages only (Planned → Done) and contract manufacturers.
--
-- * "Complete" (move_to_inventory) can now be pressed straight from Planned, and records who
--   made it. "More to make later" keeps the batch open (Planned).
-- * A batch can be made in-house (manufacturer empty) or at a contract manufacturer. Those
--   are closed with "Stock received" (same function); until then they show as "Awaiting stock".

create table public.manufacturers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 80),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index manufacturers_name_unique on public.manufacturers (lower(trim(name)));
alter table public.manufacturers enable row level security;
create policy manufacturers_read on public.manufacturers for select to authenticated using (public.me_ok());
create policy manufacturers_add on public.manufacturers for insert to authenticated with check (public.is_admin());
create policy manufacturers_change on public.manufacturers for update to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.manufacturers from anon;
revoke delete, truncate on public.manufacturers from authenticated;

insert into public.manufacturers (name) values
  ('A1 Wafers & Namkeen'), ('Mota''s Chips'), ('Blueberry Foods'), ('Mom''s Homemade');

alter table public.batches add column manufacturer_id uuid references public.manufacturers (id);

-- "Strawberry Pretzels (PDSWSP57) at Mom's Homemade"
create or replace function public.batch_label(b public.batches)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select (select name from public.products where id = b.product_id) || coalesce(' (' || b.batch_no || ')', '')
    || coalesce(' at ' || (select name from public.manufacturers where id = b.manufacturer_id), '');
$$;

-- ---------- Planning: now with "made at" ----------

drop function public.copy_week(date, date);
drop function public.plan_batch(uuid, date, int, numeric, text, text, text);
drop function public.edit_batch(uuid, date, int, numeric, text, text, text);
drop function public.move_to_inventory(uuid, date, int, numeric, numeric, boolean, text);

create function public.plan_batch(
  p_product uuid, p_date date, p_units int, p_grammage numeric default null,
  p_pack text default null, p_notes text default null, p_batch_no text default null, p_maker uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  pr public.products;
  b public.batches;
  bn text := nullif(upper(trim(p_batch_no)), '');
begin
  if not public.is_admin() then raise exception 'Only admins can plan batches.'; end if;
  select * into pr from public.products where id = p_product;
  if pr is null then raise exception 'Product not found.'; end if;
  if p_date is null then raise exception 'Please choose a date.'; end if;
  if coalesce(p_units, 0) <= 0 then raise exception 'Please enter how many units.'; end if;
  if p_maker is not null and not exists (select 1 from public.manufacturers where id = p_maker) then
    raise exception 'Manufacturer not found.';
  end if;
  if bn is not null and exists (select 1 from public.batches where upper(batch_no) = bn) then
    raise exception 'Batch number % is already used.', bn;
  end if;
  insert into public.batches (batch_no, product_id, planned_date, units_planned, grammage_g, pack_type, notes, manufacturer_id, created_by)
  values (coalesce(bn, public.take_batch_no(pr.id)), pr.id, p_date, p_units, coalesce(p_grammage, pr.grammage_g),
    coalesce(p_pack, case when pr.name ilike '%party pack%' then 'party_pack' when pr.name ilike '%jar%' then 'jar'
                          when pr.name ilike 'bulk%' then 'bulk' else 'pouch' end),
    nullif(trim(p_notes), ''), p_maker, auth.uid())
  returning * into b;
  insert into public.batch_events (batch_id, person_id, to_stage) values (b.id, auth.uid(), 'planned');
  perform public.log_batch(b, 'batch_planned', 'planned ' || p_units || ' × ' || public.batch_label(b) || ' for ' || to_char(p_date, 'DD Mon'));
  return b.id;
end;
$$;

create function public.edit_batch(
  p_id uuid, p_date date, p_units int, p_grammage numeric, p_pack text, p_notes text, p_batch_no text, p_maker uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.batches;
  bn text := nullif(upper(trim(p_batch_no)), '');
  said text[] := '{}';
begin
  if not public.is_admin() then raise exception 'Only admins can change the plan.'; end if;
  select * into b from public.batches where id = p_id for update;
  if b is null then raise exception 'Batch not found.'; end if;
  if b.stage in ('moved', 'cancelled') then raise exception 'This batch is closed. Reopen it first.'; end if;
  if coalesce(p_units, 0) <= 0 then raise exception 'Please enter how many units.'; end if;
  if bn is distinct from b.batch_no and bn is not null
     and exists (select 1 from public.batches where upper(batch_no) = bn and id <> b.id) then
    raise exception 'Batch number % is already used.', bn;
  end if;
  if p_date is distinct from b.planned_date then said := said || ('date → ' || coalesce(to_char(p_date, 'DD Mon'), 'none')); end if;
  if p_units is distinct from b.units_planned then said := said || ('units → ' || p_units); end if;
  if p_grammage is distinct from b.grammage_g then said := said || ('size → ' || coalesce(p_grammage::text || ' g', 'none')); end if;
  if p_pack is distinct from b.pack_type then said := said || ('pack → ' || replace(p_pack, '_', ' ')); end if;
  if bn is distinct from b.batch_no then said := said || ('batch no. → ' || coalesce(bn, 'none')); end if;
  if p_maker is distinct from b.manufacturer_id then
    said := said || ('made at → ' || coalesce((select name from public.manufacturers where id = p_maker), 'in-house'));
  end if;
  if nullif(trim(p_notes), '') is distinct from b.notes then said := said || 'notes'::text; end if;
  if cardinality(said) = 0 then return; end if;
  update public.batches set planned_date = p_date, units_planned = p_units, grammage_g = p_grammage, pack_type = p_pack,
    notes = nullif(trim(p_notes), ''), batch_no = bn, manufacturer_id = p_maker, updated_at = now()
  where id = b.id returning * into b;
  perform public.log_batch(b, 'batch_changed', 'changed ' || public.batch_label(b) || ': ' || array_to_string(said, ', '));
end;
$$;

create function public.copy_week(p_from date, p_to date)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  n int := 0;
  shift int := p_to - p_from;
begin
  if not public.is_admin() then raise exception 'Only admins can plan batches.'; end if;
  for r in
    select b.* from public.batches b
    where b.planned_date between p_from and p_from + 6 and b.stage <> 'cancelled' and not b.imported
    order by b.planned_date, b.created_at
  loop
    perform public.plan_batch(r.product_id, r.planned_date + shift, r.units_planned, r.grammage_g, r.pack_type, r.notes, null, r.manufacturer_id);
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- ---------- Complete / Stock received ----------

create function public.move_to_inventory(
  p_id uuid, p_date date, p_units int, p_output_kg numeric, p_input_kg numeric,
  p_more boolean default false, p_note text default null, p_workers uuid[] default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.batches;
  w uuid[];
  names text;
  verb text;
begin
  if not public.is_team() then raise exception 'Please log in again.'; end if;
  select * into b from public.batches where id = p_id for update;
  if b is null then raise exception 'Batch not found.'; end if;
  if b.stage in ('moved', 'cancelled') then raise exception 'This batch is already closed.'; end if;
  if p_units is null or p_units < 0 then raise exception 'Please enter the units.'; end if;
  if p_date is null or p_date > public.today_ist() then raise exception 'Please choose today or an earlier date.'; end if;
  w := case when p_workers is null then b.workers else public.clean_workers(p_workers) end;
  select string_agg(name, ', ' order by name) into names from public.workers where id = any(w);
  verb := case when b.manufacturer_id is null then 'completed' else 'received stock for' end;
  update public.batches set workers = w, updated_at = now() where id = b.id;
  insert into public.batch_outputs (batch_id, made_on, units, output_kg, input_kg, packed_by, note, created_by)
  values (b.id, p_date, p_units,
    coalesce(p_output_kg, round(p_units * b.grammage_g / 1000.0, 3)), p_input_kg, names, nullif(trim(p_note), ''), auth.uid());
  if p_more then
    insert into public.batch_events (batch_id, person_id, from_stage, to_stage, note)
    values (b.id, auth.uid(), b.stage, b.stage, 'Part done: ' || p_units || ' units, more to come');
    perform public.log_batch(b, 'batch_part_moved', verb || ' ' || p_units || ' units of ' || public.batch_label(b) || ' (more to come)');
  else
    update public.batches set stage = 'moved', closed_at = now(), updated_at = now() where id = b.id;
    insert into public.batch_events (batch_id, person_id, from_stage, to_stage, note)
    values (b.id, auth.uid(), b.stage, 'moved', p_units || ' units');
    perform public.log_batch(b, 'batch_moved_to_inventory', verb || ' ' || public.batch_label(b) || ': ' || p_units || ' units');
  end if;
end;
$$;

-- Reopening a finished batch now goes back to Planned (there are no in-between stages any more).
create or replace function public.reopen_batch(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare b public.batches;
begin
  if not public.is_admin() then raise exception 'Only admins can reopen batches.'; end if;
  if nullif(trim(p_reason), '') is null then raise exception 'Please give a reason.'; end if;
  select * into b from public.batches where id = p_id for update;
  if b is null then raise exception 'Batch not found.'; end if;
  if b.stage not in ('moved', 'cancelled') then raise exception 'This batch is not closed.'; end if;
  update public.batches set stage = 'planned', closed_at = null, cancel_reason = null, updated_at = now() where id = b.id;
  insert into public.batch_events (batch_id, person_id, from_stage, to_stage, note) values (b.id, auth.uid(), b.stage, 'planned', trim(p_reason));
  perform public.log_batch(b, 'batch_reopened', 'reopened ' || public.batch_label(b) || ': ' || trim(p_reason));
end;
$$;

-- Open batches stuck in the old in-between stages go back to Planned.
update public.batches set stage = 'planned' where stage in ('manufacturing', 'filling', 'qc', 'done');

revoke all on function public.plan_batch(uuid, date, int, numeric, text, text, text, uuid), public.edit_batch(uuid, date, int, numeric, text, text, text, uuid),
  public.copy_week(date, date), public.move_to_inventory(uuid, date, int, numeric, numeric, boolean, text, uuid[]) from public, anon;
grant execute on function public.plan_batch(uuid, date, int, numeric, text, text, text, uuid), public.edit_batch(uuid, date, int, numeric, text, text, text, uuid),
  public.copy_week(date, date), public.move_to_inventory(uuid, date, int, numeric, numeric, boolean, text, uuid[]) to authenticated;
