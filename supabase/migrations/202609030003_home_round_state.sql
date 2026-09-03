begin;

-- Keep the first home response bounded: completed payloads never leave this
-- function, while a compact version vector still protects offline merge/save.
create index if not exists rounds_user_status_played_updated_id_idx
  on public.rounds(user_id, status, played_at_local desc, updated_at desc, id asc);

create or replace function public.get_home_round_state(
  p_limit integer default 25,
  p_cursor jsonb default null
)
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog, public, auth
as $$
  with parameters as (
    select
      greatest(1, least(coalesce(p_limit, 25), 50)) as page_limit,
      p_cursor is not null
        and jsonb_typeof(p_cursor) = 'object'
        and p_cursor ? 'updatedAt'
        and p_cursor ? 'id' as has_cursor,
      nullif(p_cursor->>'playedAt', '') as cursor_played_at,
      nullif(p_cursor->>'updatedAt', '')::timestamptz as cursor_updated_at,
      nullif(p_cursor->>'id', '') as cursor_id
  ), owned_rounds as materialized (
    select
      id, course_id, course_name, front_course_name, back_course_name, tee,
      distance_unit, played_at_local, status, completed_at, updated_at,
      entered_holes, par_recorded_holes, total_score, score_to_par,
      total_putts, putt_attempts, fir_hits, fir_attempts, gir_hits,
      gir_attempts, stats_summary
    from public.rounds
    where user_id = auth.uid()
  ), completed_rounds as (
    select owned_rounds.*
    from owned_rounds
    where status = 'completed'
  ), eligible_page as (
    select completed_rounds.*
    from completed_rounds
    cross join parameters
    where not parameters.has_cursor
      or (
        parameters.cursor_played_at is not null
        and (
          completed_rounds.played_at_local < parameters.cursor_played_at
          or completed_rounds.played_at_local is null
          or (
            completed_rounds.played_at_local = parameters.cursor_played_at
            and (
              completed_rounds.updated_at < parameters.cursor_updated_at
              or (
                completed_rounds.updated_at = parameters.cursor_updated_at
                and completed_rounds.id > parameters.cursor_id
              )
            )
          )
        )
      )
      or (
        parameters.cursor_played_at is null
        and completed_rounds.played_at_local is null
        and (
          completed_rounds.updated_at < parameters.cursor_updated_at
          or (
            completed_rounds.updated_at = parameters.cursor_updated_at
            and completed_rounds.id > parameters.cursor_id
          )
        )
      )
  ), recent_page as materialized (
    select eligible_page.*
    from eligible_page
    cross join parameters
    order by played_at_local desc nulls last, updated_at desc, id asc
    limit (select page_limit from parameters)
  ), recent_page_json as (
    select coalesce(
      jsonb_agg(to_jsonb(recent_page) order by played_at_local desc nulls last, updated_at desc, id asc),
      '[]'::jsonb
    ) as rows
    from recent_page
  ), next_cursor as (
    select jsonb_build_object(
      'playedAt', recent_page.played_at_local,
      'updatedAt', recent_page.updated_at,
      'id', recent_page.id
    ) as value
    from recent_page
    order by recent_page.played_at_local asc nulls first, recent_page.updated_at asc, recent_page.id desc
    limit 1
  ), cumulative as (
    select
      count(*)::integer as round_count,
      count(total_score)::integer as scored_round_count,
      coalesce(sum(total_score), 0)::bigint as score_sum,
      min(total_score)::integer as best_score,
      coalesce(sum(total_putts), 0)::bigint as total_putts,
      coalesce(sum(putt_attempts), 0)::bigint as putt_attempts,
      coalesce(sum(fir_hits), 0)::bigint as fir_hits,
      coalesce(sum(fir_attempts), 0)::bigint as fir_attempts,
      coalesce(sum(gir_hits), 0)::bigint as gir_hits,
      coalesce(sum(gir_attempts), 0)::bigint as gir_attempts
    from completed_rounds
  ), version_vector as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object('id', id, 'updatedAt', updated_at)
        order by updated_at desc, id
      ),
      '[]'::jsonb
    ) as rows
    from owned_rounds
  )
  select jsonb_build_object(
    'completedRounds', recent_page_json.rows,
    'completedTotal', cumulative.round_count,
    'nextCursor', (select value from next_cursor),
    'cumulativeStats', jsonb_build_object(
      'roundCount', cumulative.round_count,
      'scoredRoundCount', cumulative.scored_round_count,
      'averageScore', case when cumulative.scored_round_count > 0
        then cumulative.score_sum::numeric / cumulative.scored_round_count end,
      'bestScore', cumulative.best_score,
      'totalPutts', cumulative.total_putts,
      'puttAttempts', cumulative.putt_attempts,
      'averagePutts', case when cumulative.putt_attempts > 0
        then cumulative.total_putts::numeric / cumulative.putt_attempts end,
      'firHits', cumulative.fir_hits,
      'firAttempts', cumulative.fir_attempts,
      'girHits', cumulative.gir_hits,
      'girAttempts', cumulative.gir_attempts
    ),
    'versions', version_vector.rows
  )
  from recent_page_json
  cross join cumulative
  cross join version_vector;
$$;

revoke all on function public.get_home_round_state(integer, jsonb) from public, anon;
grant execute on function public.get_home_round_state(integer, jsonb) to authenticated;

commit;
