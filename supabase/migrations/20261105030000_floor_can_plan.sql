-- Jeet (Floor) can now plan and move stock, so he is accountable for it. Planning and stock
-- functions check can_plan() (super admin, admin, floor) instead of is_admin().
-- The Team page, the Products list, Reports and transfer sign-offs stay admin-only.

create or replace function public.can_plan()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.my_role() in ('super_admin', 'admin', 'floor'), false);
$$;
revoke all on function public.can_plan() from public, anon;
grant execute on function public.can_plan() to authenticated;

-- Rewrite each function's admin check in place (same body otherwise).
do $$
declare
  r record;
  d text;
begin
  for r in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'plan_batch', 'edit_batch', 'cancel_batch', 'copy_week', 'reopen_batch', 'remove_output',
      'take_for_filling', 'write_off_bulk', 'adjust_fg', 'add_custom_product')
  loop
    d := pg_get_functiondef(r.oid);
    d := replace(d, 'public.is_admin()', 'public.can_plan()');
    d := replace(d, 'Only admins can', 'Only the production team can');
    execute d;
  end loop;
end;
$$;

-- New contract manufacturers can be added while planning, too.
drop policy manufacturers_add on public.manufacturers;
create policy manufacturers_add on public.manufacturers for insert to authenticated with check (public.can_plan());
