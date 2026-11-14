-- Admins switch "can send stock" on or off for a person (Team page). Logged.
create or replace function public.set_can_send(p_person uuid, p_on boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare who text;
begin
  if not public.is_admin() then raise exception 'Only admins can change this.'; end if;
  update public.people set can_send = p_on where id = p_person returning name into who;
  if who is null then raise exception 'Person not found.'; end if;
  insert into public.activity (person_id, kind, entity_type, entity_id, summary)
  values (auth.uid(), 'person_updated', 'person', p_person::text,
    (select name from public.people where id = auth.uid()) || case when p_on then ' allowed ' else ' stopped ' end || who || ' to send stock from Gala 17');
end;
$$;
revoke all on function public.set_can_send(uuid, boolean) from public, anon;
grant execute on function public.set_can_send(uuid, boolean) to authenticated;
