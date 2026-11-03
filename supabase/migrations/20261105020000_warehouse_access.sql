-- Warehouse logins (Zeeshan, Tejashree) only see stock transfers. The database enforces it:
-- they can still read transfers, transfer lines, products and people (names on the note),
-- but not batches, production, bulk stock, workers, manufacturers, stock lines or activity.

create or replace function public.not_warehouse()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.me_ok() and coalesce((select role from public.people where id = auth.uid()), '') <> 'warehouse';
$$;
revoke all on function public.not_warehouse() from public, anon;
grant execute on function public.not_warehouse() to authenticated;

drop policy batches_read on public.batches;
create policy batches_read on public.batches for select to authenticated using (public.not_warehouse());
drop policy batch_outputs_read on public.batch_outputs;
create policy batch_outputs_read on public.batch_outputs for select to authenticated using (public.not_warehouse());
drop policy batch_events_read on public.batch_events;
create policy batch_events_read on public.batch_events for select to authenticated using (public.not_warehouse());
drop policy bulk_lots_read on public.bulk_lots;
create policy bulk_lots_read on public.bulk_lots for select to authenticated using (public.not_warehouse());
drop policy bulk_moves_read on public.bulk_moves;
create policy bulk_moves_read on public.bulk_moves for select to authenticated using (public.not_warehouse());
drop policy workers_read on public.workers;
create policy workers_read on public.workers for select to authenticated using (public.not_warehouse());
drop policy manufacturers_read on public.manufacturers;
create policy manufacturers_read on public.manufacturers for select to authenticated using (public.not_warehouse());
drop policy fg_moves_read on public.fg_moves;
create policy fg_moves_read on public.fg_moves for select to authenticated using (public.not_warehouse());
drop policy activity_read on public.activity;
create policy activity_read on public.activity for select to authenticated using (public.not_warehouse());
