# Nutrition / Sleep App — Phase 1 Foundation

This repository contains the approved Phase 1 foundation and the Phase 2 meal/catalog entry foundation for the nutrition and sleep management app. The Phase 2 branch adds owner-scoped Catalog, Batch, Meal CRUD and immutable nutrient snapshots. Nutrition analytics, barcode/OCR, Fitbit/Google Health integration, offline sync, and export remain in later phases.

ENV-001 uses a new app-dedicated Supabase account with two Free projects: `nutrition-sleep-preview` and `nutrition-sleep-production`. The existing `Auto-Hal's Org` projects `study-graph` and `money-canvas` are out of scope and must not be changed, paused, or reused.

## Local setup

1. Use Node.js 24.19.0 and pnpm 10.15.0.
2. Copy `.env.example` to `.env.local` and fill server-only values for the dedicated local or Preview environment.
3. Install dependencies with `pnpm install --frozen-lockfile`.
4. Start the app with `pnpm dev`.

The browser talks only to same-origin Next.js routes. Supabase access and refresh tokens are kept server-side in encrypted `private.app_sessions` rows. They are never placed in browser storage, rendered HTML, or logs.

## Database

The migrations under `supabase/migrations/` are additive and must be replayed in filename order against an empty dedicated database. Phase 1 creates the profile/session foundation; Phase 2 adds Catalog, Batch, Meal, and immutable nutrient snapshot tables. The pgTAP checks under `supabase/tests/` cover the RLS and permission contracts.

`DATABASE_URL` is required by the server session repository and must point to the same environment as `SUPABASE_URL`. `APP_ALLOWED_USER_ID` identifies the one pre-provisioned Auth user, and `APP_LOGIN_RATE_LIMIT_KEY` is a server-only HMAC key for shared login throttling. The production database URL must never be configured in a Preview deployment.

## Checks

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

CI runs the same checks and a fresh local Supabase replay. Preview deployment is a separate protected job and requires environment-scoped Vercel/Supabase secrets. Production promotion is intentionally not automatic.

## Security boundaries

- `SUPABASE_PUBLISHABLE_KEY`, `DATABASE_URL`, `APP_SESSION_ENCRYPTION_KEY`, `APP_ALLOWED_USER_ID`, and `APP_LOGIN_RATE_LIMIT_KEY` are server-only.
- `service_role` and provider OAuth credentials are not used by the browser and are not committed.
- Public signup, anonymous sign-in, OTP, and Magic Link are disabled for this personal app. Password administration is local-only and interactive.
- `auth.uid()` owns every profile row; direct profile delete is disabled in Phase 1.
- `revision` protects profile updates from lost writes.
- Missing values remain `NULL`; the foundation never converts an unknown health value into zero or a normal value.
- CR-001 supersedes the old Fitbit Sleep v1.2 implementation requirement. No Fitbit or Google Health provider schema is included here.
