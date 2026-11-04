-- Finished stock counts from 4 Nov 2026 (the team's first morning), not 5 Nov.
-- Also removes a test batch (PDSWSP58) that a test run left behind by mistake.

-- 1. Start date 4 Nov in the trigger (same body otherwise).
do $$
declare d text;
begin
  d := pg_get_functiondef('public.fg_from_output()'::regprocedure);
  d := replace(d, 'date ''2026-11-05''', 'date ''2026-11-04''');
  execute d;
end;
$$;

-- 2. Remove the leftover test batch completely (its 500 units were never real).
set local session_replication_role = replica;
delete from public.fg_moves where batch_id = (select id from public.batches where batch_no = 'PDSWSP58' and created_by is null);
delete from public.activity where entity_id = (select id::text from public.batches where batch_no = 'PDSWSP58' and created_by is null);
delete from public.batch_events where batch_id = (select id from public.batches where batch_no = 'PDSWSP58' and created_by is null);
delete from public.batch_outputs where batch_id = (select id from public.batches where batch_no = 'PDSWSP58' and created_by is null);
delete from public.batches where batch_no = 'PDSWSP58' and created_by is null;
set local session_replication_role = origin;

-- 3. Put everything already filled from 4 Nov onwards at Gala 17.
insert into public.fg_moves (at, location, product_id, grammage_g, batch_id, batch_no, made_on, units, kind, output_id, person_id)
select o.created_at, 'gala17', b.product_id, coalesce(o.grammage_g, b.grammage_g), b.id, b.batch_no, o.made_on, o.units, 'produced', o.id, o.created_by
from public.batch_outputs o join public.batches b on b.id = o.batch_id
where o.made_on >= date '2026-11-04' and o.units > 0
  and not exists (select 1 from public.fg_moves m where m.output_id = o.id and m.kind = 'produced');
