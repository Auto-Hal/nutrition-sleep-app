# Phase 3 Google Cloud Vision setup

Phase 3 MVP uses Google Cloud Vision synchronous `DOCUMENT_TEXT_DETECTION` for nutrition-label OCR.

## Security model

- Browser never receives the Google credential.
- The credential is stored only as a Vercel server-side secret:
  - `GOOGLE_CLOUD_VISION_API_KEY`
- The server sends the key in the `X-Goog-Api-Key` header, not in the request URL.
- Restrict the API key to **Cloud Vision API only**.
- The OCR route requires the existing authenticated app session and exact Origin validation.
- The client resizes/re-encodes the image to JPEG before upload.
- Maximum app upload is 3.2 MB; normal client target is below 3 MB.
- Images are not written to Supabase, Vercel Blob, repository files, or application logs.
- Only synchronous Cloud Vision OCR is used; asynchronous/batch storage is out of scope.

For this single-user MVP, an API-restricted server-only key is accepted. Before any wider distribution, reassess service-account / workload-identity authentication.

## Google Cloud configuration

1. Create or select a dedicated Google Cloud project for this app.
2. Attach billing.
3. Enable **Cloud Vision API**.
4. Open **APIs & Services → Credentials**.
5. Create an API key dedicated to this app.
6. Edit the key and set **API restrictions → Restrict key → Cloud Vision API**.
7. Do not place the key in Git, chat messages, screenshots, client-side JavaScript, or `NEXT_PUBLIC_*` variables.
8. Set a conservative Cloud Vision quota/budget alert appropriate for a single-user app.

## Vercel Preview

Add the API key to the `nutrition-sleep-app` Vercel project as:

- Name: `GOOGLE_CLOUD_VISION_API_KEY`
- Environment: **Preview**
- Value: the restricted Google Cloud API key
- Sensitive/secret: enabled

Redeploy the Phase 3 Preview after adding it.

## Production

Do not add Production credentials until Phase 3 Preview/device acceptance passes.

Before Production rollout:

- either create a separate Production API key or deliberately approve reuse;
- restrict it to Cloud Vision API;
- add `GOOGLE_CLOUD_VISION_API_KEY` to **Production** scope;
- confirm Preview and Production still point to their dedicated Supabase projects.

## Acceptance image

The user-provided Pasco package photo is not committed to Git.

Ground truth for that image:

- basis: `1 枚`
- energy: `180 kcal`
- protein: `5.2 g`
- fat: `2.6 g`
- carbohydrate: `34.0 g`
- salt_equivalent: `0.6 g`

The repository test uses only synthetic OCR geometry representing these values.

## Stop condition

Cloud Vision does not pass Phase 3 merely because it returns text.

Re-evaluate the provider if repeated real-device trials show any of the following:

- frequent label/value row mismatch;
- major-five nutrient extraction materially incomplete on clear Japanese labels;
- basis such as `1枚当たり` / `100g当たり` is frequently assigned incorrectly;
- unread values are converted into plausible but wrong values rather than remaining unknown;
- user correction burden remains close to manual entry.

If that occurs, compare Azure Document Intelligence Layout and a constrained Multimodal Vision fallback before Production.
