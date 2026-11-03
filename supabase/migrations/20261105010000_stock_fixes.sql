-- 1. Transfer numbers are only given out once the lines are checked (no gaps from failed tries).
-- 2. An output line can't be removed if its units have already left Gala 17.

create or replace function public.send_transfer(p_lines jsonb, p_boxes int default null, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.transfers;
  l jsonb;
  have int;
  u int;
  bno text;
  n int := 0;
  total int := 0;
begin
  if not public.is_team() then raise exception 'Only the factory team can send stock.'; end if;
  -- Check every line first.
  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    u := nullif(l ->> 'units', '')::int;
    if u is null or u <= 0 then continue; end if;
    select coalesce(sum(units), 0) into have from public.fg_moves
    where location = 'gala17' and product_id = (l ->> 'product_id')::uuid
      and grammage_g is not distinct from nullif(l ->> 'grammage_g', '')::numeric
      and batch_id is not distinct from nullif(l ->> 'batch_id', '')::uuid
      and made_on = (l ->> 'made_on')::date;
    if u > have then
      raise exception 'Only % units of % are at Gala 17.', have, (select name from public.products where id = (l ->> 'product_id')::uuid);
    end if;
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'Please enter the units to send.'; end if;

  insert into public.transfers (transfer_no, boxes_sent, note, sent_by)
  values ('TN-' || lpad(nextval('public.transfer_no_seq')::text, 4, '0'), p_boxes, nullif(trim(p_note), ''), auth.uid())
  returning * into t;
  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    u := nullif(l ->> 'units', '')::int;
    if u is null or u <= 0 then continue; end if;
    select batch_no into bno from public.batches where id = nullif(l ->> 'batch_id', '')::uuid;
    insert into public.transfer_lines (transfer_id, product_id, grammage_g, batch_id, batch_no, made_on, units_sent)
    values (t.id, (l ->> 'product_id')::uuid, nullif(l ->> 'grammage_g', '')::numeric, nullif(l ->> 'batch_id', '')::uuid, bno, (l ->> 'made_on')::date, u);
    insert into public.fg_moves (location, product_id, grammage_g, batch_id, batch_no, made_on, units, kind, transfer_id, person_id) values
      ('gala17', (l ->> 'product_id')::uuid, nullif(l ->> 'grammage_g', '')::numeric, nullif(l ->> 'batch_id', '')::uuid, bno, (l ->> 'made_on')::date, -u, 'sent', t.id, auth.uid()),
      ('transit', (l ->> 'product_id')::uuid, nullif(l ->> 'grammage_g', '')::numeric, nullif(l ->> 'batch_id', '')::uuid, bno, (l ->> 'made_on')::date, u, 'sent', t.id, auth.uid());
    total := total + u;
  end loop;
  insert into public.activity (person_id, kind, entity_type, entity_id, summary)
  values (auth.uid(), 'transfer_sent', 'transfer', t.id::text,
    coalesce((select name from public.people where id = auth.uid()), 'Set-up') || ' sent ' || t.transfer_no || ' to Gala 6: ' || total || ' units' ||
    coalesce(', ' || p_boxes || ' boxes', ''));
  return t.id;
end;
$$;

create or replace function public.fg_from_output()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.batches;
  have int;
begin
  if tg_op = 'INSERT' then
    if new.made_on < date '2026-11-05' or new.units <= 0 then return new; end if;
    select * into b from public.batches where id = new.batch_id;
    insert into public.fg_moves (location, product_id, grammage_g, batch_id, batch_no, made_on, units, kind, output_id, person_id)
    values ('gala17', b.product_id, coalesce(new.grammage_g, b.grammage_g), b.id, b.batch_no, new.made_on, new.units, 'produced', new.id, auth.uid());
    return new;
  else
    if old.made_on < date '2026-11-05' or old.units <= 0 then return old; end if;
    select * into b from public.batches where id = old.batch_id;
    select coalesce(sum(units), 0) into have from public.fg_moves
    where location = 'gala17' and product_id = b.product_id and grammage_g is not distinct from coalesce(old.grammage_g, b.grammage_g)
      and batch_id = b.id and made_on = old.made_on;
    if have < old.units then
      raise exception 'Some of these units have already been sent to Gala 6 (only % left at Gala 17). Take them out of stock instead.', have;
    end if;
    insert into public.fg_moves (location, product_id, grammage_g, batch_id, batch_no, made_on, units, kind, output_id, reason, person_id)
    values ('gala17', b.product_id, coalesce(old.grammage_g, b.grammage_g), b.id, b.batch_no, old.made_on, -old.units, 'unproduced', old.id, 'Output line removed', auth.uid());
    return old;
  end if;
end;
$$;

alter sequence public.transfer_no_seq restart with 1;
