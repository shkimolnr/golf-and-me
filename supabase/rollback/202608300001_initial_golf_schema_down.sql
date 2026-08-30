begin;

drop trigger if exists golf_and_me_on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();
drop table if exists public.club_distance_history;
drop table if exists public.user_clubs;
drop table if exists public.round_shots;
drop table if exists public.round_holes;
drop table if exists public.rounds;
drop table if exists public.profiles;
drop function if exists public.sync_round_children_from_payload();
drop function if exists public.keep_newest_round_version();

commit;
