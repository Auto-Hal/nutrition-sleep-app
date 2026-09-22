# Phase 6 Acceptance Plan

Status: ASTRA REVIEW CORRECTIONS APPLIED  
Updated: 2026-09-23

## Purpose

Define objective completion gates before Phase 6 implementation begins.

Phase 6 may be declared COMPLETE only after every applicable gate below passes.

## Gate 0 — Design approval

Required:
- Astra review completed;
- all blocking Astra corrections applied to canonical design docs;
- Supervisor/user accepts the corrected design boundary;
- no Production changes.

Artifacts:
- architecture;
- reliability design;
- Product provider design;
- Nutrition review-priority design;
- account lifecycle/export design;
- UX design;
- implementation plan;
- Astra review result.

## Gate 1 — Reliability / durable idempotency

### Schema/security

Required:
- fresh migration replay;
- pgTAP;
- `private.mutation_receipts` has no direct anon/authenticated table access;
- typed mutation RPCs use narrowly scoped `SECURITY DEFINER` only where private receipt access is required;
- `auth.uid()`, ownership, fixed search_path, fully qualified objects and minimal execute grants are verified;
- no generic arbitrary mutation executor exists.

### Receipt/fingerprint

Automated:
- DB/RPC computes canonical normalized fingerprint;
- route cannot supply an alternate fingerprint algorithm;
- NULL / omitted / 0 semantics follow mutation contract;
- same operation ID + same normalized request → original success;
- same operation ID + different normalized request → `operation_content_mismatch`;
- receipt lookup occurs before revision/reference/replay-deadline checks;
- response-loss retry after create creates one DB mutation;
- response-loss retry after revisioned update returns original success rather than false 409;
- receipt result does not overwrite/refetch newer current screen state by itself.

### Retention

Automated:
- `first_applied_at` is server-generated and immutable;
- read/retry does not extend receipt TTL;
- receipt retention = 90 days;
- client automatic replay = 30 days;
- boundary-day tests at 29/30/31 and 89/90/91 days;
- no claim of exactly-once after receipt prune.

### Reference integrity

MealEntry tests:
- selection captures effective server reference fingerprint;
- Catalog nutrient update while offline → `reference_changed`;
- Batch dependency recalculation changing effective values without parent revision change → `reference_changed`;
- fingerprint comparison and MealEntry snapshot use the **same locked value set**;
- no newer values are silently snapshotted;
- `eaten_at` and target date do not shift on retry.

Fixed meal tests:
- existing meal uses expected revision;
- absent meal uses expected absence;
- latest server revision is never auto-adopted.

Queue tests:
- unresolved same-entity updates are serialized/blocked;
- expected revision is never silently rebased;
- unsynced newly-created entity cannot be referenced by a second queued entity.

### Expired/outcome resolution

Automated:
- >30d operation stops automatic mutation replay;
- receipt success lookup resolves it to synced;
- confirmed-not-applied allows user-reviewed new operation;
- unknown/pruned status displays outcome unknown;
- outcome unknown never auto-recreates operation.

## Gate 2 — Client outbox and local-storage contract

Automated:
- IndexedDB record includes owner, environment and contract version;
- Preview outbox cannot replay in Production;
- different user cannot replay outbox;
- serializer cannot persist token/password/provider credential/raw health payload;
- IDB transaction failure never shows local-saved state;
- 401 → `paused_auth`;
- incompatible contract → `blocked`;
- version migration preserves compatible pending operations;
- storage cleanup does not silently clear unresolved intent.

Logout:
- pending item count shown;
- keep/discard choice explicit;
- retained intent does not replay until same-owner login.

Preview/device:
- pending survives reload when browser storage remains available;
- no statement promises 30-day device persistence;
- cold-start offline shows local intent only, not cached authenticated health history.

## Gate 3 — Conflict semantics

Required safe 409 subtypes:

- `revision_conflict`;
- `reference_changed`;
- `operation_content_mismatch`.

Automated/UI:
- revision conflict compares server vs local;
- reapply uses a newly reviewed revision + new operation ID;
- reference changed shows old intended reference vs current reference;
- operation mismatch is blocked and not presented as ordinary reapply;
- another server change after review correctly causes another 409;
- no automatic merge / last-write-wins.

## Gate 4 — Product provenance v2 migration

### Fresh and upgrade migration

Required:
- existing Phase 3 migration is not rewritten;
- additive identity provenance columns introduced;
- old `source_*` columns retained during compatibility period;
- v2 RPC/read contract introduced safely.

Upgrade fixtures must include:
- legacy external DB Product;
- legacy label-OCR Product;
- legacy confirmed Product;
- mixed nutrient provenance;
- NULL legacy source fields;
- new v2 Product;
- old client write against v2 Product.

Must prove:
- no legacy `label_ocr` guessed into identity provenance;
- no mass conversion to `user_entered`;
- no inferred confirmation timestamp;
- legacy unproven identity exposes `legacy_unknown`;
- v2 identity provenance cannot be destroyed by old client compatibility behavior;
- historical MealEntry snapshots unchanged.

### Candidate binding

Tests:
- identity-only candidate representable;
- nutrition-only candidate representable;
- unknown nutrition representable;
- package amount does not become serving basis automatically;
- save blocked until serving basis is valid;
- stale/delayed OCR response cannot bind to a changed barcode/draft;
- stale provider response cannot combine with a newer Product draft.

### Per-nutrient tuple

Tests:
- amount/unit/provenance/quality/source URI/source observed time validated together;
- omitted != explicit NULL;
- serving-basis change updates/clears affected nutrient tuples atomically;
- external adapter never returns verified;
- verified replacement requires explicit diff/confirmation.

## Gate 5 — Yahoo / Japanese JAN coverage

Implementation-time terms gate:
- current API terms reviewed;
- attribution requirements recorded;
- stored fields/storage duration recorded;
- export/redistribution implications recorded;
- Preview/Production credential boundary recorded.

Provider tests:
- fixed endpoint;
- normalized request JAN;
- returned JAN normalized and exactly matched;
- missing returned JAN not auto-confirmed;
- mismatch not auto-confirmed;
- ambiguous/multiple candidate not auto-confirmed;
- no nutrient parsing from description text;
- timeout/rate/error categories safe;
- no raw response logging;
- no seller/price/review persistence.

Real acceptance set:
- 20–50 representative Japanese packaged products;
- OFF identity hit;
- OFF usable nutrition hit;
- Yahoo result hit;
- exact returned-JAN match;
- ambiguity/mismatch;
- OCR fallback;
- final save;
- repeat local hit;
- tap count.

Blocking correctness condition:
- **zero false automatic identity matches** in the acceptance set.

Workflow usefulness, not HTTP success rate, determines acceptance.

## Gate 6 — Nutrition review priority

### Evidence thresholds

Automated:
- 7 days: 2 evaluable insufficient / 3 eligible;
- 30 days: 6 insufficient / 7 eligible;
- 90 days: 13 insufficient / 14 eligible;
- direct amount and percent-energy axes retain separate evaluable sets;
- missing/incomplete/non-comparable days never become zero.

### EAR/RDA

Automated:
- below EAR;
- exactly EAR;
- EAR→RDA;
- exactly RDA;
- above RDA;
- displayed RDA ratio capped as designed;
- original uncapped average retained for UL/detail;
- no `充足度`/deficiency wording.

### AI

- below AI produces no deficiency score;
- AI reached displays factual reference state.

### DG

- below;
- inclusive boundary;
- exclusive boundary;
- within;
- above;
- range membership computed before distance;
- zero/missing denominator gives NULL distance;
- no custom DG high-severity threshold.

### UL

- comparable below/exact/above;
- low ordinary evidence threshold does not hide factual UL-over-average reference;
- non-comparable UL never creates automatic alert;
- UL ratio not used for cross-nutrient danger ranking.

### Multiple axes/tie-break

- opposite directions → mixed/no single increase/reduce instruction;
- all active axes remain visible;
- concern-day ratio used only for same axis/state/direction/evaluable definition;
- AI/EAR/DG are not numerically mixed;
- deterministic fallback order.

### UX/device

- page says `記録から見直す項目`, not health severity;
- `記録平均：RDAのX%`;
- evaluable-day count and data quality remain visible;
- priority item drills into nutrient→day→meal→item;
- pending/offline entries are not counted as authoritative Nutrition evidence;
- iPhone can identify top review item without inspecting every nutrient;
- iPad hierarchy identical.

## Gate 7 — Export

### Consistency

Required:
- one owner-scoped consistent DB snapshot;
- either one SQL snapshot statement or read-only REPEATABLE READ transaction;
- no independent multi-request table reads;
- no service-role bypass.

### Allowlist/content

Must include as designed:
- Profile;
- current Catalog/Product/Batch data;
- inactive/deactivated retained user rows;
- Meals;
- voided entries;
- immutable nutrient snapshots;
- currently stored active + superseded Sleep rows;
- stored child intervals;
- safe provider connection metadata;
- definitions/schema version required to interpret units/nutrients.

Must exclude:
- app sessions;
- provider credentials;
- login-rate-limit rows;
- mutation receipts;
- deletion lifecycle state;
- provider internal user ID;
- token/ciphertext/password/admin/env fields;
- disallowed embedded resource identifiers.

### Integrity

Automated:
- null vs zero preserved;
- historical snapshots exported as stored;
- Sleep export does not claim full historical revisions that are not retained;
- row/payload limit causes explicit export failure, not partial success;
- token/ciphertext/password fixtures prove non-output;
- no "fully restorable backup" claim.

Preview:
- exported JSON validates against schema/version;
- sampled rows match current Preview owner data from one snapshot.

Device:
- export can be saved/shared on iPhone/iPad.

## Gate 8 — Account deletion

### Reauthentication/security

Automated:
- no session → 401;
- Origin missing/mismatch → fail closed;
- wrong/missing password → no deletion;
- fresh password uses shared DB-backed rate limit;
- allowed user mismatch → fail closed;
- no new ordinary app session issued;
- password never persists/logs.

### Admin boundary

- Admin/service-role only in dedicated server module;
- request-body user ID ignored;
- target derived from session + allowed user;
- project/environment mismatch fails closed;
- Preview and Production admin credentials distinct;
- admin secret absent from client bundle/responses/logs;
- export/CRUD/receipt paths do not import admin client.

### Concurrency guard

Automated:
- guarded write transaction participates in lifecycle lock;
- deletion start waits for current guarded writer;
- deletion guard then blocks new mutations;
- OAuth callback blocked;
- manual/stale/morning health sync writes blocked;
- no external HTTP is performed while holding deletion DB transaction lock.

### Provider revocation

- dedicated Google Preview/Production project/client separation verified;
- active credential environment verified;
- revoke success;
- already revoked;
- timeout/unknown;
- timeout does not block approved local deletion;
- timeout not reported as success;
- revoke success + later Admin deletion failure does not leave provider status healthy connected.

### Admin hard-delete outcome

- success confirmed;
- timeout then outcome re-check;
- confirmed still exists → safe retry path;
- cannot determine → `deletion_outcome_unknown`;
- unknown is not success/not-deleted claim;
- retry/status path does not depend on cascaded app session/mutation receipt;
- short-lived deletion status contains no health/password/token payload.

### Cascade fixtures

With target user + second user:

Target removed:
- `user_profiles`;
- `catalog_items`;
- `item_nutrients`;
- `products`;
- `batches`;
- `batch_components`;
- `meals`;
- `meal_entries`;
- `meal_entry_nutrient_snapshots`;
- `health_provider_connections`;
- `sleep_sessions`;
- `sleep_stage_intervals`;
- `sleep_out_of_bed_segments`;
- `app_sessions`;
- `health_provider_credentials`;
- `mutation_receipts`;
- `account_deletion_guards`;
- other user-FK lifecycle rows.

Remain:
- second user's rows;
- global `nutrient_definitions`;
- independent rate-limit buckets under their retention rule;
- short-lived deletion status until TTL where designed.

Preflight checks any owned Supabase Storage/object resource if such storage exists.

### Device/local cleanup

Confirmed deletion:
- current device IDB cleared;
- service-worker caches cleared;
- cookie expired;
- UI distinguishes server deletion vs this-device cleanup;
- UI does not claim other offline devices/backups/export/provider original data were erased.

Production:
- no destructive smoke test on the sole live user.

## Gate 9 — PWA/version recovery

Outbox versioning is already present from Batch 6.2.

Required:
- service worker caches static/offline shell only;
- authenticated HTML/RSC/API not replayed as current health history;
- OAuth/export/delete routes excluded;
- static update does not clear IndexedDB;
- incompatible mutation contract → blocked;
- no intent silently dropped.

Device:
- update/reload with pending operation;
- cold-start offline;
- same-owner resume;
- stale authenticated data not shown as current.

## Gate 10 — Security / fresh DB

Required:
- lint PASS;
- typecheck PASS;
- tests PASS;
- env validation PASS;
- build PASS;
- fresh Supabase start/reset PASS;
- pgTAP PASS;
- RLS/privilege review;
- no new secret in repository history;
- Vercel Preview READY;
- safe logs: no raw health payload/token/password/export/admin-secret content.

## Gate 11 — Full Preview acceptance

Required regression coverage:

- Today meal input;
- snacks/custom;
- skip/unskip;
- void;
- Catalog/Batch/Product;
- barcode/OFF/Yahoo/OCR/manual path;
- Nutrition review priority;
- Phase 5 Sleep;
- export;
- account settings;
- pending/offline states;
- authentication pause;
- all conflict subtypes;
- version recovery;
- no Phase 1–5 regression.

## Gate 12 — iPhone / iPad acceptance

Both form factors:

- navigation;
- Today write paths;
- pending/retry/conflict;
- barcode/OCR;
- Nutrition review hierarchy;
- Sleep;
- Settings/Library;
- export;
- account deletion UI through safe acceptance boundary;
- offline shell/version recovery;
- accessibility/touch targets.

## Gate 13 — Production rollout

Only after Phase 5 Production boundary permits it:

1. approved Phase 6 merge;
2. Production DB migrations;
3. Production environment/admin/provider configuration;
4. provider attribution/config;
5. Production deploy;
6. non-destructive runtime smoke;
7. log/security review.

No destructive sole-account deletion test.

## Gate 14 — MVP COMPLETE

May be declared only when:

- Phase 5 COMPLETE;
- all Phase 6 gates pass;
- no open blocking security/data-integrity defect;
- Supervisor/user explicitly accepts MVP completion.

## Post-MVP

Remain separate unless later promoted:

- native/hybrid iOS;
- VisionKit migration;
- BodyMeasurement history/trends;
- clinical interpretation;
- public multi-user rollout;
- full import/restore backup.
