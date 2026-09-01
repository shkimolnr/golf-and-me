begin;

-- RLS policies decide which rows an authenticated user may access, but the
-- role also needs table privileges before PostgREST can evaluate those
-- policies. Keep anonymous access disabled and grant only the operations the
-- signed-in application performs.
revoke select, insert, update, delete on table
  public.profiles,
  public.rounds,
  public.round_holes,
  public.round_shots,
  public.user_clubs,
  public.club_distance_history
from anon;

grant select, insert, update on table public.profiles to authenticated;
grant select, insert, update, delete on table
  public.rounds,
  public.round_holes,
  public.round_shots,
  public.user_clubs,
  public.club_distance_history
to authenticated;

-- club_distance_history.id is an identity column. Inserts performed by the
-- authenticated role need sequence access in addition to table INSERT.
revoke usage, select on sequence public.club_distance_history_id_seq from anon;
grant usage, select on sequence public.club_distance_history_id_seq to authenticated;

commit;
