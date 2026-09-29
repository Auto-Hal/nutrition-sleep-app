# Phase 5 Preview Google Health OAuth setup

Status: **EXTERNAL CONFIGURATION REQUIRED**

This document contains the exact Preview configuration needed to move Phase 5 from fixture acceptance to real Google Health acceptance. No secret values belong in Git.

## Google Cloud

Create a dedicated Google Cloud project for Preview:

`nutrition-sleep-preview`

Do not reuse Study Graph, money-canvas, Production, or an unrelated project.

Enable the Google Health API and configure the OAuth consent screen for Testing.

Add the app owner's Google account as a test user.

Create an OAuth 2.0 **Web application** client.

### Authorized redirect URI

Use the stable Phase 5 branch alias so new Preview deployments do not require a new OAuth client:

`https://nutrition-sleep-app-git-phase-5-sleep-foundation-tsuno2.vercel.app/api/health/google/callback`

The URI must match exactly.

### Requested scope

Only:

`https://www.googleapis.com/auth/googlehealth.sleep.readonly`

Do not add activity, profile, heart-rate, SpO2, respiratory-rate, temperature, or write scopes for the Phase 5 MVP.

## Vercel Preview environment

Set these values for **Preview only**:

- `GOOGLE_HEALTH_CLIENT_ID` — Google OAuth Web client ID
- `GOOGLE_HEALTH_CLIENT_SECRET` — Google OAuth Web client secret
- `GOOGLE_HEALTH_REDIRECT_URI` — exact URI above
- `PROVIDER_TOKEN_ENCRYPTION_KEY` — separate random secret, at least 32 bytes

`CRON_SECRET` is not required to test manual/stale-on-open sync in Preview because Vercel Cron does not automatically execute on Preview deployments. It is required before Production cron acceptance.

Do not expose any of these values through a `NEXT_PUBLIC_*` variable.

## Secret generation

Generate `PROVIDER_TOKEN_ENCRYPTION_KEY` with a cryptographically secure random generator, for example:

`openssl rand -base64 48`

A separate value must later be generated for `CRON_SECRET`.

Do not reuse `APP_SESSION_ENCRYPTION_KEY`.

## Preview acceptance after configuration

1. Redeploy the Phase 5 Preview so the new environment values are present.
2. Sign in to the Preview app.
3. Open Sleep.
4. Select **Google Healthを接続**.
5. Confirm the consent request contains only Sleep read access.
6. Complete Google OAuth.
7. Verify Google Health identity is persisted and credentials are present only in `private.health_provider_credentials`.
8. Verify the initial 14-day sync.
9. Repeatedly use manual sync to advance the resumable historical backfill until the 90-day target is complete.
10. Verify Sleep 7 / 30 / 90-day views and missing-data semantics.
11. Verify stale-on-open behavior.
12. Exercise disconnect and re-connect / re-auth behavior.
13. Inspect runtime logs for token or raw Sleep payload leakage.

Real wearable STAGES acceptance remains a later hardware gate.
