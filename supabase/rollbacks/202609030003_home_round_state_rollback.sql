begin;

drop function if exists public.get_home_round_state(integer, jsonb);
drop index if exists public.rounds_user_status_played_updated_id_idx;

commit;
