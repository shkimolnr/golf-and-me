# Preview diagnostics handoff — 2026-08-31

## Purpose and isolation

The browser-to-Vercel-to-Supabase diagnostics E2E test is being prepared in a
separate Supabase Preview project in the Seoul region. Production user data,
Production Supabase credentials, and Production GA4 collection are not used by
this test.

The dedicated Git branch is `codex/preview-diagnostics`. Its Vercel Preview
deployment is the only deployment intended to receive the Preview overrides.
`main` and the Production deployment were not changed by this setup.

## Completed setup

- Created the `Golf&Me Preview` Supabase project in `ap-northeast-2` (Seoul).
- Applied all eight repository migrations through
  `202608310003_round_summary_columns.sql`, including
  `202608310002_app_diagnostics.sql`.
- Kept automatic RLS enabled and did not expose newly created tables through
  the Data API by default.
- Added a distinct Preview-only `SUPABASE_SERVICE_ROLE_KEY` to Vercel. It is a
  server secret and is not exposed to the client bundle.
- Changed the existing Production/Development Supabase URL and public-key
  values so they no longer target Preview. Their values were not changed.
- Added branch-specific overrides for `codex/preview-diagnostics`:
  `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_APP_ENV=preview`,
  `VITE_ANALYTICS_ENV=preview`, `VITE_ANALYTICS_ENABLED=true`,
  `VITE_GA_MEASUREMENT_ID`, and `VITE_TEST_ACCESS_REQUEST_ENABLED=false`.

The branch-specific mechanism is important: Vercel uses it to override the
normal Preview value only for this testing branch, leaving Production and
other branches untouched.

## Not yet completed

1. Configure Preview Supabase Google sign-in and the Preview URL/redirect
   configuration. This needs a Google OAuth callback entry for the Preview
   Supabase project; the existing Production login configuration must remain
   intact.
2. Create/use a Preview-only test account and run the browser E2E scenario:
   authenticated app, induced safe request failure, automatic recovery,
   deduplication, offline queue/retry, and forbidden-field inspection.
3. Verify the test incident is deleted from Preview after the test. Do not
   exercise this scenario against Production user data.
4. Configure the diagnostic retention scheduler only after this E2E check and
   an explicit owner/operating-responsibility decision.

## GA4 status

GA4 is enabled only for the `codex/preview-diagnostics` Preview deployment.
The Preview measurement ID is stored in Vercel rather than the repository and
is restricted to the same branch. Production analytics remains unchanged.

The Preview stream belongs to the dedicated `Golf & Me` Analytics account and
the `Golf & Me Preview` property. Enhanced Measurement is disabled so the app's
consent-aware event allowlist remains the source of product analytics events.
Google Signals, advertising features, remarketing, and ad personalization are
not enabled by the app configuration.

Local consent, duplicate-event, and OAuth URL privacy checks have passed. The
remaining `TASK-038` work is to verify the deployed Preview with the real
measurement ID in GA4 DebugView, separately from operational diagnostics.

## Documentation integration requested from the control tower

When the Preview E2E run succeeds, update `README.md`, `BACKLOG.md`,
`DECISIONS.md`, and `OPERATIONS.md` with the final verified Preview URL/date,
the E2E result, the test-row cleanup, and any Google OAuth redirect decision.
Do not claim browser E2E success before then.
