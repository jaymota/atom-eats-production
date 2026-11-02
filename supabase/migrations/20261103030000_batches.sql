-- Phase 3: the production plan, batches, floor stages and "Move to inventory".
--
-- A batch is one product, planned for a day. Jeet moves it through the stages. At the end,
-- "Move to inventory" records what was packed (units, kg) on a date. A batch packed over
-- several days gets one output line per day ("More to pack later"). Output lines are the
-- production history the reports are built from, and are never thrown away.
--
-- All changes go through the functions below (they check the person's role and log the change).
-- Browsers can only read.

create table public.batches (
  id uuid primary key default gen_random_uuid(),
  batch_no text check (batch_no is null or length(trim(batch_no)) between 1 and 40),
  product_id uuid not null references public.products (id),
  planned_date date,
  units_planned int check (units_planned is null or units_planned >= 0),
  grammage_g numeric check (grammage_g is null or grammage_g > 0),
  pack_type text not null default 'pouch' check (pack_type in ('pouch', 'jar', 'bulk', 'party_pack')),
  notes text,
  stage text not null default 'planned'
    check (stage in ('planned', 'manufacturing', 'filling', 'qc', 'done', 'moved', 'cancelled')),
  workers uuid[] not null default '{}',
  cancel_reason text,
  imported boolean not null default false,
  created_by uuid references public.people (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);
create unique index batches_batch_no_unique on public.batches (upper(batch_no)) where batch_no is not null;
create index on public.batches (planned_date);
create index on public.batches (stage);
create index on public.batches (product_id);

-- What was packed and moved to inventory, per day.
create table public.batch_outputs (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.batches (id),
  made_on date not null,
  units int not null check (units >= 0),
  output_kg numeric check (output_kg is null or output_kg >= 0),
  input_kg numeric check (input_kg is null or input_kg >= 0),
  packed_by text,       -- names, as recorded (workers, or text from the October sheet)
  note text,
  created_by uuid references public.people (id) on delete set null,
  created_at timestamptz not null default now()
);
create index on public.batch_outputs (made_on);
create index on public.batch_outputs (batch_id);

-- Every stage move: who, when, from, to. Used for "how long each stage takes".
create table public.batch_events (
  id bigint generated always as identity primary key,
  batch_id uuid not null references public.batches (id),
  at timestamptz not null default now(),
  person_id uuid references public.people (id) on delete set null,
  from_stage text,
  to_stage text,
  note text
);
create index on public.batch_events (batch_id, at);

alter table public.batches enable row level security;
alter table public.batch_outputs enable row level security;
alter table public.batch_events enable row level security;
create policy batches_read on public.batches for select to authenticated using (public.me_ok());
create policy batch_outputs_read on public.batch_outputs for select to authenticated using (public.me_ok());
create policy batch_events_read on public.batch_events for select to authenticated using (public.me_ok());
revoke all on public.batches, public.batch_outputs, public.batch_events from anon;
revoke insert, update, delete, truncate on public.batches, public.batch_outputs, public.batch_events from authenticated;

-- ---------- Helpers ----------

create or replace function public.is_team()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.my_role() in ('super_admin', 'admin', 'floor'), false);
$$;

create or replace function public.today_ist()
returns date
language sql
stable
as $$
  select (now() at time zone 'Asia/Kolkata')::date;
$$;

create or replace function public.stage_name(s text)
returns text
language sql
immutable
as $$
  select case s
    when 'planned' then 'Planned' when 'manufacturing' then 'Manufacturing' when 'filling' then 'Filling'
    when 'qc' then 'QC' when 'done' then 'Done' when 'moved' then 'Moved to inventory' when 'cancelled' then 'Cancelled'
    else s end;
$$;

-- "Strawberry Pretzels (PDSWSP57)"
create or replace function public.batch_label(b public.batches)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select (select name from public.products where id = b.product_id) || coalesce(' (' || b.batch_no || ')', '');
$$;

create or replace function public.log_batch(b public.batches, kind text, summary text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.activity (person_id, kind, entity_type, entity_id, summary)
  values (auth.uid(), kind, 'batch', b.id::text,
    coalesce((select name from public.people where id = auth.uid()), 'Set-up') || ' ' || summary);
$$;

-- Hands out the product's next batch number and moves its counter on.
create or replace function public.take_batch_no(p_product uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare r record;
begin
  update public.products set next_batch_no = next_batch_no + 1
  where id = p_product and batch_prefix is not null
  returning batch_prefix, next_batch_no - 1 as n into r;
  if r is null then return null; end if;
  -- Skip numbers already used (e.g. typed by hand).
  while exists (select 1 from public.batches where upper(batch_no) = upper(r.batch_prefix || r.n)) loop
    update public.products set next_batch_no = next_batch_no + 1 where id = p_product returning next_batch_no - 1 into r.n;
  end loop;
  return r.batch_prefix || r.n;
end;
$$;

create or replace function public.clean_workers(p uuid[])
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct w.id), '{}') from public.workers w where w.id = any(coalesce(p, '{}'));
$$;

-- ---------- Planning (admins) ----------

create or replace function public.plan_batch(
  p_product uuid, p_date date, p_units int, p_grammage numeric default null,
  p_pack text default null, p_notes text default null, p_batch_no text default null)
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
  if bn is not null and exists (select 1 from public.batches where upper(batch_no) = bn) then
    raise exception 'Batch number % is already used.', bn;
  end if;
  insert into public.batches (batch_no, product_id, planned_date, units_planned, grammage_g, pack_type, notes, created_by)
  values (coalesce(bn, public.take_batch_no(pr.id)), pr.id, p_date, p_units, coalesce(p_grammage, pr.grammage_g),
    coalesce(p_pack, case when pr.name ilike '%party pack%' then 'party_pack' when pr.name ilike '%jar%' then 'jar'
                          when pr.name ilike 'bulk%' then 'bulk' else 'pouch' end),
    nullif(trim(p_notes), ''), auth.uid())
  returning * into b;
  insert into public.batch_events (batch_id, person_id, to_stage) values (b.id, auth.uid(), 'planned');
  perform public.log_batch(b, 'batch_planned', 'planned ' || p_units || ' × ' || public.batch_label(b) || ' for ' || to_char(p_date, 'DD Mon'));
  return b.id;
end;
$$;

create or replace function public.edit_batch(
  p_id uuid, p_date date, p_units int, p_grammage numeric, p_pack text, p_notes text, p_batch_no text)
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
  if nullif(trim(p_notes), '') is distinct from b.notes then said := said || 'notes'::text; end if;
  if cardinality(said) = 0 then return; end if;
  update public.batches set planned_date = p_date, units_planned = p_units, grammage_g = p_grammage, pack_type = p_pack,
    notes = nullif(trim(p_notes), ''), batch_no = bn, updated_at = now()
  where id = b.id returning * into b;
  perform public.log_batch(b, 'batch_changed', 'changed ' || public.batch_label(b) || ': ' || array_to_string(said, ', '));
end;
$$;

create or replace function public.cancel_batch(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare b public.batches;
begin
  if not public.is_admin() then raise exception 'Only admins can cancel batches.'; end if;
  if nullif(trim(p_reason), '') is null then raise exception 'Please give a reason.'; end if;
  select * into b from public.batches where id = p_id for update;
  if b is null then raise exception 'Batch not found.'; end if;
  if b.stage in ('moved', 'cancelled') then raise exception 'This batch is already closed.'; end if;
  update public.batches set stage = 'cancelled', cancel_reason = trim(p_reason), closed_at = now(), updated_at = now()
  where id = b.id;
  insert into public.batch_events (batch_id, person_id, from_stage, to_stage, note) values (b.id, auth.uid(), b.stage, 'cancelled', trim(p_reason));
  perform public.log_batch(b, 'batch_cancelled', 'cancelled ' || public.batch_label(b) || ': ' || trim(p_reason));
end;
$$;

-- Copies one week's batches (not cancelled) to another week, same weekday, with new batch numbers.
create or replace function public.copy_week(p_from date, p_to date)
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
    select b.* from public.batches b join public.products p on p.id = b.product_id
    where b.planned_date between p_from and p_from + 6 and b.stage <> 'cancelled' and not b.imported
    order by b.planned_date, b.created_at
  loop
    perform public.plan_batch(r.product_id, r.planned_date + shift, r.units_planned, r.grammage_g, r.pack_type, r.notes, null);
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- ---------- The floor (Jeet and admins) ----------

create or replace function public.assign_batch(p_id uuid, p_workers uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.batches;
  w uuid[] := public.clean_workers(p_workers);
  names text;
begin
  if not public.is_team() then raise exception 'Please log in again.'; end if;
  select * into b from public.batches where id = p_id for update;
  if b is null then raise exception 'Batch not found.'; end if;
  if b.stage in ('moved', 'cancelled') then raise exception 'This batch is closed.'; end if;
  if w = b.workers then return; end if;
  update public.batches set workers = w, updated_at = now() where id = b.id returning * into b;
  select string_agg(name, ', ' order by name) into names from public.workers where id = any(w);
  perform public.log_batch(b, 'batch_assigned', 'assigned ' || public.batch_label(b) || ' to ' || coalesce(names, 'nobody'));
end;
$$;

-- One step forward or back (a QC fail sends the batch back with a reason).
create or replace function public.move_batch(p_id uuid, p_to text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.batches;
  order_ text[] := array['planned', 'manufacturing', 'filling', 'qc', 'done'];
  i int;
  j int;
begin
  if not public.is_team() then raise exception 'Please log in again.'; end if;
  select * into b from public.batches where id = p_id for update;
  if b is null then raise exception 'Batch not found.'; end if;
  i := array_position(order_, b.stage);
  j := array_position(order_, p_to);
  if i is null then raise exception 'This batch is closed.'; end if;
  if j is null then raise exception 'Unknown stage.'; end if;
  -- Forward one step (Planned may skip Manufacturing, e.g. filling from bulk already made);
  -- back any number of steps, with a reason.
  if not (j = i + 1 or (b.stage = 'planned' and p_to = 'filling') or j < i) then
    raise exception 'Please move one stage at a time.';
  end if;
  if j < i and nullif(trim(p_note), '') is null then raise exception 'Please give a reason for moving back.'; end if;
  update public.batches set stage = p_to, updated_at = now() where id = b.id;
  insert into public.batch_events (batch_id, person_id, from_stage, to_stage, note)
  values (b.id, auth.uid(), b.stage, p_to, nullif(trim(p_note), ''));
  perform public.log_batch(b, 'batch_moved',
    case when b.stage = 'qc' and j < i then 'failed QC for ' || public.batch_label(b) || ' → back to ' || public.stage_name(p_to)
         when j < i then 'moved ' || public.batch_label(b) || ' back to ' || public.stage_name(p_to)
         when b.stage = 'qc' then 'passed QC for ' || public.batch_label(b)
         else 'moved ' || public.batch_label(b) || ' to ' || public.stage_name(p_to) end
    || coalesce(': ' || nullif(trim(p_note), ''), ''));
end;
$$;

-- Records what was packed. p_more = true: more to pack later, the batch goes back to Filling.
create or replace function public.move_to_inventory(
  p_id uuid, p_date date, p_units int, p_output_kg numeric, p_input_kg numeric,
  p_more boolean default false, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.batches;
  names text;
begin
  if not public.is_team() then raise exception 'Please log in again.'; end if;
  select * into b from public.batches where id = p_id for update;
  if b is null then raise exception 'Batch not found.'; end if;
  if b.stage not in ('filling', 'qc', 'done') then raise exception 'Move to inventory comes after Filling.'; end if;
  if p_units is null or p_units < 0 then raise exception 'Please enter the units packed.'; end if;
  if p_date is null or p_date > public.today_ist() then raise exception 'Please choose today or an earlier date.'; end if;
  select string_agg(name, ', ' order by name) into names from public.workers where id = any(b.workers);
  insert into public.batch_outputs (batch_id, made_on, units, output_kg, input_kg, packed_by, note, created_by)
  values (b.id, p_date, p_units,
    coalesce(p_output_kg, round(p_units * b.grammage_g / 1000.0, 3)), p_input_kg, names, nullif(trim(p_note), ''), auth.uid());
  if p_more then
    update public.batches set stage = 'filling', updated_at = now() where id = b.id;
    insert into public.batch_events (batch_id, person_id, from_stage, to_stage, note)
    values (b.id, auth.uid(), b.stage, 'filling', 'Part moved to inventory: ' || p_units || ' units, more to pack');
    perform public.log_batch(b, 'batch_part_moved', 'moved ' || p_units || ' units of ' || public.batch_label(b) || ' to inventory (more to pack)');
  else
    update public.batches set stage = 'moved', closed_at = now(), updated_at = now() where id = b.id;
    insert into public.batch_events (batch_id, person_id, from_stage, to_stage, note)
    values (b.id, auth.uid(), b.stage, 'moved', p_units || ' units');
    perform public.log_batch(b, 'batch_moved_to_inventory', 'moved ' || public.batch_label(b) || ' to inventory: ' || p_units || ' units');
  end if;
end;
$$;

-- Admins only: reopens a closed batch (back to Done, or Planned if it was cancelled).
create or replace function public.reopen_batch(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.batches;
  back text;
begin
  if not public.is_admin() then raise exception 'Only admins can reopen batches.'; end if;
  if nullif(trim(p_reason), '') is null then raise exception 'Please give a reason.'; end if;
  select * into b from public.batches where id = p_id for update;
  if b is null then raise exception 'Batch not found.'; end if;
  if b.stage not in ('moved', 'cancelled') then raise exception 'This batch is not closed.'; end if;
  back := case when b.stage = 'moved' then 'done' else 'planned' end;
  update public.batches set stage = back, closed_at = null, cancel_reason = null, updated_at = now() where id = b.id;
  insert into public.batch_events (batch_id, person_id, from_stage, to_stage, note) values (b.id, auth.uid(), b.stage, back, trim(p_reason));
  perform public.log_batch(b, 'batch_reopened', 'reopened ' || public.batch_label(b) || ': ' || trim(p_reason));
end;
$$;

-- Admins only: removes a wrong output line (e.g. a typo in units). Logged with the old numbers.
create or replace function public.remove_output(p_output uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.batch_outputs;
  b public.batches;
begin
  if not public.is_admin() then raise exception 'Only admins can correct outputs.'; end if;
  if nullif(trim(p_reason), '') is null then raise exception 'Please give a reason.'; end if;
  select * into o from public.batch_outputs where id = p_output;
  if o is null then raise exception 'Not found.'; end if;
  select * into b from public.batches where id = o.batch_id;
  delete from public.batch_outputs where id = o.id;
  perform public.log_batch(b, 'output_removed', 'removed an output line from ' || public.batch_label(b) || ' (' || o.units ||
    ' units on ' || to_char(o.made_on, 'DD Mon') || '): ' || trim(p_reason));
end;
$$;

revoke all on function public.plan_batch(uuid, date, int, numeric, text, text, text), public.edit_batch(uuid, date, int, numeric, text, text, text),
  public.cancel_batch(uuid, text), public.copy_week(date, date), public.assign_batch(uuid, uuid[]), public.move_batch(uuid, text, text),
  public.move_to_inventory(uuid, date, int, numeric, numeric, boolean, text), public.reopen_batch(uuid, text), public.remove_output(uuid, text),
  public.take_batch_no(uuid), public.log_batch(public.batches, text, text), public.clean_workers(uuid[]), public.batch_label(public.batches),
  public.is_team() from public, anon;
grant execute on function public.plan_batch(uuid, date, int, numeric, text, text, text), public.edit_batch(uuid, date, int, numeric, text, text, text),
  public.cancel_batch(uuid, text), public.copy_week(date, date), public.assign_batch(uuid, uuid[]), public.move_batch(uuid, text, text),
  public.move_to_inventory(uuid, date, int, numeric, numeric, boolean, text), public.reopen_batch(uuid, text), public.remove_output(uuid, text),
  public.is_team() to authenticated;
revoke all on function public.take_batch_no(uuid), public.log_batch(public.batches, text, text), public.clean_workers(uuid[]),
  public.batch_label(public.batches) from authenticated;
