begin;

create or replace function public.calculate_round_stats_from_payload(p_payload jsonb)
returns jsonb
language sql
immutable
security invoker
set search_path = pg_catalog, public
as $$
  with holes as (
    select
      hole.ordinality,
      case when jsonb_typeof(hole.value->'score') = 'number'
        then (hole.value->>'score')::smallint end as score,
      case when jsonb_typeof(hole.value->'par') = 'number'
        then (hole.value->>'par')::smallint end as par,
      case
        when jsonb_typeof(hole.value->'officialPutts') = 'number'
          then (hole.value->>'officialPutts')::smallint
        when jsonb_typeof(hole.value->'putts') = 'number'
          then (hole.value->>'putts')::smallint
      end as putts,
      case when jsonb_typeof(hole.value->'penaltyStrokes') = 'number'
        then (hole.value->>'penaltyStrokes')::smallint else 0 end as penalty_strokes,
      case when jsonb_typeof(hole.value->'obCount') = 'number'
        then (hole.value->>'obCount')::smallint else 0 end as ob_count,
      case when jsonb_typeof(hole.value->'penaltyCount') = 'number'
        then (hole.value->>'penaltyCount')::smallint else 0 end as penalty_count,
      case when jsonb_typeof(hole.value->'fir') = 'boolean'
        then (hole.value->>'fir')::boolean end as fir,
      case when jsonb_typeof(hole.value->'gir') = 'boolean'
        then (hole.value->>'gir')::boolean end as gir
    from jsonb_array_elements(coalesce(p_payload->'holes', '[]'::jsonb))
      with ordinality as hole(value, ordinality)
  ), scored as (
    select * from holes where score is not null
  ), aggregate_values as (
    select
      count(*)::integer as entered_holes,
      count(par)::integer as par_recorded_holes,
      coalesce(sum(score), 0)::integer as total_score,
      coalesce(sum(par) filter (where par is not null), 0)::integer as total_par,
      case when count(par) > 0
        then sum(score - par) filter (where par is not null)::integer end as score_to_par,
      coalesce(sum(score) filter (where ordinality <= 9), 0)::integer as front_score,
      coalesce(sum(score) filter (where ordinality > 9 and ordinality <= 18), 0)::integer as back_score,
      case when count(par) filter (where ordinality <= 9) > 0
        then sum(score - par) filter (where ordinality <= 9 and par is not null)::integer end as front_to_par,
      case when count(par) filter (where ordinality > 9 and ordinality <= 18) > 0
        then sum(score - par) filter (where ordinality > 9 and ordinality <= 18 and par is not null)::integer end as back_to_par,
      count(*) filter (where par is not null and score - par = 0)::integer as par_count,
      count(*) filter (where par is not null and score - par = 1)::integer as bogey_count,
      count(*) filter (where par is not null and score - par = 2)::integer as double_bogey_count,
      count(*) filter (where par is not null and score - par >= 3)::integer as triple_plus_count,
      count(*) filter (where score = 1)::integer as hole_in_one_count,
      coalesce(sum(putts) filter (where putts is not null), 0)::integer as total_putts,
      count(putts)::integer as putt_attempts,
      count(*) filter (where putts = 1)::integer as one_putt_count,
      count(*) filter (where putts = 2)::integer as two_putt_count,
      count(*) filter (where putts >= 3)::integer as three_plus_putt_count,
      coalesce(sum(penalty_strokes), 0)::integer as penalty_strokes,
      coalesce(sum(ob_count), 0)::integer as ob_count,
      coalesce(sum(penalty_count), 0)::integer as penalty_count,
      count(*) filter (where par is distinct from 3 and fir is true)::integer as fir_hits,
      count(*) filter (where par is distinct from 3 and fir is not null)::integer as fir_attempts,
      count(*) filter (where gir is true)::integer as gir_hits,
      count(*) filter (where gir is not null)::integer as gir_attempts
    from scored
  ), outcome_counts as (
    select
      case when score - par >= 3 then 'triplePlus' else (score - par)::text end as key,
      case when score - par >= 3 then 3 else score - par end as value,
      count(*)::integer as count
    from scored
    where par is not null
    group by 1, 2
  ), outcomes as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'key', key,
          'value', value,
          'label', case
            when key = 'triplePlus' then '트리플+'
            when value <= -4 then value::text
            when value = -3 then '알바트로스'
            when value = -2 then '이글'
            when value = -1 then '버디'
            when value = 0 then '파'
            when value = 1 then '보기'
            else '더블'
          end,
          'count', count
        ) order by value
      ),
      '[]'::jsonb
    ) as score_outcomes
    from outcome_counts
  )
  select jsonb_build_object(
    'enteredHoles', aggregates.entered_holes,
    'parRecordedHoles', aggregates.par_recorded_holes,
    'missingParHoles', aggregates.entered_holes - aggregates.par_recorded_holes,
    'totalScore', aggregates.total_score,
    'totalPar', aggregates.total_par,
    'toPar', aggregates.score_to_par,
    'frontScore', aggregates.front_score,
    'backScore', aggregates.back_score,
    'frontToPar', aggregates.front_to_par,
    'backToPar', aggregates.back_to_par,
    'parCount', aggregates.par_count,
    'bogeyCount', aggregates.bogey_count,
    'doubleBogeyCount', aggregates.double_bogey_count,
    'triplePlusCount', aggregates.triple_plus_count,
    'scoreOutcomes', outcomes.score_outcomes,
    'holeInOneCount', aggregates.hole_in_one_count,
    'totalPutts', aggregates.total_putts,
    'puttAttempts', aggregates.putt_attempts,
    'averagePutts', case when aggregates.putt_attempts > 0
      then aggregates.total_putts::numeric / aggregates.putt_attempts end,
    'onePuttCount', aggregates.one_putt_count,
    'twoPuttCount', aggregates.two_putt_count,
    'threePlusPuttCount', aggregates.three_plus_putt_count,
    'penaltyStrokes', aggregates.penalty_strokes,
    'obCount', aggregates.ob_count,
    'penaltyCount', aggregates.penalty_count,
    'firHits', aggregates.fir_hits,
    'firAttempts', aggregates.fir_attempts,
    'girHits', aggregates.gir_hits,
    'girAttempts', aggregates.gir_attempts
  )
  from aggregate_values as aggregates
  cross join outcomes;
$$;

create or replace function public.sync_round_summary_from_payload()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  summary jsonb;
begin
  summary := public.calculate_round_stats_from_payload(new.payload);
  new.entered_holes := (summary->>'enteredHoles')::smallint;
  new.par_recorded_holes := (summary->>'parRecordedHoles')::smallint;
  new.total_score := case when new.entered_holes > 0
    then (summary->>'totalScore')::smallint end;
  new.score_to_par := (summary->>'toPar')::smallint;
  new.total_putts := case when (summary->>'puttAttempts')::smallint > 0
    then (summary->>'totalPutts')::smallint end;
  new.putt_attempts := (summary->>'puttAttempts')::smallint;
  new.fir_hits := (summary->>'firHits')::smallint;
  new.fir_attempts := (summary->>'firAttempts')::smallint;
  new.gir_hits := (summary->>'girHits')::smallint;
  new.gir_attempts := (summary->>'girAttempts')::smallint;
  new.stats_summary := summary;
  return new;
end;
$$;

drop trigger if exists rounds_sync_summary on public.rounds;
create trigger rounds_sync_summary
before insert or update of payload on public.rounds
for each row execute function public.sync_round_summary_from_payload();

-- Backfill from the preserved source payload. Only rows whose derived cache is
-- different are updated, and payload itself is never rewritten.
with expected as (
  select
    id,
    public.calculate_round_stats_from_payload(payload) as summary
  from public.rounds
)
update public.rounds as rounds
set
  entered_holes = (expected.summary->>'enteredHoles')::smallint,
  par_recorded_holes = (expected.summary->>'parRecordedHoles')::smallint,
  total_score = case when (expected.summary->>'enteredHoles')::smallint > 0
    then (expected.summary->>'totalScore')::smallint end,
  score_to_par = (expected.summary->>'toPar')::smallint,
  total_putts = case when (expected.summary->>'puttAttempts')::smallint > 0
    then (expected.summary->>'totalPutts')::smallint end,
  putt_attempts = (expected.summary->>'puttAttempts')::smallint,
  fir_hits = (expected.summary->>'firHits')::smallint,
  fir_attempts = (expected.summary->>'firAttempts')::smallint,
  gir_hits = (expected.summary->>'girHits')::smallint,
  gir_attempts = (expected.summary->>'girAttempts')::smallint,
  stats_summary = expected.summary
from expected
where rounds.id = expected.id
  and row(
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

commit;
