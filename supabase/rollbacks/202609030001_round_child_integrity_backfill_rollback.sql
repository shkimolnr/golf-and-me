-- Data rollback is intentionally a no-op.
-- The backfill only makes derived round_holes/round_shots agree with the
-- preserved rounds.payload source. Reintroducing the stale cache would be data
-- corruption. Restore from the preserved payload by re-running the migration.
begin;
commit;
