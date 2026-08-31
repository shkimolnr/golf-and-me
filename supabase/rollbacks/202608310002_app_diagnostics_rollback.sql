begin;

drop function if exists public.purge_expired_app_diagnostics(timestamptz);
drop function if exists public.record_app_diagnostic(text, uuid, text, text, smallint, text, text, boolean, timestamptz, timestamptz, integer, timestamptz, integer);
drop table if exists public.app_diagnostics;

commit;
