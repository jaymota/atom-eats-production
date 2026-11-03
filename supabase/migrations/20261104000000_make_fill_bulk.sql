-- Two steps (Making done → Filling done), filling into several sizes, and Bulk stock by batch.
--
-- In-house:   Planned → Making done (kg made)      → Filling done (units, one line per size) = Done
-- Contract:   Planned → Received in bulk (kg)      → Filling done                          = Done
--             Planned → Received packed (units+kg) = Done            (move_to_inventory, as before)
-- A made / received-in-bulk batch can also be closed with "Keep in bulk": its kg becomes a lot
-- in Bulk stock. "Take for filling" moves kg out of a lot into a new batch waiting under "To fill".
-- At Filling done some kg can be put into Bulk stock; anything else left over counts as loss.

alter table public.batches drop constraint batches_stage_check;
alter table public.batches add constraint batches_stage_check
  check (stage in ('planned', 'made', 'manufacturing', 'filling', 'qc', 'done', 'moved', 'cancelled'));

alter table public.batches
  add column made_kg numeric check (made_kg is null or made_kg >= 0),
  add column made_on date,
  add column made_workers uuid[] not null default '{}',
  add column from_lot uuid,          -- filled from this bulk lot
  add column kept_in_bulk boolean not null default false;

-- Each output line can have its own pack size (one bulk filled into 30 g and 500 g).
alter table public.batch_outputs
  add column grammage_g numeric check (grammage_g is null or grammage_g > 0),
  add column pack_type text check (pack_type in ('pouch', 'jar', 'bulk', 'party_pack'));
update public.batch_outputs o set grammage_g = b.grammage_g, pack_type = b.pack_type from public.batches b where b.id = o.batch_id;

-- ---------- Bulk stock ----------

create table public.bulk_lots (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id),
  batch_id uuid references public.batches (id),
  batch_no text,
  made_on date not null,
  source text not null check (source in ('kept', 'received', 'put_aside', 'opening')),
  maker_id uuid references public.manufacturers (id),
  note text,
  created_by uuid references public.people (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.batches add constraint batches_from_lot_fkey foreign key (from_lot) references public.bulk_lots (id);

-- Every kg in or out of a lot. Plus = in, minus = out.
create table public.bulk_moves (
  id bigint generated always as identity primary key,
  lot_id uuid not null references public.bulk_lots (id),
  kg numeric not null check (kg <> 0),
  kind text not null check (kind in ('in', 'take', 'write_off', 'return')),
  batch_id uuid references public.batches (id),
  reason text,
  at timestamptz not null default now(),
  person_id uuid references public.people (id) on delete set null
);
create index on public.bulk_moves (lot_id);

alter table public.bulk_lots enable row level security;
alter table public.bulk_moves enable row level security;
create policy bulk_lots_read on public.bulk_lots for select to authenticated using (public.me_ok());
create policy bulk_moves_read on public.bulk_moves for select to authenticated using (public.me_ok());
revoke all on public.bulk_lots, public.bulk_moves from anon;
revoke insert, update, delete, truncate on public.bulk_lots, public.bulk_moves from authenticated;

-- What is in each lot right now.
create view public.bulk_stock with (security_invoker = true) as
  select l.*, coalesce((select sum(m.kg) from public.bulk_moves m where m.lot_id = l.id), 0) as kg_left,
    (select sum(m.kg) from public.bulk_moves m where m.lot_id = l.id and m.kind = 'in') as kg_in
  from public.bulk_lots l;
grant select on public.bulk_stock to authenticated;

create or replace function public.new_lot(b public.batches, p_kg numeric, p_date date, p_source text, p_note text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare id_ uuid;
begin
  insert into public.bulk_lots (product_id, batch_id, batch_no, made_on, source, maker_id, note, created_by)
  values (b.product_id, b.id, b.batch_no, p_date, p_source, b.manufacturer_id, nullif(trim(p_note), ''), auth.uid())
  returning id into id_;
  insert into public.bulk_moves (lot_id, kg, kind, batch_id, person_id) values (id_, p_kg, 'in', b.id, auth.uid());
  return id_;
end;
$$;
revoke all on function public.new_lot(public.batches, numeric, date, text, text) from public, anon, authenticated;

-- ---------- Step 1: Making done / Received in bulk ----------

create or replace function public.make_done(
  p_id uuid, p_kg numeric, p_date date, p_workers uuid[] default null, p_note text default null, p_keep boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.batches;
  verb text;
begin
  if not public.is_team() then raise exception 'Please log in again.'; end if;
  select * into b from public.batches where id = p_id for update;
  if b is null then raise exception 'Batch not found.'; end if;
  if b.stage <> 'planned' then raise exception 'This batch is not at Planned.'; end if;
  if p_kg is null or p_kg <= 0 then raise exception 'Please enter the kg.'; end if;
  if p_date is null or p_date > public.today_ist() then raise exception 'Please choose today or an earlier date.'; end if;
  verb := case when b.manufacturer_id is null then 'made' else 'received in bulk' end;
  update public.batches set stage = 'made', made_kg = p_kg, made_on = p_date,
    made_workers = case when b.manufacturer_id is null then public.clean_workers(p_workers) else '{}' end, updated_at = now()
  where id = b.id returning * into b;
  insert into public.batch_events (batch_id, person_id, from_stage, to_stage, note)
  values (b.id, auth.uid(), 'planned', 'made', p_kg || ' kg ' || verb || coalesce(': ' || nullif(trim(p_note), ''), ''));
  perform public.log_batch(b, 'batch_made', verb || ' ' || p_kg || ' kg of ' || public.batch_label(b));
  if p_keep then perform public.keep_in_bulk(b.id, p_note); end if;
end;
$$;

-- Closes a made / received-in-bulk batch and puts what's not filled yet into Bulk stock.
create or replace function public.keep_in_bulk(p_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.batches;
  used numeric;
  kg numeric;
begin
  if not public.is_team() then raise exception 'Please log in again.'; end if;
  select * into b from public.batches where id = p_id for update;
  if b is null then raise exception 'Batch not found.'; end if;
  if b.stage <> 'made' then raise exception 'Only a made batch can be kept in bulk.'; end if;
  select coalesce(sum(output_kg), 0) into used from public.batch_outputs where batch_id = b.id;
  kg := round(b.made_kg - used, 3);
  if kg <= 0 then raise exception 'Nothing left to keep in bulk.'; end if;
  perform public.new_lot(b, kg, b.made_on, case when b.manufacturer_id is null then 'kept' else 'received' end, p_note);
  update public.batches set stage = 'moved', kept_in_bulk = true, closed_at = now(), updated_at = now() where id = b.id;
  insert into public.batch_events (batch_id, person_id, from_stage, to_stage, note) values (b.id, auth.uid(), 'made', 'moved', kg || ' kg kept in bulk');
  perform public.log_batch(b, 'batch_kept_in_bulk', 'kept ' || kg || ' kg of ' || public.batch_label(b) || ' in bulk stock');
end;
$$;

-- ---------- Step 2: Filling done (several sizes) ----------

-- p_lines: [{"grams": 30, "units": 300, "pack": "pouch"}, {"grams": 500, "units": 2, "pack": "bulk"}]
create or replace function public.fill_done(
  p_id uuid, p_date date, p_lines jsonb, p_to_bulk_kg numeric default 0, p_workers uuid[] default null,
  p_note text default null, p_more boolean default false, p_input_kg numeric default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.batches;
  l jsonb;
  w uuid[];
  names text;
  total int := 0;
  g numeric;
  u int;
  pk text;
  n int := 0;
begin
  if not public.is_team() then raise exception 'Please log in again.'; end if;
  select * into b from public.batches where id = p_id for update;
  if b is null then raise exception 'Batch not found.'; end if;
  if b.stage not in ('planned', 'made', 'manufacturing', 'filling', 'qc', 'done') then raise exception 'This batch is already closed.'; end if;
  if p_date is null or p_date > public.today_ist() then raise exception 'Please choose today or an earlier date.'; end if;
  if coalesce(p_to_bulk_kg, 0) < 0 then raise exception 'Bulk kg can''t be negative.'; end if;
  w := case when p_workers is null then b.workers else public.clean_workers(p_workers) end;
  select string_agg(name, ', ' order by name) into names from public.workers where id = any(w);
  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    g := nullif((l ->> 'grams'), '')::numeric;
    u := nullif((l ->> 'units'), '')::int;
    pk := coalesce(nullif(l ->> 'pack', ''), case when g is distinct from b.grammage_g and g >= 500 then 'bulk' else b.pack_type end);
    if u is null or u <= 0 then continue; end if;
    if g is null or g <= 0 then raise exception 'Every line needs a pack size.'; end if;
    insert into public.batch_outputs (batch_id, made_on, units, output_kg, input_kg, packed_by, note, created_by, grammage_g, pack_type)
    values (b.id, p_date, u, round(u * g / 1000.0, 3), case when n = 0 then p_input_kg end, names, case when n = 0 then nullif(trim(p_note), '') end, auth.uid(), g, pk);
    total := total + u;
    n := n + 1;
  end loop;
  if n = 0 and coalesce(p_to_bulk_kg, 0) = 0 then raise exception 'Please enter the units filled.'; end if;
  update public.batches set workers = w, updated_at = now() where id = b.id;
  if coalesce(p_to_bulk_kg, 0) > 0 then
    perform public.new_lot(b, p_to_bulk_kg, p_date, 'put_aside', 'Put aside at filling');
  end if;
  if p_more then
    insert into public.batch_events (batch_id, person_id, from_stage, to_stage, note)
    values (b.id, auth.uid(), b.stage, b.stage, 'Part filled: ' || total || ' units, more to fill');
    perform public.log_batch(b, 'batch_part_moved', 'filled ' || total || ' units of ' || public.batch_label(b) || ' (more to fill)');
  else
    update public.batches set stage = 'moved', closed_at = now(), updated_at = now() where id = b.id;
    insert into public.batch_events (batch_id, person_id, from_stage, to_stage, note)
    values (b.id, auth.uid(), b.stage, 'moved', total || ' units filled' ||
      case when coalesce(p_to_bulk_kg, 0) > 0 then ', ' || p_to_bulk_kg || ' kg to bulk' else '' end);
    perform public.log_batch(b, 'batch_moved_to_inventory', 'filled ' || public.batch_label(b) || ': ' || total || ' units' ||
      case when coalesce(p_to_bulk_kg, 0) > 0 then ', ' || p_to_bulk_kg || ' kg to bulk stock' else '' end);
  end if;
end;
$$;

-- ---------- Bulk stock: take for filling, write off ----------

-- Takes kg from a lot into a new batch waiting under "To fill" on p_date.
create or replace function public.take_for_filling(p_lot uuid, p_kg numeric, p_date date, p_grams numeric default null)
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
  if not public.is_admin() then raise exception 'Only admins can plan from bulk stock.'; end if;
  select * into lot from public.bulk_stock where id = p_lot;
  if lot is null then raise exception 'Bulk lot not found.'; end if;
  if p_kg is null or p_kg <= 0 then raise exception 'Please enter the kg to take.'; end if;
  if p_kg > lot.kg_left + 0.0005 then raise exception 'Only % kg left in this lot.', lot.kg_left; end if;
  select * into pr from public.products where id = lot.product_id;
  g := coalesce(p_grams, pr.grammage_g);
  insert into public.batches (batch_no, product_id, planned_date, units_planned, grammage_g, pack_type, notes, stage,
    made_kg, made_on, from_lot, manufacturer_id, created_by)
  values (lot.batch_no, pr.id, coalesce(p_date, public.today_ist()), case when g > 0 then round(p_kg * 1000 / g)::int end, g,
    case when g >= 500 and g is distinct from pr.grammage_g then 'bulk' else 'pouch' end,
    'From bulk stock' || coalesce(' (' || lot.batch_no || ')', ''), 'made', p_kg, public.today_ist(), lot.id, null, auth.uid())
  returning * into b;
  insert into public.bulk_moves (lot_id, kg, kind, batch_id, person_id) values (lot.id, -p_kg, 'take', b.id, auth.uid());
  insert into public.batch_events (batch_id, person_id, from_stage, to_stage, note) values (b.id, auth.uid(), null, 'made', p_kg || ' kg taken from bulk stock');
  perform public.log_batch(b, 'bulk_taken', 'took ' || p_kg || ' kg of ' || public.batch_label(b) || ' from bulk stock for filling');
  return b.id;
end;
$$;

create or replace function public.write_off_bulk(p_lot uuid, p_kg numeric, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare lot public.bulk_stock;
begin
  if not public.is_admin() then raise exception 'Only admins can write off bulk stock.'; end if;
  if nullif(trim(p_reason), '') is null then raise exception 'Please give a reason.'; end if;
  select * into lot from public.bulk_stock where id = p_lot;
  if lot is null then raise exception 'Bulk lot not found.'; end if;
  if p_kg is null or p_kg <= 0 then raise exception 'Please enter the kg.'; end if;
  if p_kg > lot.kg_left + 0.0005 then raise exception 'Only % kg left in this lot.', lot.kg_left; end if;
  insert into public.bulk_moves (lot_id, kg, kind, reason, person_id) values (lot.id, -p_kg, 'write_off', trim(p_reason), auth.uid());
  insert into public.activity (person_id, kind, entity_type, entity_id, summary)
  values (auth.uid(), 'bulk_written_off', 'bulk_lot', lot.id::text,
    coalesce((select name from public.people where id = auth.uid()), 'Set-up') || ' wrote off ' || p_kg || ' kg of ' ||
    (select name from public.products where id = lot.product_id) || coalesce(' (' || lot.batch_no || ')', '') || ' from bulk stock: ' || trim(p_reason));
end;
$$;

-- Reopen: a batch that was kept in bulk gets its lot removed again (only if none of it was used yet).
create or replace function public.reopen_batch(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.batches;
  lot_ids uuid[];
  back text;
begin
  if not public.is_admin() then raise exception 'Only admins can reopen batches.'; end if;
  if nullif(trim(p_reason), '') is null then raise exception 'Please give a reason.'; end if;
  select * into b from public.batches where id = p_id for update;
  if b is null then raise exception 'Batch not found.'; end if;
  if b.stage not in ('moved', 'cancelled') then raise exception 'This batch is not closed.'; end if;
  select coalesce(array_agg(id), '{}') into lot_ids from public.bulk_lots where batch_id = b.id;
  if exists (select 1 from public.bulk_moves where lot_id = any(lot_ids) and kind <> 'in') then
    raise exception 'Some of its bulk stock has already been used. Write it off or fill it instead.';
  end if;
  delete from public.bulk_moves where lot_id = any(lot_ids);
  delete from public.bulk_lots where id = any(lot_ids);
  back := case when b.stage = 'cancelled' then 'planned' when b.made_kg is not null then 'made' else 'planned' end;
  update public.batches set stage = back, closed_at = null, cancel_reason = null, kept_in_bulk = false, updated_at = now() where id = b.id;
  insert into public.batch_events (batch_id, person_id, from_stage, to_stage, note) values (b.id, auth.uid(), b.stage, back, trim(p_reason));
  perform public.log_batch(b, 'batch_reopened', 'reopened ' || public.batch_label(b) || ': ' || trim(p_reason));
end;
$$;

-- Received packed (contract) / old Complete: also store the pack size on the output line.
create or replace function public.stamp_output_size()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.grammage_g is null or new.pack_type is null then
    select coalesce(new.grammage_g, grammage_g), coalesce(new.pack_type, pack_type) into new.grammage_g, new.pack_type
    from public.batches where id = new.batch_id;
  end if;
  return new;
end;
$$;
create trigger batch_outputs_size before insert on public.batch_outputs for each row execute function public.stamp_output_size();

revoke all on function public.make_done(uuid, numeric, date, uuid[], text, boolean), public.keep_in_bulk(uuid, text),
  public.fill_done(uuid, date, jsonb, numeric, uuid[], text, boolean, numeric), public.take_for_filling(uuid, numeric, date, numeric),
  public.write_off_bulk(uuid, numeric, text) from public, anon;
grant execute on function public.make_done(uuid, numeric, date, uuid[], text, boolean), public.keep_in_bulk(uuid, text),
  public.fill_done(uuid, date, jsonb, numeric, uuid[], text, boolean, numeric), public.take_for_filling(uuid, numeric, date, numeric),
  public.write_off_bulk(uuid, numeric, text) to authenticated;
