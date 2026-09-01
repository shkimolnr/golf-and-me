begin;

create table public.round_tombstones (
  round_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  deleted_at timestamptz not null default clock_timestamp()
);

create index round_tombstones_user_deleted_idx
  on public.round_tombstones (user_id, deleted_at desc, round_id);

alter table public.round_tombstones enable row level security;

create policy "round_tombstones_select_own"
  on public.round_tombstones
  for select
  to authenticated
  using (auth.uid() = user_id);

-- Tombstones are server-managed. The browser can only read its own deletion
-- markers; trigger functions owned by the migration role perform every write.
revoke all on table public.round_tombstones
  from public, anon, authenticated, service_role;
grant select on table public.round_tombstones to authenticated;

create function public.record_round_tombstone_before_delete()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  lock_key bigint := pg_catalog.hashtextextended(old.id, 9049);
begin
  -- DELETE already holds or is about to hold the row lock. Do not wait behind
  -- a stale INSERT that acquired the advisory lock before checking uniqueness;
  -- fail retryably so the durable client queue can try the deletion again.
  if not pg_catalog.pg_try_advisory_xact_lock(lock_key) then
    raise exception using
      errcode = '40001',
      message = 'round_delete_retry';
  end if;

  -- During auth.users account-deletion cascade the parent row is already no
  -- longer visible. Do not create a marker that would immediately be deleted
  -- and whose FK insert would conflict with the in-progress parent deletion.
  if not exists (
    select 1 from auth.users where id = old.user_id
  ) then
    return old;
  end if;

  insert into public.round_tombstones (round_id, user_id, deleted_at)
  values (old.id, old.user_id, clock_timestamp())
  on conflict (round_id) do update
  set deleted_at = greatest(public.round_tombstones.deleted_at, excluded.deleted_at)
  where public.round_tombstones.user_id = excluded.user_id;

  if not found then
    raise exception using
      errcode = '23505',
      message = 'round_tombstone_owner_conflict',
      constraint = 'round_tombstones_pkey';
  end if;

  return old;
end;
$$;

create function public.reject_tombstoned_round_write()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.id, 9049)
  );

  if exists (
    select 1
    from public.round_tombstones
    where round_id = new.id
  ) then
    raise exception using
      errcode = '23505',
      message = 'round_tombstoned',
      constraint = 'rounds_tombstone_guard';
  end if;

  return new;
end;
$$;

revoke all on function public.record_round_tombstone_before_delete()
  from public, anon, authenticated, service_role;
revoke all on function public.reject_tombstoned_round_write()
  from public, anon, authenticated, service_role;

create trigger rounds_00_reject_tombstoned_write
before insert or update on public.rounds
for each row execute function public.reject_tombstoned_round_write();

create trigger rounds_00_record_tombstone_before_delete
before delete on public.rounds
for each row execute function public.record_round_tombstone_before_delete();

commit;
