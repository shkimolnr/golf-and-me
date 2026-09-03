-- Rollback for TASK-052 migration 202609030002.
begin;

drop trigger if exists rounds_sync_summary on public.rounds;
drop function if exists public.sync_round_summary_from_payload();
drop function if exists public.calculate_round_stats_from_payload(jsonb);

-- Existing summary values remain as valid derived cache. The rollback does not
-- rewrite rounds.payload or attempt to reconstruct previous client cache values.
commit;
