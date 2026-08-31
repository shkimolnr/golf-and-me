begin;

alter table public.rounds
  add column if not exists entered_holes smallint not null default 0 check (entered_holes between 0 and 18),
  add column if not exists par_recorded_holes smallint not null default 0 check (par_recorded_holes between 0 and 18),
  add column if not exists total_score smallint,
  add column if not exists score_to_par smallint,
  add column if not exists total_putts smallint,
  add column if not exists putt_attempts smallint not null default 0 check (putt_attempts between 0 and 18),
  add column if not exists fir_hits smallint not null default 0 check (fir_hits >= 0),
  add column if not exists fir_attempts smallint not null default 0 check (fir_attempts >= 0),
  add column if not exists gir_hits smallint not null default 0 check (gir_hits >= 0),
  add column if not exists gir_attempts smallint not null default 0 check (gir_attempts >= 0),
  add column if not exists stats_summary jsonb not null default '{}'::jsonb;

with hole_values as (
  select
    rounds.id,
    hole.ordinality,
    case when jsonb_typeof(hole.value->'score') = 'number' then (hole.value->>'score')::smallint end as score,
    case when jsonb_typeof(hole.value->'par') = 'number' then (hole.value->>'par')::smallint end as par,
    case
      when jsonb_typeof(hole.value->'officialPutts') = 'number' then (hole.value->>'officialPutts')::smallint
      when jsonb_typeof(hole.value->'putts') = 'number' then (hole.value->>'putts')::smallint
    end as putts,
    case when jsonb_typeof(hole.value->'fir') = 'boolean' then (hole.value->>'fir')::boolean end as fir,
    case when jsonb_typeof(hole.value->'gir') = 'boolean' then (hole.value->>'gir')::boolean end as gir
  from public.rounds
  left join lateral jsonb_array_elements(coalesce(rounds.payload->'holes', '[]'::jsonb))
    with ordinality as hole(value, ordinality) on true
), summaries as (
  select
    id,
    count(score)::smallint as entered_holes,
    count(score) filter (where par is not null)::smallint as par_recorded_holes,
    case when count(score) > 0 then sum(score)::smallint end as total_score,
    case when count(score) filter (where par is not null) > 0
      then sum(score - par) filter (where score is not null and par is not null)::smallint
    end as score_to_par,
    case when count(putts) filter (where score is not null) > 0
      then sum(putts) filter (where score is not null)::smallint
    end as total_putts,
    count(putts) filter (where score is not null)::smallint as putt_attempts,
    count(*) filter (where score is not null and par <> 3 and fir is true)::smallint as fir_hits,
    count(*) filter (where score is not null and par <> 3 and fir is not null)::smallint as fir_attempts,
    count(*) filter (where score is not null and gir is true)::smallint as gir_hits,
    count(*) filter (where score is not null and gir is not null)::smallint as gir_attempts
  from hole_values
  group by id
)
update public.rounds
set
  entered_holes = summaries.entered_holes,
  par_recorded_holes = summaries.par_recorded_holes,
  total_score = summaries.total_score,
  score_to_par = summaries.score_to_par,
  total_putts = summaries.total_putts,
  putt_attempts = summaries.putt_attempts,
  fir_hits = summaries.fir_hits,
  fir_attempts = summaries.fir_attempts,
  gir_hits = summaries.gir_hits,
  gir_attempts = summaries.gir_attempts,
  stats_summary = jsonb_build_object(
    'enteredHoles', summaries.entered_holes,
    'parRecordedHoles', summaries.par_recorded_holes,
    'missingParHoles', summaries.entered_holes - summaries.par_recorded_holes,
    'totalScore', summaries.total_score,
    'toPar', summaries.score_to_par,
    'totalPutts', summaries.total_putts,
    'puttAttempts', summaries.putt_attempts,
    'firHits', summaries.fir_hits,
    'firAttempts', summaries.fir_attempts,
    'girHits', summaries.gir_hits,
    'girAttempts', summaries.gir_attempts
  )
from summaries
where rounds.id = summaries.id;

create index if not exists rounds_user_status_played_idx
  on public.rounds(user_id, status, played_at_local desc);

commit;
