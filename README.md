# Nutrition / Sleep App

Current status: **Phase 1–4.5 COMPLETE / Phase 5 NEXT (CR-001 gate)**.

Implemented:
- Phase 1: Auth, Profile, server-side sessions, RLS, Preview/Production separation, 4-tab PWA foundation.
- Phase 2: Catalog, Batch, Meal/MealEntry, immutable nutrient snapshots, Today meal entry.
- Phase 3: Product ingestion, barcode scanning, Open Food Facts, Google Cloud Vision nutrition-label OCR, Product Library, provenance/source priority.
- Phase 4: Nutrition analytics, Japanese Dietary Reference Intakes 2025, 7/30/90-day trends, completeness/quality semantics, food/supplement/source-unclassified split, and drilldown.
- Phase 4.5: interaction-performance hardening, optimistic Today feedback, client navigation/prefetch, server-hydrated Today bootstrap, and Tokyo-region Vercel Functions.

Next:
- Phase 5: Sleep domain and current supported health-provider integration under CR-001.
- Phase 6: Offline/reliability/export/account lifecycle and final MVP acceptance.

See `docs/roadmap.md` and the phase-specific plans/status documents.

ENV-001 uses a new app-dedicated Supabase account with two Free projects: `nutrition-sleep-preview` and `nutrition-sleep-production`. The existing `Auto-Hal's Org` projects `study-graph` and `money-canvas` are out of scope and must not be changed, paused, or reused.

## Local setup

1. Use Node.js 24.19.0 and pnpm 10.15.0.
2. Copy `.env.example` to `.env.local` and fill server-only values for the dedicated local or Preview environment.
3. Install dependencies with `pnpm install --frozen-lockfile`.
4. Start the app with `pnpm dev`.

The browser talks only to same-origin Next.js routes. Supabase access and refresh tokens are kept server-side in encrypted `private.app_sessions` rows. They are never placed in browser storage, rendered HTML, or logs.

## Database

The migrations under `supabase/migrations/` are additive and must be replayed in filename order against an empty dedicated database. Phase 1 creates the profile/session foundation; Phase 2 adds Catalog, Batch, Meal, and immutable nutrient snapshot tables; Phase 3 adds Product/source metadata and commercial ingestion RPCs; Phase 4 adds the derived nutrition analytics RPC without persisting mutable summary state. The pgTAP checks under `supabase/tests/` cover the RLS, permission, and nutrition-analytics contracts.

`DATABASE_URL` is required by the server session repository and must point to the same environment as `SUPABASE_URL`. `APP_ALLOWED_USER_ID` identifies the one pre-provisioned Auth user, and `APP_LOGIN_RATE_LIMIT_KEY` is a server-only HMAC key for shared login throttling. The production database URL must never be configured in a Preview deployment.

## Checks

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

CI runs the same checks and a fresh local Supabase replay. Preview deployment is a separate protected job and requires environment-scoped Vercel/Supabase secrets. Production deployment is intentionally gated behind the manual `Production Deploy` workflow after database migration and Supervisor acceptance.

## Security boundaries

- `SUPABASE_PUBLISHABLE_KEY`, `DATABASE_URL`, `APP_SESSION_ENCRYPTION_KEY`, `APP_ALLOWED_USER_ID`, and `APP_LOGIN_RATE_LIMIT_KEY` are server-only.
- `service_role` and provider OAuth credentials are not used by the browser and are not committed.
- Public signup, anonymous sign-in, OTP, and Magic Link are disabled for this personal app. Password administration is local-only and interactive.
- `auth.uid()` owns every profile row; direct profile delete is disabled in Phase 1.
- `revision` protects profile updates from lost writes.
- Missing values remain `NULL`; the foundation never converts an unknown health value into zero or a normal value.
- CR-001 supersedes the old Fitbit Sleep v1.2 implementation requirement. No deprecated Fitbit provider schema has been added. Phase 5 begins only after the current supported health-provider contract is re-verified.
