-- Materials (Stage 2): raw material (RM) and packaging material (PM) stock, kept separate from
-- finished goods. Places (main store Gala 17, Gala 6, Gala 120, each contract manufacturer),
-- receipts, sends between places, automatic usage (recipe at Making done, packaging at Filling
-- done), closing stock at a manufacturer, counts (difference = loss), recipes (recipe access only).
-- Browsers only read; every change goes through the functions below, which check the role.
-- No business data here: the master list and opening stock are loaded separately.

-- Usage is counted for production from this day (opening stock comes from the Excel sheets).
create or replace function public.mat_start() returns date language sql immutable as $$ select date '2026-11-26' $$;

create or replace function public.has_recipe() returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.not_warehouse() and (select recipe_access from public.people where id = auth.uid()), false);
$$;

-- ---------- tables ----------
create table public.mat_places (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  kind text not null check (kind in ('store', 'maker')),
  manufacturer_id uuid unique references public.manufacturers(id) on delete set null,
  is_main boolean not null default false,
  sort int not null default 50,
  active boolean not null default true
);
insert into public.mat_places (name, kind, is_main, sort) values ('Gala 17', 'store', true, 1), ('Gala 6', 'store', false, 2), ('Gala 120', 'store', false, 3);
insert into public.mat_places (name, kind, manufacturer_id, sort) select name, 'maker', id, 10 from public.manufacturers;

create or replace function public.mat_place_for_maker() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.mat_places (name, kind, manufacturer_id, sort, active) values (new.name, 'maker', new.id, 10, new.active)
  on conflict (manufacturer_id) do update set name = excluded.name, active = excluded.active;
  return new;
end $$;
create trigger mat_place_for_maker after insert or update of name, active on public.manufacturers
  for each row execute function public.mat_place_for_maker();

create table public.mat_items (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('RM', 'PM')),
  grp text,
  name text not null,
  code text,
  supplier text,
  unit text not null default 'pcs' check (unit in ('kg', 'pcs')),
  box_size numeric check (box_size > 0),          -- e.g. a pretzel box = 6.5 kg
  pouches_per_kg numeric check (pouches_per_kg > 0), -- roll-form pouches
  last_rate numeric,
  low_level numeric,
  count_only boolean not null default false,       -- counted and received, never used automatically
  active boolean not null default true,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index mat_items_name on public.mat_items (lower(name)) where active;

create table public.mat_receipts (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.mat_items(id),
  place_id uuid not null references public.mat_places(id),
  qty numeric not null,
  boxes numeric,
  supplier text,
  rate numeric,
  gst_pct numeric,
  received_on date not null,
  expiry date,
  bill_no text,
  note text,
  person_id uuid references public.people(id),
  created_at timestamptz not null default now()
);

create table public.mat_counts (
  id uuid primary key default gen_random_uuid(),
  counted_on date not null,
  place_id uuid not null references public.mat_places(id),
  note text,
  person_id uuid references public.people(id),
  created_at timestamptz not null default now()
);
create table public.mat_count_lines (
  id uuid primary key default gen_random_uuid(),
  count_id uuid not null references public.mat_counts(id) on delete cascade,
  item_id uuid not null references public.mat_items(id),
  system_qty numeric not null,
  counted numeric not null,
  diff numeric not null,
  rate numeric
);

create table public.mat_moves (
  id bigint generated always as identity primary key,
  item_id uuid not null references public.mat_items(id),
  place_id uuid not null references public.mat_places(id),
  qty numeric not null,
  kind text not null check (kind in ('opening', 'in', 'used_make', 'used_fill', 'used_maker', 'sent', 'adjust', 'count')),
  auto boolean not null default false,
  batch_id uuid references public.batches(id) on delete cascade,
  receipt_id uuid references public.mat_receipts(id) on delete cascade,
  count_id uuid references public.mat_counts(id) on delete cascade,
  ref uuid,                                       -- pairs the two sides of a send
  on_date date not null default public.today_ist(),
  note text,
  person_id uuid references public.people(id),
  at timestamptz not null default now()
);
create index mat_moves_item on public.mat_moves (item_id, place_id);
create index mat_moves_batch on public.mat_moves (batch_id) where batch_id is not null;

-- Packaging per pack, per product and pack size. For a roll-form item, qty = pouches per pack.
create table public.mat_pack_rules (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  grammage_g numeric not null,
  item_id uuid not null references public.mat_items(id),
  qty numeric not null check (qty > 0),
  unique (product_id, grammage_g, item_id)
);

-- Recipes: ingredients for one batch (grams) and what that batch makes (kg). Recipe access only.
create table public.mat_recipes (
  product_id uuid primary key references public.products(id) on delete cascade,
  output_kg numeric check (output_kg > 0),
  note text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.people(id)
);
create table public.mat_recipe_lines (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.mat_recipes(product_id) on delete cascade,
  item_id uuid references public.mat_items(id),    -- null = not in the stock list (e.g. water): not deducted
  ingredient text not null,
  grams numeric not null check (grams >= 0),
  sort int not null default 0
);

-- ---------- locks ----------
alter table public.mat_places enable row level security;
alter table public.mat_items enable row level security;
alter table public.mat_receipts enable row level security;
alter table public.mat_counts enable row level security;
alter table public.mat_count_lines enable row level security;
alter table public.mat_moves enable row level security;
alter table public.mat_pack_rules enable row level security;
alter table public.mat_recipes enable row level security;
alter table public.mat_recipe_lines enable row level security;

create policy mat_places_read on public.mat_places for select using (public.not_warehouse());
create policy mat_items_read on public.mat_items for select using (public.not_warehouse());
create policy mat_receipts_read on public.mat_receipts for select using (public.not_warehouse());
create policy mat_counts_read on public.mat_counts for select using (public.not_warehouse());
create policy mat_count_lines_read on public.mat_count_lines for select using (public.not_warehouse());
create policy mat_pack_rules_read on public.mat_pack_rules for select using (public.not_warehouse());
-- Raw material used per batch would show the recipe, so only recipe people see those lines.
create policy mat_moves_read on public.mat_moves for select using (public.not_warehouse() and (kind <> 'used_make' or public.has_recipe()));
create policy mat_recipes_read on public.mat_recipes for select using (public.has_recipe());
create policy mat_recipe_lines_read on public.mat_recipe_lines for select using (public.has_recipe());

revoke all on public.mat_places, public.mat_items, public.mat_receipts, public.mat_counts, public.mat_count_lines,
  public.mat_moves, public.mat_pack_rules, public.mat_recipes, public.mat_recipe_lines from anon;
revoke insert, update, delete, truncate on public.mat_places, public.mat_items, public.mat_receipts, public.mat_counts,
  public.mat_count_lines, public.mat_moves, public.mat_pack_rules, public.mat_recipes, public.mat_recipe_lines from authenticated;
grant select on public.mat_places, public.mat_items, public.mat_receipts, public.mat_counts, public.mat_count_lines,
  public.mat_moves, public.mat_pack_rules, public.mat_recipes, public.mat_recipe_lines to authenticated;

-- Stock per item and place, from every move (including the hidden recipe ones), for the team only.
create view public.mat_stock as
  select m.item_id, m.place_id, sum(m.qty) as qty
  from public.mat_moves m
  where public.not_warehouse()
  group by m.item_id, m.place_id;
revoke all on public.mat_stock from anon;
grant select on public.mat_stock to authenticated;

-- ---------- helpers ----------
create or replace function public.mat_main() returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.mat_places where is_main limit 1;
$$;

create or replace function public.mat_qty(p_item uuid, p_place uuid) returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce(sum(qty), 0) from public.mat_moves where item_id = p_item and place_id = p_place;
$$;

create or replace function public.mat_log(kind text, summary text, entity text default null) returns void language sql security definer set search_path = '' as $$
  insert into public.activity (person_id, kind, entity_type, entity_id, summary)
  values (auth.uid(), kind, 'material', entity, coalesce((select name from public.people where id = auth.uid()), 'Set-up') || ' ' || summary);
$$;

create or replace function public.mat_name(p_item uuid) returns text language sql stable security definer set search_path = '' as $$
  select name from public.mat_items where id = p_item;
$$;

create or replace function public.mat_amount(p_item uuid, p_qty numeric) returns text language sql stable security definer set search_path = '' as $$
  select trim(to_char(p_qty, 'FM999999990.###')) || ' ' || coalesce((select unit from public.mat_items where id = p_item), '');
$$;

-- ---------- automatic usage ----------
-- Rebuilds the automatic usage lines of one batch from its current state, so edits, reopening,
-- removed output lines and cancelling all stay right.
create or replace function public.mat_sync_batch(p_batch uuid) returns void language plpgsql security definer set search_path = '' as $$
declare
  b public.batches;
  r public.mat_recipes;
  main uuid := public.mat_main();
begin
  delete from public.mat_moves where batch_id = p_batch and auto;
  select * into b from public.batches where id = p_batch;
  if b is null or b.stage = 'cancelled' then return; end if;

  -- Raw materials at Making done: in-house batches made from scratch (not filled from bulk).
  if b.made_kg is not null and b.manufacturer_id is null and b.from_lot is null and b.made_on >= public.mat_start() then
    select * into r from public.mat_recipes where product_id = b.product_id;
    if r.output_kg is not null then
      insert into public.mat_moves (item_id, place_id, qty, kind, auto, batch_id, on_date, note)
      select l.item_id, main,
        -round(b.made_kg / r.output_kg * l.grams / case when i.unit = 'kg' then 1000.0 else 1 end, 4),
        'used_make', true, b.id, b.made_on, 'Recipe × ' || b.made_kg || ' kg'
      from public.mat_recipe_lines l join public.mat_items i on i.id = l.item_id
      where l.product_id = b.product_id and l.grams > 0 and not i.count_only;
    end if;
  end if;

  -- Packaging at Filling done: everything filled here (not batches received packed from a manufacturer).
  if not (b.manufacturer_id is not null and b.made_kg is null) then
    insert into public.mat_moves (item_id, place_id, qty, kind, auto, batch_id, on_date, note)
    select pr.item_id, main,
      -round(sum(o.units * pr.qty / case when i.pouches_per_kg is not null and i.unit = 'kg' then i.pouches_per_kg else 1 end), 4),
      'used_fill', true, b.id, o.made_on, sum(o.units) || ' × ' || trim(to_char(coalesce(o.grammage_g, b.grammage_g), 'FM99990.##')) || ' g'
    from public.batch_outputs o
    join public.mat_pack_rules pr on pr.product_id = b.product_id and pr.grammage_g = coalesce(o.grammage_g, b.grammage_g)
    join public.mat_items i on i.id = pr.item_id
    where o.batch_id = b.id and o.made_on >= public.mat_start() and o.units > 0 and not i.count_only
      and (i.unit = 'pcs' or i.pouches_per_kg is not null)
    group by pr.item_id, o.made_on, coalesce(o.grammage_g, b.grammage_g);
  end if;
end $$;
revoke all on function public.mat_sync_batch(uuid) from public, anon, authenticated;

create or replace function public.mat_on_output() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.mat_sync_batch(coalesce(new.batch_id, old.batch_id));
  if tg_op = 'UPDATE' and new.batch_id is distinct from old.batch_id then perform public.mat_sync_batch(old.batch_id); end if;
  return null;
end $$;
create trigger mat_on_output after insert or update or delete on public.batch_outputs
  for each row execute function public.mat_on_output();

create or replace function public.mat_on_batch() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.made_kg is distinct from old.made_kg or new.made_on is distinct from old.made_on or new.stage is distinct from old.stage
     or new.manufacturer_id is distinct from old.manufacturer_id or new.product_id is distinct from old.product_id
     or new.grammage_g is distinct from old.grammage_g then
    perform public.mat_sync_batch(new.id);
  end if;
  return null;
end $$;
create trigger mat_on_batch after update on public.batches for each row execute function public.mat_on_batch();

-- ---------- changes (all checked here) ----------
create or replace function public.mat_receive(p_item uuid, p_place uuid, p_qty numeric, p_boxes numeric, p_supplier text,
  p_rate numeric, p_gst numeric, p_date date, p_expiry date, p_bill text, p_note text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  i public.mat_items;
  q numeric := p_qty;
  rid uuid;
begin
  if not public.can_plan() then raise exception 'Only the production team can receive materials.'; end if;
  select * into i from public.mat_items where id = p_item and active;
  if i is null then raise exception 'Item not found.'; end if;
  if q is null and p_boxes is not null and i.box_size is not null then q := p_boxes * i.box_size; end if;
  if q is null or q <= 0 then raise exception 'Please enter the quantity.'; end if;
  if p_date is null or p_date > public.today_ist() then raise exception 'Please choose today or an earlier date.'; end if;
  if p_rate is not null and p_rate < 0 then raise exception 'Rate can''t be negative.'; end if;
  insert into public.mat_receipts (item_id, place_id, qty, boxes, supplier, rate, gst_pct, received_on, expiry, bill_no, note, person_id)
  values (i.id, coalesce(p_place, public.mat_main()), q, p_boxes, nullif(trim(p_supplier), ''), p_rate, p_gst, p_date, p_expiry,
    nullif(trim(p_bill), ''), nullif(trim(p_note), ''), auth.uid())
  returning id into rid;
  insert into public.mat_moves (item_id, place_id, qty, kind, receipt_id, on_date, note, person_id)
  values (i.id, coalesce(p_place, public.mat_main()), q, 'in', rid, p_date, nullif(trim(p_supplier), ''), auth.uid());
  update public.mat_items set last_rate = coalesce(p_rate, last_rate), supplier = coalesce(supplier, nullif(trim(p_supplier), '')),
    updated_at = now() where id = i.id;
  perform public.mat_log('mat_received', 'received ' || public.mat_amount(i.id, q) || ' of ' || i.name ||
    coalesce(' from ' || nullif(trim(p_supplier), ''), ''), i.id::text);
  return rid;
end $$;

create or replace function public.mat_remove_receipt(p_id uuid, p_reason text) returns void language plpgsql security definer set search_path = '' as $$
declare r public.mat_receipts;
begin
  if not public.is_admin() then raise exception 'Only admins can remove a receipt.'; end if;
  if nullif(trim(p_reason), '') is null then raise exception 'Please give a reason.'; end if;
  select * into r from public.mat_receipts where id = p_id;
  if r is null then raise exception 'Not found.'; end if;
  delete from public.mat_receipts where id = p_id;
  perform public.mat_log('mat_receipt_removed', 'removed a receipt of ' || public.mat_amount(r.item_id, r.qty) || ' of ' ||
    public.mat_name(r.item_id) || ': ' || trim(p_reason), r.item_id::text);
end $$;

-- Move items between places (e.g. send seasoning and pouches to a manufacturer, or bring them back).
create or replace function public.mat_send(p_from uuid, p_to uuid, p_lines jsonb, p_date date, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  l jsonb;
  q numeric;
  it uuid;
  g uuid;
  n int := 0;
  names text := '';
begin
  if not public.can_plan() then raise exception 'Only the production team can move materials.'; end if;
  if p_from is null or p_to is null or p_from = p_to then raise exception 'Please choose two different places.'; end if;
  if p_date is null or p_date > public.today_ist() then raise exception 'Please choose today or an earlier date.'; end if;
  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    it := nullif(l ->> 'item', '')::uuid;
    q := nullif(l ->> 'qty', '')::numeric;
    if it is null or q is null or q = 0 then continue; end if;
    if q < 0 then raise exception 'Quantities must be more than zero.'; end if;
    g := gen_random_uuid();
    insert into public.mat_moves (item_id, place_id, qty, kind, ref, on_date, note, person_id)
    values (it, p_from, -q, 'sent', g, p_date, nullif(trim(p_note), ''), auth.uid()),
           (it, p_to, q, 'sent', g, p_date, nullif(trim(p_note), ''), auth.uid());
    n := n + 1;
    names := names || case when n > 1 then ', ' else '' end || public.mat_amount(it, q) || ' ' || public.mat_name(it);
  end loop;
  if n = 0 then raise exception 'Please enter at least one quantity.'; end if;
  perform public.mat_log('mat_sent', 'moved ' || names || ' from ' || (select name from public.mat_places where id = p_from) ||
    ' to ' || (select name from public.mat_places where id = p_to));
end $$;

-- Closing stock at a manufacturer after a production: used = what was there − what's left.
-- What's left can stay there or come back to the main store.
create or replace function public.mat_close_maker(p_place uuid, p_batch uuid, p_lines jsonb, p_bring_back boolean, p_date date, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  l jsonb;
  it uuid;
  left_ numeric;
  cur numeric;
  g uuid;
  main uuid := public.mat_main();
  pl public.mat_places;
  bl text;
  n int := 0;
begin
  if not public.can_plan() then raise exception 'Only the production team can record this.'; end if;
  select * into pl from public.mat_places where id = p_place;
  if pl is null or pl.kind <> 'maker' then raise exception 'Please choose a manufacturer.'; end if;
  if p_date is null or p_date > public.today_ist() then raise exception 'Please choose today or an earlier date.'; end if;
  select coalesce(batch_no, 'batch') into bl from public.batches where id = p_batch;
  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    it := nullif(l ->> 'item', '')::uuid;
    left_ := nullif(l ->> 'left', '')::numeric;
    if it is null or left_ is null then continue; end if;
    if left_ < 0 then raise exception 'What''s left can''t be negative.'; end if;
    cur := public.mat_qty(it, p_place);
    if left_ <> cur then
      insert into public.mat_moves (item_id, place_id, qty, kind, batch_id, on_date, note, person_id)
      values (it, p_place, left_ - cur, 'used_maker', p_batch, p_date,
        'Closing stock at ' || pl.name || coalesce(' for ' || bl, '') || coalesce(': ' || nullif(trim(p_note), ''), ''), auth.uid());
    end if;
    if p_bring_back and left_ > 0 then
      g := gen_random_uuid();
      insert into public.mat_moves (item_id, place_id, qty, kind, ref, on_date, note, person_id)
      values (it, p_place, -left_, 'sent', g, p_date, 'Brought back', auth.uid()), (it, main, left_, 'sent', g, p_date, 'Brought back', auth.uid());
    end if;
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'Please enter what''s left for at least one item.'; end if;
  perform public.mat_log('mat_closed_at_maker', 'recorded closing stock at ' || pl.name || coalesce(' for ' || bl, '') ||
    case when p_bring_back then ' and brought it back' else '' end, p_batch::text);
end $$;

create or replace function public.mat_adjust(p_item uuid, p_place uuid, p_qty numeric, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Only admins can correct stock.'; end if;
  if nullif(trim(p_reason), '') is null then raise exception 'Please give a reason.'; end if;
  if p_qty is null or p_qty = 0 then raise exception 'Please enter the amount to add or take off.'; end if;
  insert into public.mat_moves (item_id, place_id, qty, kind, note, person_id) values (p_item, coalesce(p_place, public.mat_main()), p_qty, 'adjust', trim(p_reason), auth.uid());
  perform public.mat_log('mat_adjusted', 'corrected ' || public.mat_name(p_item) || ' by ' || public.mat_amount(p_item, p_qty) || ': ' || trim(p_reason), p_item::text);
end $$;

-- Physical count at one place. The difference is recorded (minus = loss) and stock becomes the count.
create or replace function public.mat_count(p_place uuid, p_date date, p_lines jsonb, p_note text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  l jsonb;
  it uuid;
  c numeric;
  s numeric;
  cid uuid;
  n int := 0;
  lossv numeric := 0;
begin
  if not public.is_admin() then raise exception 'Only admins can save a count.'; end if;
  if p_date is null or p_date > public.today_ist() then raise exception 'Please choose today or an earlier date.'; end if;
  insert into public.mat_counts (counted_on, place_id, note, person_id) values (p_date, p_place, nullif(trim(p_note), ''), auth.uid()) returning id into cid;
  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    it := nullif(l ->> 'item', '')::uuid;
    c := nullif(l ->> 'counted', '')::numeric;
    if it is null or c is null then continue; end if;
    if c < 0 then raise exception 'A count can''t be negative.'; end if;
    s := public.mat_qty(it, p_place);
    insert into public.mat_count_lines (count_id, item_id, system_qty, counted, diff, rate)
    values (cid, it, s, c, c - s, (select last_rate from public.mat_items where id = it));
    if c <> s then
      insert into public.mat_moves (item_id, place_id, qty, kind, count_id, on_date, note, person_id)
      values (it, p_place, c - s, 'count', cid, p_date, 'Count', auth.uid());
      lossv := lossv + least(c - s, 0) * coalesce((select last_rate from public.mat_items where id = it), 0);
    end if;
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'Please enter at least one count.'; end if;
  perform public.mat_log('mat_counted', 'saved a count of ' || n || ' items at ' || (select name from public.mat_places where id = p_place) ||
    case when lossv < 0 then ' (loss ₹' || round(-lossv) || ')' else '' end, cid::text);
  return cid;
end $$;

-- Master list: add / change / delete (hide) / merge.
create or replace function public.mat_save_item(p_id uuid, p jsonb) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  id_ uuid := p_id;
  nm text := nullif(trim(p ->> 'name'), '');
begin
  if not public.is_admin() then raise exception 'Only admins can change the materials list.'; end if;
  if nm is null then raise exception 'Please enter a name.'; end if;
  if exists (select 1 from public.mat_items where lower(name) = lower(nm) and active and id is distinct from p_id) then
    raise exception 'There is already an item called %.', nm;
  end if;
  if id_ is null then
    insert into public.mat_items (kind, grp, name, code, supplier, unit, box_size, pouches_per_kg, last_rate, low_level, count_only, note)
    values (coalesce(nullif(p ->> 'kind', ''), 'RM'), nullif(trim(p ->> 'grp'), ''), nm, nullif(trim(p ->> 'code'), ''),
      nullif(trim(p ->> 'supplier'), ''), coalesce(nullif(p ->> 'unit', ''), 'pcs'), nullif(p ->> 'box_size', '')::numeric,
      nullif(p ->> 'pouches_per_kg', '')::numeric, nullif(p ->> 'last_rate', '')::numeric, nullif(p ->> 'low_level', '')::numeric,
      coalesce((p ->> 'count_only')::boolean, false), nullif(trim(p ->> 'note'), ''))
    returning id into id_;
    perform public.mat_log('mat_item_added', 'added ' || nm || ' to the materials list', id_::text);
  else
    update public.mat_items set kind = coalesce(nullif(p ->> 'kind', ''), kind), grp = nullif(trim(p ->> 'grp'), ''), name = nm,
      code = nullif(trim(p ->> 'code'), ''), supplier = nullif(trim(p ->> 'supplier'), ''), unit = coalesce(nullif(p ->> 'unit', ''), unit),
      box_size = nullif(p ->> 'box_size', '')::numeric, pouches_per_kg = nullif(p ->> 'pouches_per_kg', '')::numeric,
      last_rate = nullif(p ->> 'last_rate', '')::numeric, low_level = nullif(p ->> 'low_level', '')::numeric,
      count_only = coalesce((p ->> 'count_only')::boolean, count_only), note = nullif(trim(p ->> 'note'), ''), updated_at = now()
    where id = id_ and active;
    if not found then raise exception 'Item not found.'; end if;
    perform public.mat_log('mat_item_changed', 'changed ' || nm || ' in the materials list', id_::text);
  end if;
  return id_;
end $$;

create or replace function public.mat_delete_item(p_id uuid, p_reason text) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Only admins can change the materials list.'; end if;
  update public.mat_items set active = false, updated_at = now(), note = concat_ws(' · ', note, 'Deleted: ' || nullif(trim(p_reason), '')) where id = p_id and active;
  if not found then raise exception 'Item not found.'; end if;
  delete from public.mat_pack_rules where item_id = p_id;
  update public.mat_recipe_lines set item_id = null where item_id = p_id;
  perform public.mat_log('mat_item_deleted', 'deleted ' || public.mat_name(p_id) || ' from the materials list' || coalesce(': ' || nullif(trim(p_reason), ''), ''), p_id::text);
end $$;

create or replace function public.mat_merge_items(p_from uuid, p_into uuid) returns void language plpgsql security definer set search_path = '' as $$
declare a public.mat_items; b public.mat_items;
begin
  if not public.is_admin() then raise exception 'Only admins can change the materials list.'; end if;
  select * into a from public.mat_items where id = p_from and active;
  select * into b from public.mat_items where id = p_into and active;
  if a is null or b is null or a.id = b.id then raise exception 'Please choose two different items.'; end if;
  if a.unit <> b.unit then raise exception 'Both items need the same unit (kg or pcs).'; end if;
  update public.mat_moves set item_id = b.id where item_id = a.id;
  update public.mat_receipts set item_id = b.id where item_id = a.id;
  update public.mat_count_lines set item_id = b.id where item_id = a.id;
  delete from public.mat_pack_rules r where r.item_id = a.id
    and exists (select 1 from public.mat_pack_rules x where x.item_id = b.id and x.product_id = r.product_id and x.grammage_g = r.grammage_g);
  update public.mat_pack_rules set item_id = b.id where item_id = a.id;
  update public.mat_recipe_lines set item_id = b.id where item_id = a.id;
  update public.mat_items set active = false, updated_at = now(), note = concat_ws(' · ', note, 'Merged into ' || b.name) where id = a.id;
  update public.mat_items set code = coalesce(code, a.code), supplier = coalesce(supplier, a.supplier), last_rate = coalesce(last_rate, a.last_rate),
    updated_at = now() where id = b.id;
  perform public.mat_log('mat_item_merged', 'merged ' || a.name || ' into ' || b.name, b.id::text);
end $$;

-- Packaging per pack for one product + size (replaces what was there).
create or replace function public.mat_set_pack(p_product uuid, p_grams numeric, p_lines jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare l jsonb; it uuid; q numeric; n int := 0;
begin
  if not public.can_plan() then raise exception 'Only the production team can set packaging.'; end if;
  if p_grams is null or p_grams <= 0 then raise exception 'Please choose the pack size.'; end if;
  delete from public.mat_pack_rules where product_id = p_product and grammage_g = p_grams;
  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    it := nullif(l ->> 'item', '')::uuid;
    q := nullif(l ->> 'qty', '')::numeric;
    if it is null or q is null or q <= 0 then continue; end if;
    insert into public.mat_pack_rules (product_id, grammage_g, item_id, qty) values (p_product, p_grams, it, q)
    on conflict (product_id, grammage_g, item_id) do update set qty = public.mat_pack_rules.qty + excluded.qty;
    n := n + 1;
  end loop;
  perform public.mat_log('mat_pack_set', 'set packaging for ' || (select name from public.products where id = p_product) || ' ' ||
    trim(to_char(p_grams, 'FM99990.##')) || ' g (' || n || ' items)', p_product::text);
end $$;

create or replace function public.mat_set_recipe(p_product uuid, p_output_kg numeric, p_lines jsonb, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare l jsonb; n int := 0;
begin
  if not public.has_recipe() then raise exception 'Only people with recipe access can change recipes.'; end if;
  if p_output_kg is not null and p_output_kg <= 0 then raise exception 'What one batch makes must be more than zero.'; end if;
  insert into public.mat_recipes (product_id, output_kg, note, updated_at, updated_by) values (p_product, p_output_kg, nullif(trim(p_note), ''), now(), auth.uid())
  on conflict (product_id) do update set output_kg = excluded.output_kg, note = excluded.note, updated_at = now(), updated_by = auth.uid();
  delete from public.mat_recipe_lines where product_id = p_product;
  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    if nullif(trim(l ->> 'ingredient'), '') is null or nullif(l ->> 'grams', '') is null then continue; end if;
    insert into public.mat_recipe_lines (product_id, item_id, ingredient, grams, sort)
    values (p_product, nullif(l ->> 'item', '')::uuid, trim(l ->> 'ingredient'), (l ->> 'grams')::numeric, n);
    n := n + 1;
  end loop;
  -- Recipe access only, so the summary doesn't show amounts.
  perform public.mat_log('mat_recipe_set', 'updated the recipe for ' || (select name from public.products where id = p_product), p_product::text);
end $$;

-- ---------- what the plan needs ----------
-- Per planned batch in a date range: materials it still needs (recipe for in-house batches not
-- yet made; packaging for anything not yet filled), and whether the main store runs short
-- counting the batches planned before it. Item names only; amounts of recipe items are only
-- given to recipe people.
create or replace function public.mat_plan_needs(p_from date, p_to date)
returns table (batch_id uuid, planned_date date, item_id uuid, need numeric, short boolean)
language sql stable security definer set search_path = '' as $$
  with b as (
    select x.* from public.batches x
    where public.not_warehouse() and x.stage in ('planned', 'made') and x.planned_date between p_from and p_to
  ), raw as (
    select b.id, b.planned_date, b.created_at, l.item_id,
      (b.units_planned * b.grammage_g / 1000.0) / r.output_kg * l.grams / case when i.unit = 'kg' then 1000.0 else 1 end as need
    from b join public.mat_recipes r on r.product_id = b.product_id and r.output_kg is not null
    join public.mat_recipe_lines l on l.product_id = b.product_id and l.item_id is not null
    join public.mat_items i on i.id = l.item_id and not i.count_only
    where b.stage = 'planned' and b.manufacturer_id is null and b.from_lot is null and b.units_planned > 0 and b.grammage_g > 0
  ), pack as (
    select b.id, b.planned_date, b.created_at, pr.item_id,
      b.units_planned * pr.qty / case when i.unit = 'kg' and i.pouches_per_kg is not null then i.pouches_per_kg else 1 end as need
    from b join public.mat_pack_rules pr on pr.product_id = b.product_id and pr.grammage_g = b.grammage_g
    join public.mat_items i on i.id = pr.item_id and not i.count_only and (i.unit = 'pcs' or i.pouches_per_kg is not null)
    where b.units_planned > 0 and (b.manufacturer_id is null or b.stage = 'made')
  ), alln as (
    select id, planned_date, created_at, item_id, sum(need) as need from (select * from raw union all select * from pack) u
    group by id, planned_date, created_at, item_id
  ), run as (
    select a.*, sum(a.need) over (partition by a.item_id order by a.planned_date, a.created_at, a.id) as upto,
      public.mat_qty(a.item_id, public.mat_main()) as stock
    from alln a
  )
  select r.id, r.planned_date, r.item_id,
    case when public.has_recipe() or r.item_id not in (select l.item_id from public.mat_recipe_lines l where l.item_id is not null) then round(r.need, 3) end,
    r.upto > r.stock
  from run r;
$$;

revoke all on function public.mat_receive(uuid, uuid, numeric, numeric, text, numeric, numeric, date, date, text, text),
  public.mat_remove_receipt(uuid, text), public.mat_send(uuid, uuid, jsonb, date, text),
  public.mat_close_maker(uuid, uuid, jsonb, boolean, date, text), public.mat_adjust(uuid, uuid, numeric, text),
  public.mat_count(uuid, date, jsonb, text), public.mat_save_item(uuid, jsonb), public.mat_delete_item(uuid, text),
  public.mat_merge_items(uuid, uuid), public.mat_set_pack(uuid, numeric, jsonb), public.mat_set_recipe(uuid, numeric, jsonb, text),
  public.mat_plan_needs(date, date), public.has_recipe(), public.mat_main(), public.mat_qty(uuid, uuid),
  public.mat_log(text, text, text), public.mat_name(uuid), public.mat_amount(uuid, numeric)
  from public, anon;
grant execute on function public.mat_receive(uuid, uuid, numeric, numeric, text, numeric, numeric, date, date, text, text),
  public.mat_remove_receipt(uuid, text), public.mat_send(uuid, uuid, jsonb, date, text),
  public.mat_close_maker(uuid, uuid, jsonb, boolean, date, text), public.mat_adjust(uuid, uuid, numeric, text),
  public.mat_count(uuid, date, jsonb, text), public.mat_save_item(uuid, jsonb), public.mat_delete_item(uuid, text),
  public.mat_merge_items(uuid, uuid), public.mat_set_pack(uuid, numeric, jsonb), public.mat_set_recipe(uuid, numeric, jsonb, text),
  public.mat_plan_needs(date, date), public.has_recipe()
  to authenticated;
revoke all on function public.mat_log(text, text, text), public.mat_name(uuid), public.mat_amount(uuid, numeric),
  public.mat_qty(uuid, uuid), public.mat_main() from authenticated;
