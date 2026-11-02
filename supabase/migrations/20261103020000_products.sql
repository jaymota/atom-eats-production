-- Phase 2: the product list. Products are never deleted, only set to Not live.

create table public.products (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique check (length(trim(sku)) between 1 and 40),
  name text not null check (length(trim(name)) between 1 and 120),
  category text,
  grammage_g numeric check (grammage_g is null or grammage_g > 0),
  mrp numeric check (mrp is null or mrp >= 0),
  shelf_life_months int check (shelf_life_months is null or shelf_life_months between 0 and 60),
  batch_prefix text check (batch_prefix is null or batch_prefix ~ '^[A-Z0-9]{2,20}$'),
  next_batch_no int not null default 1 check (next_batch_no > 0),
  live boolean not null default true,
  made_by text check (made_by in ('in_house', 'third_party')),
  -- Things someone should look at (e.g. size differs between files). Cleared with "Checked".
  needs_check text[] not null default '{}',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.people (id) on delete set null
);
create index on public.products (live, category, name);

alter table public.products enable row level security;
create policy products_read on public.products for select to authenticated using (public.me_ok());
create policy products_add on public.products for insert to authenticated with check (public.is_admin());
create policy products_change on public.products for update to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.products from anon;
revoke delete, truncate on public.products from authenticated;

-- Stamp who changed it, and log each change in Activity.
create or replace function public.products_stamp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  who text := coalesce((select name from public.people where id = auth.uid()), 'Set-up');
  said text[] := '{}';
begin
  if tg_op = 'UPDATE' then
    new.updated_at := now();
    new.updated_by := auth.uid();
    if new.name is distinct from old.name then said := said || ('name → ' || new.name); end if;
    if new.sku is distinct from old.sku then said := said || ('SKU → ' || new.sku); end if;
    if new.category is distinct from old.category then said := said || ('category → ' || coalesce(new.category, 'none')); end if;
    if new.grammage_g is distinct from old.grammage_g then said := said || ('size → ' || coalesce(new.grammage_g::text || ' g', 'none')); end if;
    if new.mrp is distinct from old.mrp then said := said || ('MRP → ' || coalesce('₹' || new.mrp::text, 'none')); end if;
    if new.shelf_life_months is distinct from old.shelf_life_months then said := said || ('shelf life → ' || coalesce(new.shelf_life_months::text || ' months', 'none')); end if;
    if new.batch_prefix is distinct from old.batch_prefix then said := said || ('batch prefix → ' || coalesce(new.batch_prefix, 'none')); end if;
    if new.next_batch_no is distinct from old.next_batch_no then said := said || ('next batch no. → ' || new.next_batch_no); end if;
    if new.live is distinct from old.live then said := said || (case when new.live then 'live' else 'not live' end); end if;
    if new.made_by is distinct from old.made_by then said := said || ('made by → ' || coalesce(replace(new.made_by, '_', '-'), 'not set')); end if;
    if new.notes is distinct from old.notes then said := said || 'notes'::text; end if;
    if new.needs_check is distinct from old.needs_check and cardinality(new.needs_check) = 0 then said := said || 'marked checked'::text; end if;
    if cardinality(said) > 0 then
      insert into public.activity (person_id, kind, entity_type, entity_id, summary)
      values (auth.uid(), 'product_changed', 'product', new.id::text, who || ' changed ' || new.name || ': ' || array_to_string(said, ', '));
    end if;
  else
    insert into public.activity (person_id, kind, entity_type, entity_id, summary)
    values (auth.uid(), 'product_added', 'product', new.id::text, who || ' added product ' || new.name || ' (' || new.sku || ')');
  end if;
  return new;
end;
$$;
create trigger products_stamp_upd before update on public.products for each row execute function public.products_stamp();
create trigger products_log_add after insert on public.products for each row execute function public.products_stamp();
