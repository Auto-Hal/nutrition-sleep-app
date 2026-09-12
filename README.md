# Nutrition / Sleep App — Phase 1 Foundation

This repository contains the approved Phase 1 foundation for the Astra nutrition and sleep management app. The current scope is authentication, profile storage, four-tab navigation, Supabase migrations/RLS, and the CI/Preview handoff. Meal logging, catalog/OCR, nutrition analytics, Fitbit/Google Health integration, offline sync, and export remain in later phases.

## Local setup

1. Use Node.js 24.19.0 and pnpm 10.15.0.
2. Copy `.env.example` to `.env.local` and fill server-only values for the dedicated local or Preview environment.
3. Install dependencies with `pnpm install --frozen-lockfile`.
4. Start the app with `pnpm dev`.

The browser talks only to same-origin Next.js routes. Supabase access and refresh tokens are kept server-side in encrypted `private.app_sessions` rows. They are never placed in browser storage, rendered HTML, or logs.

## Database

The migration under `supabase/migrations/` is the complete Phase 1 schema. It creates only `public.user_profiles` and the server-only `private.app_sessions` table. Run all migrations against an empty dedicated database before using the app. The pgTAP checks under `supabase/tests/phase1_rls.sql` cover the intended RLS and permission contract.

`DATABASE_URL` is required by the server session repository and must point to the same environment as `SUPABASE_URL`. The production database URL must never be configured in a Preview deployment.

## Checks

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

CI runs the same checks and a fresh local Supabase replay. Preview deployment is a separate protected job and requires environment-scoped Vercel/Supabase secrets. Production promotion is intentionally not automatic.

## Security boundaries

- `SUPABASE_PUBLISHABLE_KEY`, `DATABASE_URL`, and `APP_SESSION_ENCRYPTION_KEY` are server-only.
- `service_role` and provider OAuth credentials are not used by the browser and are not committed.
- `auth.uid()` owns every profile row; direct profile delete is disabled in Phase 1.
- `revision` protects profile updates from lost writes.
- Missing values remain `NULL`; the foundation never converts an unknown health value into zero or a normal value.
- CR-001 supersedes the old Fitbit Sleep v1.2 implementation requirement. No Fitbit or Google Health provider schema is included here.
