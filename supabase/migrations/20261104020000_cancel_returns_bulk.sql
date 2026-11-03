-- Cancelling a batch that was taken from bulk stock puts the unfilled kg back into its lot.
create or replace function public.cancel_batch(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.batches;
  back numeric;
begin
  if not public.is_admin() then raise exception 'Only admins can cancel batches.'; end if;
  if nullif(trim(p_reason), '') is null then raise exception 'Please give a reason.'; end if;
  select * into b from public.batches where id = p_id for update;
  if b is null then raise exception 'Batch not found.'; end if;
  if b.stage in ('moved', 'cancelled') then raise exception 'This batch is already closed.'; end if;
  if b.from_lot is not null then
    back := round(coalesce(b.made_kg, 0) - coalesce((select sum(output_kg) from public.batch_outputs where batch_id = b.id), 0), 3);
    if back > 0 then
      insert into public.bulk_moves (lot_id, kg, kind, batch_id, reason, person_id) values (b.from_lot, back, 'return', b.id, trim(p_reason), auth.uid());
    end if;
  end if;
  update public.batches set stage = 'cancelled', cancel_reason = trim(p_reason), closed_at = now(), updated_at = now() where id = b.id;
  insert into public.batch_events (batch_id, person_id, from_stage, to_stage, note)
  values (b.id, auth.uid(), b.stage, 'cancelled', trim(p_reason) || case when back > 0 then ' (' || back || ' kg back to bulk stock)' else '' end);
  perform public.log_batch(b, 'batch_cancelled', 'cancelled ' || public.batch_label(b) || ': ' || trim(p_reason));
end;
$$;
