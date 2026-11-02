-- Custom products added while planning (a one-off or new item not in the list yet).
-- They get a temporary SKU (CUSTOM-0001 …) and land on the Products "To check" list.

create sequence if not exists public.custom_sku_seq;

create or replace function public.add_custom_product(p_name text, p_grams numeric, p_category text default null, p_prefix text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  id_ uuid;
  sku_ text;
  pre text := nullif(upper(regexp_replace(coalesce(p_prefix, ''), '[^A-Za-z0-9]', '', 'g')), '');
begin
  if not public.is_admin() then raise exception 'Only admins can add products.'; end if;
  if nullif(trim(p_name), '') is null then raise exception 'Please enter a name.'; end if;
  if p_grams is null or p_grams <= 0 then raise exception 'Please enter the pack size in grams.'; end if;
  if pre is not null and length(pre) < 2 then raise exception 'Batch prefix: at least 2 letters or numbers.'; end if;
  if exists (select 1 from public.products where lower(trim(name)) = lower(trim(p_name)) and grammage_g = p_grams) then
    raise exception 'A product with that name and size already exists. Search for it instead.';
  end if;
  loop
    sku_ := 'CUSTOM-' || lpad(nextval('public.custom_sku_seq')::text, 4, '0');
    exit when not exists (select 1 from public.products where sku = sku_);
  end loop;
  insert into public.products (sku, name, category, grammage_g, batch_prefix, live, needs_check, updated_by)
  values (sku_, trim(p_name), nullif(trim(p_category), ''), p_grams, pre, true,
    array['Custom product added while planning: check the SKU, MRP, category and batch prefix'], auth.uid())
  returning id into id_;
  return id_;
end;
$$;

revoke all on function public.add_custom_product(text, numeric, text, text) from public, anon;
grant execute on function public.add_custom_product(text, numeric, text, text) to authenticated;
