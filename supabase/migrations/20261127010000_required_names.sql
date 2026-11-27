-- Names are required (Jay, 27 Nov): Making done needs "Made by" (in-house), Filling done needs "Filled by".
-- Plus set_batch_people, to add missing names to a batch afterwards.
CREATE OR REPLACE FUNCTION public.make_done(p_id uuid, p_kg numeric, p_date date, p_workers uuid[] DEFAULT NULL::uuid[], p_note text DEFAULT NULL::text, p_keep boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  b public.batches;
  verb text;
begin
  if not public.is_team() then raise exception 'Please log in again.'; end if;
  select * into b from public.batches where id = p_id for update;
  if b is null then raise exception 'Batch not found.'; end if;
  if b.stage <> 'planned' then raise exception 'This batch is not at Planned.'; end if;
  if p_kg is null or p_kg <= 0 then raise exception 'Please enter the kg.'; end if;
  if p_date is null or p_date > public.today_ist() then raise exception 'Please choose today or an earlier date.'; end if;
  if b.manufacturer_id is null and coalesce(cardinality(public.clean_workers(p_workers)), 0) = 0 then
    raise exception 'Please choose who made it.';
  end if;
  verb := case when b.manufacturer_id is null then 'made' else 'received in bulk' end;
  update public.batches set stage = 'made', made_kg = p_kg, made_on = p_date,
    made_workers = case when b.manufacturer_id is null then public.clean_workers(p_workers) else '{}' end, updated_at = now()
  where id = b.id returning * into b;
  insert into public.batch_events (batch_id, person_id, from_stage, to_stage, note)
  values (b.id, auth.uid(), 'planned', 'made', p_kg || ' kg ' || verb || coalesce(': ' || nullif(trim(p_note), ''), ''));
  perform public.log_batch(b, 'batch_made', verb || ' ' || p_kg || ' kg of ' || public.batch_label(b));
  if p_keep then perform public.keep_in_bulk(b.id, p_note); end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fill_done(p_id uuid, p_date date, p_lines jsonb, p_to_bulk_kg numeric DEFAULT 0, p_workers uuid[] DEFAULT NULL::uuid[], p_note text DEFAULT NULL::text, p_more boolean DEFAULT false, p_input_kg numeric DEFAULT NULL::numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  b public.batches;
  l jsonb;
  w uuid[];
  names text;
  total int := 0;
  g numeric;
  u int;
  pk text;
  n int := 0;
begin
  if not public.is_team() then raise exception 'Please log in again.'; end if;
  select * into b from public.batches where id = p_id for update;
  if b is null then raise exception 'Batch not found.'; end if;
  if b.stage not in ('planned', 'made', 'manufacturing', 'filling', 'qc', 'done') then raise exception 'This batch is already closed.'; end if;
  if p_date is null or p_date > public.today_ist() then raise exception 'Please choose today or an earlier date.'; end if;
  if coalesce(p_to_bulk_kg, 0) < 0 then raise exception 'Bulk kg can''t be negative.'; end if;
  w := case when p_workers is null then b.workers else public.clean_workers(p_workers) end;
  if coalesce(cardinality(w), 0) = 0 then raise exception 'Please choose who filled it.'; end if;
  select string_agg(name, ', ' order by name) into names from public.workers where id = any(w);
  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    g := nullif((l ->> 'grams'), '')::numeric;
    u := nullif((l ->> 'units'), '')::int;
    pk := coalesce(nullif(l ->> 'pack', ''), case when g is distinct from b.grammage_g and g >= 500 then 'bulk' else b.pack_type end);
    if u is null or u <= 0 then continue; end if;
    if g is null or g <= 0 then raise exception 'Every line needs a pack size.'; end if;
    insert into public.batch_outputs (batch_id, made_on, units, output_kg, input_kg, packed_by, note, created_by, grammage_g, pack_type)
    values (b.id, p_date, u, round(u * g / 1000.0, 3), case when n = 0 then p_input_kg end, names, case when n = 0 then nullif(trim(p_note), '') end, auth.uid(), g, pk);
    total := total + u;
    n := n + 1;
  end loop;
  if n = 0 and coalesce(p_to_bulk_kg, 0) = 0 then raise exception 'Please enter the units filled.'; end if;
  update public.batches set workers = w, updated_at = now() where id = b.id;
  if coalesce(p_to_bulk_kg, 0) > 0 then
    perform public.new_lot(b, p_to_bulk_kg, p_date, 'put_aside', 'Put aside at filling');
  end if;
  if p_more then
    insert into public.batch_events (batch_id, person_id, from_stage, to_stage, note)
    values (b.id, auth.uid(), b.stage, b.stage, 'Part filled: ' || total || ' units, more to fill');
    perform public.log_batch(b, 'batch_part_moved', 'filled ' || total || ' units of ' || public.batch_label(b) || ' (more to fill)');
  else
    update public.batches set stage = 'moved', closed_at = now(), updated_at = now() where id = b.id;
    insert into public.batch_events (batch_id, person_id, from_stage, to_stage, note)
    values (b.id, auth.uid(), b.stage, 'moved', total || ' units filled' ||
      case when coalesce(p_to_bulk_kg, 0) > 0 then ', ' || p_to_bulk_kg || ' kg to bulk' else '' end);
    perform public.log_batch(b, 'batch_moved_to_inventory', 'filled ' || public.batch_label(b) || ': ' || total || ' units' ||
      case when coalesce(p_to_bulk_kg, 0) > 0 then ', ' || p_to_bulk_kg || ' kg to bulk stock' else '' end);
  end if;
end;
$function$;

create or replace function public.set_batch_people(p_id uuid, p_made uuid[] default null, p_filled uuid[] default null)
returns void language plpgsql security definer set search_path to 'public' as $fn$
declare
  b public.batches;
  names text;
  bits text[] := '{}';
begin
  if not public.is_team() then raise exception 'Please log in again.'; end if;
  select * into b from public.batches where id = p_id for update;
  if b is null then raise exception 'Batch not found.'; end if;
  if p_made is not null and cardinality(public.clean_workers(p_made)) > 0 then
    if b.made_kg is null or b.manufacturer_id is not null then raise exception 'This batch has no Making done step.'; end if;
    update public.batches set made_workers = public.clean_workers(p_made), updated_at = now() where id = b.id;
    bits := bits || 'made by';
  end if;
  if p_filled is not null and cardinality(public.clean_workers(p_filled)) > 0 then
    select string_agg(name, ', ' order by name) into names from public.workers where id = any(public.clean_workers(p_filled));
    update public.batches set workers = public.clean_workers(p_filled), updated_at = now() where id = b.id;
    update public.batch_outputs set packed_by = names where batch_id = b.id and coalesce(packed_by, '') = '';
    bits := bits || 'filled by';
  end if;
  if cardinality(bits) = 0 then raise exception 'Please choose at least one name.'; end if;
  perform public.log_batch(b, 'batch_people', 'added ' || array_to_string(bits, ' and ') || ' names to ' || public.batch_label(b));
end $fn$;
revoke all on function public.set_batch_people(uuid, uuid[], uuid[]) from public, anon;
grant execute on function public.set_batch_people(uuid, uuid[], uuid[]) to authenticated;
