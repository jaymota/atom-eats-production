-- Reminder banner numbers (Jay, 27 Nov): batches not finished from earlier days, and batches from the
-- last 7 days saved without names (Made by / Filled by).
create or replace function public.pending_counts()
returns table (late int, missing int)
language sql stable security definer set search_path = '' as $$
  select
    (select count(*) from public.batches b
      where b.stage in ('planned', 'made', 'manufacturing', 'filling', 'qc', 'done') and b.planned_date < public.today_ist())::int,
    (select count(*) from public.batches b
      where b.stage <> 'cancelled' and b.planned_date >= public.today_ist() - 7
        and ((b.manufacturer_id is null and b.from_lot is null and b.made_kg is not null and cardinality(b.made_workers) = 0)
          or (not (b.manufacturer_id is not null and b.made_kg is null)
              and exists (select 1 from public.batch_outputs o where o.batch_id = b.id and coalesce(o.packed_by, '') = ''))))::int
  where public.not_warehouse();
$$;
revoke all on function public.pending_counts() from public, anon;
grant execute on function public.pending_counts() to authenticated;
