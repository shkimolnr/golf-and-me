-- SECURITY WARNING:
-- This restores the effective Preview privilege matrix observed before the
-- least-privilege migration. It deliberately reopens RLS-bypassing TRUNCATE
-- and unused DDL capabilities. Run only after explicit review and approval.
-- It restores effective access, not the unknown original direct ACL source;
-- PUBLIC remains revoked to avoid granting these capabilities to other roles.

begin;

grant truncate, references, trigger on table
  public.profiles,
  public.rounds,
  public.round_holes,
  public.round_shots,
  public.user_clubs,
  public.club_distance_history,
  public.app_diagnostics
to anon, authenticated, service_role;

commit;
