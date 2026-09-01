begin;

-- Runtime JWT roles do not perform schema changes. TRUNCATE bypasses RLS,
-- while REFERENCES and TRIGGER are DDL capabilities that the application does
-- not use. Revoke PUBLIC as well so an indirect PUBLIC grant cannot keep an
-- effective privilege open after the role-specific revokes.
revoke truncate, references, trigger on table
  public.profiles,
  public.rounds,
  public.round_holes,
  public.round_shots,
  public.user_clubs,
  public.club_distance_history,
  public.app_diagnostics
from public, anon, authenticated, service_role;

-- Fail the transaction if role membership or another ACL path still provides
-- any of the risky effective privileges. A failed assertion leaves the prior
-- privilege state unchanged because the migration is one transaction.
do $$
declare
  remaining_privileges integer;
begin
  select count(*)::integer
  into remaining_privileges
  from (values ('anon'), ('authenticated'), ('service_role')) as roles(role_name)
  cross join (values
    ('profiles'),
    ('rounds'),
    ('round_holes'),
    ('round_shots'),
    ('user_clubs'),
    ('club_distance_history'),
    ('app_diagnostics')
  ) as tables(table_name)
  cross join (values ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) as privileges(privilege_name)
  where pg_catalog.has_table_privilege(
    roles.role_name,
    pg_catalog.format('%I.%I', 'public', tables.table_name),
    privileges.privilege_name
  );

  if remaining_privileges <> 0 then
    raise exception 'runtime table least-privilege assertion failed: % risky effective grants remain',
      remaining_privileges;
  end if;
end;
$$;

commit;
