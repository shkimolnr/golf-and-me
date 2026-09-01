begin;

do $$
begin
  if pg_catalog.to_regclass('public.round_tombstones') is not null
    and exists (select 1 from public.round_tombstones)
  then
    raise exception using
      errcode = '55000',
      message = 'round_tombstones_not_empty';
  end if;
end;
$$;

drop trigger if exists rounds_00_record_tombstone_before_delete on public.rounds;
drop trigger if exists rounds_00_reject_tombstoned_write on public.rounds;
drop function if exists public.record_round_tombstone_before_delete();
drop function if exists public.reject_tombstoned_round_write();
drop table if exists public.round_tombstones;

commit;
