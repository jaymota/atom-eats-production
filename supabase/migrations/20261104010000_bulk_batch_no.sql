-- A batch filled from bulk stock keeps its lot's batch number (for tracing), so batch numbers
-- only have to be unique among batches that weren't filled from bulk.
drop index public.batches_batch_no_unique;
create unique index batches_batch_no_unique on public.batches (upper(batch_no)) where batch_no is not null and from_lot is null;
