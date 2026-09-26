# Phase 6.11 — Full MVP acceptance

Updated: 2026-09-26

Status: **IN PROGRESS — automated/hosted gates substantially green; device/external/rollout gates remain**

## Purpose

Phase 6.11 is the integration acceptance phase for the complete Nutrition + Sleep MVP.
No new product semantics are introduced here.

The acceptance target is the stacked implementation through:

- Phase 5 real wearable Sleep foundation;
- Phase 6.1 reliability server primitives;
- Phase 6.2 durable IndexedDB outbox/versioning;
- Phase 6.3 revision conflicts;
- Phase 6.4 Product provenance v2;
- Phase 6.5 Yahoo exact-JAN identity fallback;
- Phase 6.6 Nutrition review-priority derivation;
- Phase 6.7 Nutrition review UX;
- Phase 6.8 consistent export;
- Phase 6.9 account deletion/lifecycle guard;
- Phase 6.10 PWA shell/version recovery.

Production remains untouched until the rollout gate is explicitly approved.

## Automated stack acceptance

### Build / tests

Latest Phase 6.10 implementation and final status heads passed:

- lint: PASS;
- typecheck: PASS;
- unit tests: PASS;
- environment validation: PASS;
- Next.js production build: PASS;
- fresh Supabase start/reset: PASS;
- pgTAP: PASS;
- Preview workflow: PASS;
- Vercel Preview deployment: READY.

The full current test suite includes Phase 1–5 regression plus Phase 6 reliability,
Product, Nutrition, export, account lifecycle, and PWA/version-recovery contracts.

### Hosted Preview database

Current Hosted Preview migration chain includes:

- Phase 1–5 schema;
- Product provenance v2;
- reliability server primitives;
- outbox reference list;
- revision conflicts;
- Product reliability;
- consistent export;
- account lifecycle.

Phase 6.10 requires no database migration.

Current Hosted Preview contains both Nutrition state and the real-wearable Sleep acceptance state.
The real Sleep observation remains normalized without duplication and the Google Health connection
remains connected. Account deletion guard/status rows are empty because the real user was
intentionally not deleted.

### Runtime health

Recent Preview runtime error/fatal check returned no matching errors in the inspected 24-hour window.

## Security / authorization acceptance

Supabase Security Advisor was reviewed on 2026-09-26.

Observed known findings:

- private server-only tables with RLS enabled and intentionally no end-user policies;
- public SECURITY DEFINER RPCs callable by authenticated users;
- leaked-password protection disabled in the current project.

Additional direct verification:

- all 14 public user-data tables have RLS enabled;
- no public table is SELECT/INSERT accessible to `anon`;
- none of the public SECURITY DEFINER RPCs are executable by `anon`;
- every authenticated-executable public SECURITY DEFINER RPC references `auth.uid()`;
- every public SECURITY DEFINER RPC has an explicit `search_path` configuration.

The SECURITY DEFINER findings are therefore treated as intentional single-user RPC surfaces,
not an anonymous authorization bypass. They remain a security-review item if this application is
ever generalized to public multi-user use.

Leaked-password protection remains a Production rollout configuration item rather than a Phase 6
data-integrity implementation defect.

## 6.11-A checkpoint — security / logs / stack integrity

Status: **PASS — Production Auth hardening item carried to rollout gate**

Verified on the current `phase/6.11-full-mvp-acceptance` head:

- branch is based on the final Phase 6.10 head and contains acceptance-documentation changes only;
- latest CI and Preview workflow are green;
- Phase 5 status documentation is byte-identical to the Phase 5 branch copy, so no Phase 5 code or documentation port is required;
- Hosted Preview migration chain ends at `phase6_account_lifecycle`; Phase 6.10/6.11 add no database migration;
- all 14 public tables have RLS enabled;
- `anon` has no public table DML grants;
- 28 public SECURITY DEFINER RPCs are authenticated-only, all reference `auth.uid()`, and all define an explicit `search_path`;
- six `private` tables have no `authenticated` table grants;
- recent Preview runtime errors are empty;
- targeted Preview log searches found no occurrences of access/refresh token labels, service-role labels, password/Authorization/Bearer material, or raw health/payload logging;
- inspected Google Health, export, Yahoo and account-deletion server paths log only bounded status/stage metadata and do not log token values, passwords, raw health payloads, export bodies or admin secrets.

Supabase Auth leaked-password protection remains disabled. Supabase documents this as a project-level Auth hardening feature that rejects passwords known from breach corpora. It is therefore **not a Phase 6 implementation/data-integrity blocker**, but enabling/verifying it is a **required Production rollout configuration check** before Gate 13 is accepted.

Performance Advisor still reports unused-index INFO items only; no index is removed during acceptance.

## Phase 5 / Sleep

PASS in Preview:

- real wearable obtained;
- real STAGES sleep measured and synchronized;
- normalized Sleep session stored;
- Awake / Light / Deep / REM stage intervals stored;
- repeated reconciliation did not create duplicate Sleep sessions;
- missing days are not treated as zero;
- real Sleep data is included correctly in Phase 6.8 export;
- no token/provider-internal/raw health payload leakage in export.

Phase 5 Production rollout remains intentionally deferred to the shared rollout gate.

## Nutrition / meal regression

Covered by current automated integration/contract suite:

- Today meal input;
- custom/snack path;
- fixed-meal state changes;
- skip/unskip semantics;
- MealEntry void;
- Catalog create/update/active state;
- Batch create/update;
- reliable receipt replay;
- owner/environment binding;
- authentication pause;
- revision/reference/content conflicts;
- Product reliable create/update;
- authoritative Nutrition review derivation;
- 7/30/90 evidence thresholds;
- EAR/RDA/AI/DG/UL semantics;
- mixed-axis behavior;
- no overall score.

Hosted Preview retains existing Nutrition rows after Phase 6.9 migration.

## 6.11-B checkpoint — Full Preview functional regression

Status: **PASS for automated + Hosted Preview regression; external Yahoo and physical-device interactions remain in 6.11-C/D**

Current acceptance head after regression fix:

- application / unit / contract CI: PASS;
- fresh DB replay / pgTAP: PASS through the CI workflow;
- Preview workflow: PASS;
- Vercel Preview deployment: READY;
- no error/fatal runtime log entries observed for the latest Preview deployment in the inspected window.

Regression coverage includes:

- Today fixed/custom meal entry and skip/unskip behavior;
- authoritative success refresh and optimistic/provisional Today nutrition;
- Catalog / Batch / Product write contracts;
- barcode normalization, OFF resolution, OCR fallback contracts, and Yahoo exact-JAN semantics;
- reliable outbox owner/environment binding, auth pause, retry, receipt recovery, expiration and conflict subtypes;
- same-entity serialization without unsafe auto-rebase;
- Nutrition 7/30/90 thresholds, EAR/RDA/AI/DG/UL semantics, mixed axes and no overall score;
- Sleep missing-day semantics, normalization/reconciliation and existing real-wearable Hosted state;
- versioned export allowlist and owner scoping;
- account deletion lifecycle / guard / fail-closed Admin boundary;
- PWA static-shell/version-recovery contracts.

One real acceptance defect was found and corrected in this checkpoint:

- before the fix, reloading Today restored the persisted IndexedDB MealEntry operation itself but did **not** reconstruct the provisional nutrition delta, so the temporary energy display could disappear after reload;
- Today now rehydrates current-date MealEntry provisional nutrition from owner/environment-bound IndexedDB records in `pending`, `in_flight`, `failed`, and `paused_auth` states;
- terminal `conflict` / `expired` / `blocked` states remain excluded from provisional nutrition;
- if the referenced active Catalog item is unavailable during rehydration, the pending entry is retained as nutrition-unknown rather than inventing a value;
- regression coverage was added and the full CI/Preview workflow passed after the fix.

Hosted Preview state remained intact after this application-only correction:

- meals: 6;
- meal entries: 14 active / 14 total;
- Catalog items: 2;
- Products: 1;
- normalized Sleep sessions: 1 active / 1 total;
- Sleep stage intervals: 22;
- invalid stage intervals: 0;
- stage overlaps: 0;
- Google Health connections: 1 connected / 1 total;
- deletion guards / operations: 0 / 0.

Remaining interactive checks are intentionally separated:

- real Japanese JAN/provider observations → 6.11-C;
- iPhone/iPad, camera/OCR, export share/save, deletion safe boundary, offline/update/pending recovery → 6.11-D.

## Product / JAN / OCR

Implementation acceptance is green:

- local-first resolution;
- OFF before Yahoo;
- Yahoo exact returned-JAN equality required;
- ambiguous identity requires explicit selection;
- Yahoo is identity-only and never nutrition authority;
- no raw Yahoo response persistence;
- OCR/manual remains nutrient fallback;
- Product provenance v2 and reliable write/conflict behavior are tested.

External Yahoo/JAN acceptance is now complete in 6.11-C.

Remaining Product/OCR interaction checks belong to physical-device acceptance in 6.11-D:

- camera/OCR interaction;
- manual fallback interaction;
- final save/repeat-local-hit usability.

## 6.11-C checkpoint — Yahoo/JAN external acceptance

Status: **PASS**

Completed on 2026-09-26 against the protected Vercel Preview runtime with the real Preview
`YAHOO_SHOPPING_CLIENT_ID` configured server-side.

Live acceptance result:

- representative Japanese JAN samples: **20**;
- samples with an exact returned JAN candidate: **20 / 20**;
- single exact candidate: **1**;
- ambiguous exact-JAN candidate sets: **19**;
- not found: **0**;
- provider unavailable: **0**;
- ambiguous results remain non-automatic and require explicit user selection;
- exact returned-JAN equality remains mandatory before a Yahoo identity is eligible;
- Yahoo remains identity-only; Yahoo nutrition is never adopted;
- no raw Yahoo provider payload was returned by the acceptance surface or persisted;
- existing automated contracts continue to cover returned-JAN mismatch rejection, ambiguous handling,
  OCR fallback, provenance, and nutrition non-adoption.

The live run emitted only bounded acceptance metadata and did not print the Client ID or raw Yahoo
responses. CI and Preview workflow both passed after the live acceptance.

The temporary Preview-only acceptance endpoint and temporary workflow hooks used to exercise the
server-only credential were removed after the evidence was captured, so no acceptance endpoint is
carried forward toward Production. The reusable local acceptance script remains as a non-runtime
test utility.

No database migration, Production deployment, or user-data mutation was required.

## 6.11-D checkpoint — iPhone / iPad / PWA device acceptance

Status: **IN PROGRESS**

Acceptance is intentionally split into small device checkpoints so failures are isolated and repeatable.

### D1 — iPhone baseline / navigation — PASS

Confirmed by physical iPhone acceptance on 2026-09-26:

- exact Phase 6.11 Preview opened successfully in iPhone Safari;
- Today / Nutrition / Sleep / Settings navigation worked;
- Settings → Library was reachable;
- no obvious clipping, horizontal overflow, unusable fixed footer/header, or blocked primary action was observed;
- normal Safari reload returned to a usable state;
- no red error state, blank page, or infinite-loading failure was observed.

### D2 — iPhone Today / Product / OCR

- add an ordinary meal entry;
- add a snack/custom meal path;
- verify skip/unskip and void paths;
- scan a real barcode;
- observe local → OFF → Yahoo → OCR/manual behavior as applicable;
- if Yahoo returns multiple exact-JAN identities, verify no automatic identity selection occurs;
- verify save and repeat local-hit behavior;
- verify pending/retry presentation remains understandable.

### D3 — iPhone Nutrition / Sleep / Settings / export

- Nutrition default 30-day hierarchy and drilldown;
- Sleep summary/history and missing-day presentation;
- Settings / Library navigation;
- JSON export save/share;
- account-deletion UI through the safe boundary only, stopping before the final destructive request.

### D4 — iPhone Home Screen PWA / offline / version recovery

- add to Home Screen and launch standalone;
- cold-start while offline;
- online → offline transition while protected health UI is visible;
- offline → online recovery;
- create or retain a pending outbox intent, then exercise update/reload;
- verify pending intent survives reload/update and resumes for the same owner;
- verify unsupported/outdated contract content is blocked rather than silently dropped.

### D5 — iPad responsive acceptance

Repeat the semantic paths above at iPad layout width, emphasizing:

- responsive hierarchy;
- no horizontal overflow;
- readable Nutrition/Sleep information density;
- usable dialogs/forms;
- touch targets and navigation.

Evidence is recorded after each sub-checkpoint. No real account deletion is performed during D.

## Export

PASS:

- versioned JSON;
- single owner-scoped consistent PostgreSQL snapshot;
- explicit allowlist;
- Nutrition + retained normalized Sleep state;
- stored superseded Sleep rows where present;
- historical meal nutrient snapshots exported as stored;
- token/password/ciphertext/provider-internal/mutation/deletion internals excluded;
- real wearable Sleep export inspected in Hosted Preview.

Device save/share still belongs to Gate 12.

## Account deletion

PASS at implementation/synthetic level:

- current-password reauthentication;
- dedicated DB-backed deletion rate limit;
- same-origin recovery operation established before destructive request;
- lifecycle writer/deletion lock;
- Google revoke best-effort semantics;
- server-only Supabase Admin boundary;
- Storage preflight;
- hard-delete outcome recheck;
- explicit `deletion_outcome_unknown`;
- cascade fixtures;
- current-device cleanup only after confirmed deletion.

The sole real Preview user has intentionally **not** been deleted.

Still required before final rollout acceptance:

- safe acceptance through the UI boundary on device;
- optional isolated synthetic Hosted Preview account test if the dedicated Admin environment is enabled;
- no destructive test against the sole Production user.

## PWA / version recovery

PASS at automated/Preview deployment level:

- Service Worker caches static shell only;
- authenticated HTML/RSC/API are not replayed as current health state;
- `/api/*` and `/auth/*` are excluded from SW interception;
- cold-start offline fallback contains no cached health history;
- static cache rotation is independent of IndexedDB;
- app version/outbox contract version are checked with a no-store endpoint;
- incompatible outbox mutations are preserved and blocked;
- no automatic intent deletion on app update;
- live offline boundary hides previously rendered server health UI.

Still required on physical device:

- Home Screen launch;
- cold-start offline;
- online → offline transition;
- offline → online recovery;
- update/reload while pending operation exists;
- same-owner resume;
- verify pending intent survives update.

## Remaining Gate 11 / 12 work

Before Phase 6.11 can be declared complete:

1. iPhone acceptance across navigation, Today, Product/OCR, Nutrition, Sleep, Settings/Library,
   export, account-deletion safe boundary, offline shell/version recovery;
2. iPad acceptance for the same semantic flow and responsive hierarchy;
3. physical-device pending-operation update/reload recovery;
4. final Preview regression after those checks;
5. explicit Production rollout approval.

## Production / MVP boundary

Do not declare MVP COMPLETE yet.

MVP COMPLETE requires:

- Phase 5 complete through the approved Production boundary;
- all Phase 6 acceptance gates complete;
- no open blocking security/data-integrity issue;
- approved Production rollout and non-destructive smoke;
- explicit Supervisor/user acceptance.

Production remains untouched.
