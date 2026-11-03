-- Finished stock at two places: Gala 17 (factory) and Gala 6 (warehouse), by batch.
--
-- * Everything filled (or contract stock received packed) from 5 Nov 2026 lands at Gala 17.
-- * Transfers are two steps: the factory sends (stock moves to "in transit"), the warehouse
--   confirms what actually arrived (it moves to Gala 6). Any difference is flagged and needs a
--   sign-off by someone allowed to sign off (Siddhesh, Jay).
-- * Every unit in or out is a line in fg_moves, so stock can always be rebuilt and checked.

-- ---------- People: warehouse role and sign-off ----------

alter table public.people drop constraint people_role_check;
alter table public.people add constraint people_role_check check (role in ('super_admin', 'admin', 'floor', 'warehouse'));
alter table public.people add column sign_off boolean not null default false;
update public.people set sign_off = true where username in ('jay', 'siddhesh');

create or replace function public.can_sign_off()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.me_ok() and coalesce((select sign_off from public.people where id = auth.uid()), false);
$$;

create or replace function public.can_receive()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.my_role() in ('super_admin', 'admin', 'warehouse'), false);
$$;

-- ---------- Stock lines ----------

create table public.fg_moves (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  location text not null check (location in ('gala17', 'transit', 'gala6')),
  product_id uuid not null references public.products (id),
  grammage_g numeric,
  batch_id uuid references public.batches (id),
  batch_no text,
  made_on date not null,
  units int not null check (units <> 0),
  kind text not null check (kind in ('produced', 'sent', 'received', 'difference', 'adjust', 'unproduced')),
  transfer_id uuid,
  output_id uuid,
  reason text,
  person_id uuid references public.people (id) on delete set null
);
create index on public.fg_moves (location, product_id);
create index on public.fg_moves (batch_id);

-- Transfer notes TN-0001, TN-0002, …
create sequence public.transfer_no_seq;
create table public.transfers (
  id uuid primary key default gen_random_uuid(),
  transfer_no text not null unique,
  status text not null default 'sent' check (status in ('sent', 'received')),
  boxes_sent int check (boxes_sent is null or boxes_sent >= 0),
  boxes_received int check (boxes_received is null or boxes_received >= 0),
  note text,
  receive_note text,
  sent_at timestamptz not null default now(),
  sent_by uuid references public.people (id) on delete set null,
  received_at timestamptz,
  received_by uuid references public.people (id) on delete set null,
  has_difference boolean not null default false,
  signed_off_at timestamptz,
  signed_off_by uuid references public.people (id) on delete set null,
  sign_off_note text
);
alter table public.fg_moves add constraint fg_moves_transfer_fkey foreign key (transfer_id) references public.transfers (id);

create table public.transfer_lines (
  id uuid primary key default gen_random_uuid(),
  transfer_id uuid not null references public.transfers (id),
  product_id uuid not null references public.products (id),
  grammage_g numeric,
  batch_id uuid references public.batches (id),
  batch_no text,
  made_on date not null,
  units_sent int not null check (units_sent > 0),
  units_received int check (units_received is null or units_received >= 0)
);
create index on public.transfer_lines (transfer_id);

alter table public.fg_moves enable row level security;
alter table public.transfers enable row level security;
alter table public.transfer_lines enable row level security;
create policy fg_moves_read on public.fg_moves for select to authenticated using (public.me_ok());
create policy transfers_read on public.transfers for select to authenticated using (public.me_ok());
create policy transfer_lines_read on public.transfer_lines for select to authenticated using (public.me_ok());
revoke all on public.fg_moves, public.transfers, public.transfer_lines from anon;
revoke insert, update, delete, truncate on public.fg_moves, public.transfers, public.transfer_lines from authenticated;

-- Stock now, per place / product / size / batch / made date, with expiry from the shelf life.
create view public.fg_stock with (security_invoker = true) as
  select m.location, m.product_id, m.grammage_g, m.batch_id, m.batch_no, m.made_on,
    sum(m.units)::int as units,
    case when p.shelf_life_months is not null then (m.made_on + make_interval(months => p.shelf_life_months))::date end as expires_on
  from public.fg_moves m join public.products p on p.id = m.product_id
  group by m.location, m.product_id, m.grammage_g, m.batch_id, m.batch_no, m.made_on, p.shelf_life_months
  having sum(m.units) <> 0;
grant select on public.fg_stock to authenticated;

-- ---------- Production lands at Gala 17 (from 5 Nov 2026) ----------

create or replace function public.fg_from_output()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare b public.batches;
begin
  if tg_op = 'INSERT' then
    if new.made_on < date '2026-11-05' or new.units <= 0 then return new; end if;
    select * into b from public.batches where id = new.batch_id;
    insert into public.fg_moves (location, product_id, grammage_g, batch_id, batch_no, made_on, units, kind, output_id, person_id)
    values ('gala17', b.product_id, coalesce(new.grammage_g, b.grammage_g), b.id, b.batch_no, new.made_on, new.units, 'produced', new.id, auth.uid());
    return new;
  else
    -- An output line removed by an admin: take its units back out of Gala 17.
    if old.made_on < date '2026-11-05' or old.units <= 0 then return old; end if;
    select * into b from public.batches where id = old.batch_id;
    insert into public.fg_moves (location, product_id, grammage_g, batch_id, batch_no, made_on, units, kind, output_id, reason, person_id)
    values ('gala17', b.product_id, coalesce(old.grammage_g, b.grammage_g), b.id, b.batch_no, old.made_on, -old.units, 'unproduced', old.id, 'Output line removed', auth.uid());
    return old;
  end if;
end;
$$;
create trigger batch_outputs_to_stock after insert or delete on public.batch_outputs for each row execute function public.fg_from_output();

-- fg_moves keep a link to removed output lines only by id (no foreign key), so removing an output still works.

-- ---------- Send (Gala 17 → in transit) ----------

-- p_lines: [{"product_id": "...", "grammage_g": 30, "batch_id": "...", "made_on": "2026-11-05", "units": 120}, …]
create or replace function public.send_transfer(p_lines jsonb, p_boxes int default null, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.transfers;
  l jsonb;
  have int;
  u int;
  bno text;
  n int := 0;
  total int := 0;
begin
  if not public.is_team() then raise exception 'Only the factory team can send stock.'; end if;
  insert into public.transfers (transfer_no, boxes_sent, note, sent_by)
  values ('TN-' || lpad(nextval('public.transfer_no_seq')::text, 4, '0'), p_boxes, nullif(trim(p_note), ''), auth.uid())
  returning * into t;
  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    u := nullif(l ->> 'units', '')::int;
    if u is null or u <= 0 then continue; end if;
    select coalesce(sum(units), 0) into have from public.fg_moves
    where location = 'gala17' and product_id = (l ->> 'product_id')::uuid
      and grammage_g is not distinct from nullif(l ->> 'grammage_g', '')::numeric
      and batch_id is not distinct from nullif(l ->> 'batch_id', '')::uuid
      and made_on = (l ->> 'made_on')::date;
    if u > have then
      raise exception 'Only % units of % are at Gala 17.', have, (select name from public.products where id = (l ->> 'product_id')::uuid);
    end if;
    select batch_no into bno from public.batches where id = nullif(l ->> 'batch_id', '')::uuid;
    insert into public.transfer_lines (transfer_id, product_id, grammage_g, batch_id, batch_no, made_on, units_sent)
    values (t.id, (l ->> 'product_id')::uuid, nullif(l ->> 'grammage_g', '')::numeric, nullif(l ->> 'batch_id', '')::uuid, bno, (l ->> 'made_on')::date, u);
    insert into public.fg_moves (location, product_id, grammage_g, batch_id, batch_no, made_on, units, kind, transfer_id, person_id) values
      ('gala17', (l ->> 'product_id')::uuid, nullif(l ->> 'grammage_g', '')::numeric, nullif(l ->> 'batch_id', '')::uuid, bno, (l ->> 'made_on')::date, -u, 'sent', t.id, auth.uid()),
      ('transit', (l ->> 'product_id')::uuid, nullif(l ->> 'grammage_g', '')::numeric, nullif(l ->> 'batch_id', '')::uuid, bno, (l ->> 'made_on')::date, u, 'sent', t.id, auth.uid());
    n := n + 1;
    total := total + u;
  end loop;
  if n = 0 then raise exception 'Please enter the units to send.'; end if;
  insert into public.activity (person_id, kind, entity_type, entity_id, summary)
  values (auth.uid(), 'transfer_sent', 'transfer', t.id::text,
    coalesce((select name from public.people where id = auth.uid()), 'Set-up') || ' sent ' || t.transfer_no || ' to Gala 6: ' || total || ' units' ||
    coalesce(', ' || p_boxes || ' boxes', ''));
  return t.id;
end;
$$;

-- ---------- Receive (in transit → Gala 6) ----------

-- p_lines: [{"line_id": "...", "units": 118}, …] (lines left out = received as sent)
create or replace function public.receive_transfer(p_id uuid, p_lines jsonb, p_boxes int default null, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.transfers;
  r public.transfer_lines;
  got int;
  diff boolean := false;
  total int := 0;
begin
  if not public.can_receive() then raise exception 'Only the warehouse team can receive stock.'; end if;
  select * into t from public.transfers where id = p_id for update;
  if t is null then raise exception 'Transfer not found.'; end if;
  if t.status <> 'sent' then raise exception 'This transfer was already received.'; end if;
  for r in select * from public.transfer_lines where transfer_id = t.id loop
    got := coalesce((select nullif(x ->> 'units', '')::int from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) x
                     where x ->> 'line_id' = r.id::text limit 1), r.units_sent);
    if got < 0 then raise exception 'Units can''t be negative.'; end if;
    update public.transfer_lines set units_received = got where id = r.id;
    insert into public.fg_moves (location, product_id, grammage_g, batch_id, batch_no, made_on, units, kind, transfer_id, person_id)
    values ('transit', r.product_id, r.grammage_g, r.batch_id, r.batch_no, r.made_on, -r.units_sent, 'received', t.id, auth.uid());
    if got > 0 then
      insert into public.fg_moves (location, product_id, grammage_g, batch_id, batch_no, made_on, units, kind, transfer_id, person_id)
      values ('gala6', r.product_id, r.grammage_g, r.batch_id, r.batch_no, r.made_on, got, 'received', t.id, auth.uid());
    end if;
    if got <> r.units_sent then diff := true; end if;
    total := total + got;
  end loop;
  if t.boxes_sent is not null and p_boxes is not null and p_boxes <> t.boxes_sent then diff := true; end if;
  update public.transfers set status = 'received', received_at = now(), received_by = auth.uid(), boxes_received = p_boxes,
    receive_note = nullif(trim(p_note), ''), has_difference = diff
  where id = t.id;
  insert into public.activity (person_id, kind, entity_type, entity_id, summary)
  values (auth.uid(), 'transfer_received', 'transfer', t.id::text,
    coalesce((select name from public.people where id = auth.uid()), 'Set-up') || ' received ' || t.transfer_no || ' at Gala 6: ' || total || ' units' ||
    case when diff then ' — DIFFERENCE from what was sent' else '' end);
end;
$$;

create or replace function public.sign_off_transfer(p_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare t public.transfers;
begin
  if not public.can_sign_off() then raise exception 'Only Siddhesh or Jay can sign off differences.'; end if;
  if nullif(trim(p_note), '') is null then raise exception 'Please add a note.'; end if;
  select * into t from public.transfers where id = p_id for update;
  if t is null then raise exception 'Transfer not found.'; end if;
  if not t.has_difference then raise exception 'This transfer has no difference.'; end if;
  if t.signed_off_at is not null then raise exception 'Already signed off.'; end if;
  update public.transfers set signed_off_at = now(), signed_off_by = auth.uid(), sign_off_note = trim(p_note) where id = t.id;
  insert into public.activity (person_id, kind, entity_type, entity_id, summary)
  values (auth.uid(), 'transfer_signed_off', 'transfer', t.id::text,
    coalesce((select name from public.people where id = auth.uid()), 'Set-up') || ' signed off the difference on ' || t.transfer_no || ': ' || trim(p_note));
end;
$$;

-- ---------- Samples, damages, expired (admins) ----------

create or replace function public.adjust_fg(p_location text, p_product uuid, p_grammage numeric, p_batch uuid, p_made_on date, p_units int, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  have int;
  bno text;
begin
  if not public.is_admin() then raise exception 'Only admins can take stock out.'; end if;
  if p_location not in ('gala17', 'gala6') then raise exception 'Choose Gala 17 or Gala 6.'; end if;
  if nullif(trim(p_reason), '') is null then raise exception 'Please give a reason.'; end if;
  if p_units is null or p_units <= 0 then raise exception 'Please enter the units.'; end if;
  select coalesce(sum(units), 0) into have from public.fg_moves
  where location = p_location and product_id = p_product and grammage_g is not distinct from p_grammage
    and batch_id is not distinct from p_batch and made_on = p_made_on;
  if p_units > have then raise exception 'Only % units there.', have; end if;
  select batch_no into bno from public.batches where id = p_batch;
  insert into public.fg_moves (location, product_id, grammage_g, batch_id, batch_no, made_on, units, kind, reason, person_id)
  values (p_location, p_product, p_grammage, p_batch, bno, p_made_on, -p_units, 'adjust', trim(p_reason), auth.uid());
  insert into public.activity (person_id, kind, entity_type, entity_id, summary)
  values (auth.uid(), 'stock_adjusted', 'product', p_product::text,
    coalesce((select name from public.people where id = auth.uid()), 'Set-up') || ' took ' || p_units || ' × ' ||
    (select name from public.products where id = p_product) || coalesce(' (' || bno || ')', '') || ' out of ' ||
    case p_location when 'gala17' then 'Gala 17' else 'Gala 6' end || ': ' || trim(p_reason));
end;
$$;

-- ---------- Shelf life can be filled in by the floor team when making a product ----------

create or replace function public.set_shelf_life(p_product uuid, p_months int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare pr public.products;
begin
  if not public.is_team() then raise exception 'Please log in again.'; end if;
  if p_months is null or p_months < 1 or p_months > 36 then raise exception 'Shelf life: 1 to 36 months.'; end if;
  select * into pr from public.products where id = p_product;
  if pr is null then raise exception 'Product not found.'; end if;
  if pr.shelf_life_months is not null and not public.is_admin() then raise exception 'Only admins can change a shelf life.'; end if;
  update public.products set shelf_life_months = p_months where id = p_product;
end;
$$;

revoke all on function public.send_transfer(jsonb, int, text), public.receive_transfer(uuid, jsonb, int, text), public.sign_off_transfer(uuid, text),
  public.adjust_fg(text, uuid, numeric, uuid, date, int, text), public.set_shelf_life(uuid, int), public.can_sign_off(), public.can_receive() from public, anon;
grant execute on function public.send_transfer(jsonb, int, text), public.receive_transfer(uuid, jsonb, int, text), public.sign_off_transfer(uuid, text),
  public.adjust_fg(text, uuid, numeric, uuid, date, int, text), public.set_shelf_life(uuid, int), public.can_sign_off(), public.can_receive() to authenticated;
