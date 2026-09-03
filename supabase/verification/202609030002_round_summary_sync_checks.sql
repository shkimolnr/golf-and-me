-- Verification for TASK-052 migration 202609030002.
-- Run before applying the migration. A non-zero result requires payload review;
-- do not rewrite or delete the affected rows automatically.
select count(*) as invalid_holes_container_count
from public.rounds
where payload ? 'holes'
  and jsonb_typeof(payload->'holes') <> 'array';

-- Run after applying the migration. The mismatch count must be 0.
with expected as (
  select
    id,
    public.calculate_round_stats_from_payload(payload) as summary
  from public.rounds
)
select count(*) as summary_mismatch_count
from public.rounds as rounds
join expected using (id)
where row(
  rounds.entered_holes,
  rounds.par_recorded_holes,
  rounds.total_score,
  rounds.score_to_par,
  rounds.total_putts,
  rounds.putt_attempts,
  rounds.fir_hits,
  rounds.fir_attempts,
  rounds.gir_hits,
  rounds.gir_attempts,
  rounds.stats_summary
) is distinct from row(
  (expected.summary->>'enteredHoles')::smallint,
  (expected.summary->>'parRecordedHoles')::smallint,
  case when (expected.summary->>'enteredHoles')::smallint > 0
    then (expected.summary->>'totalScore')::smallint end,
  (expected.summary->>'toPar')::smallint,
  case when (expected.summary->>'puttAttempts')::smallint > 0
    then (expected.summary->>'totalPutts')::smallint end,
  (expected.summary->>'puttAttempts')::smallint,
  (expected.summary->>'firHits')::smallint,
  (expected.summary->>'firAttempts')::smallint,
  (expected.summary->>'girHits')::smallint,
  (expected.summary->>'girAttempts')::smallint,
  expected.summary
);

-- Confirm that the trigger exists and is enabled.
select
  trigger_name,
  event_manipulation,
  action_timing
from information_schema.triggers
where event_object_schema = 'public'
  and event_object_table = 'rounds'
  and trigger_name = 'rounds_sync_summary'
order by event_manipulation;
