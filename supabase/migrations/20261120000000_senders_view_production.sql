-- People allowed to send stock (Dashrath) can also VIEW the day's production (read-only):
-- batches, what was made / filled, workers, manufacturers and the bulk lots the batch cards show.
-- They still can't change anything (all changes go through functions that check the role).
drop policy batches_read on public.batches;
create policy batches_read on public.batches for select to authenticated using (public.not_warehouse() or public.can_send_stock());
drop policy batch_outputs_read on public.batch_outputs;
create policy batch_outputs_read on public.batch_outputs for select to authenticated using (public.not_warehouse() or public.can_send_stock());
drop policy batch_events_read on public.batch_events;
create policy batch_events_read on public.batch_events for select to authenticated using (public.not_warehouse() or public.can_send_stock());
drop policy workers_read on public.workers;
create policy workers_read on public.workers for select to authenticated using (public.not_warehouse() or public.can_send_stock());
drop policy manufacturers_read on public.manufacturers;
create policy manufacturers_read on public.manufacturers for select to authenticated using (public.not_warehouse() or public.can_send_stock());
drop policy bulk_lots_read on public.bulk_lots;
create policy bulk_lots_read on public.bulk_lots for select to authenticated using (public.not_warehouse() or public.can_send_stock());
drop policy bulk_moves_read on public.bulk_moves;
create policy bulk_moves_read on public.bulk_moves for select to authenticated using (public.not_warehouse() or public.can_send_stock());
