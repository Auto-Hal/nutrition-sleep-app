# Phase 6.11 — Full MVP acceptance

Updated: 2026-09-26

Status: **COMPLETE — Phase 6.11 PASS; Gate 13 server rollout deployed, final real-account acceptance pending**

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

Status: **PASS**

Acceptance is intentionally split into small device checkpoints so failures are isolated and repeatable.

### D1 — iPhone baseline / navigation — PASS

Confirmed by physical iPhone acceptance on 2026-09-26:

- exact Phase 6.11 Preview opened successfully in iPhone Safari;
- Today / Nutrition / Sleep / Settings navigation worked;
- Settings → Library was reachable;
- no obvious clipping, horizontal overflow, unusable fixed footer/header, or blocked primary action was observed;
- normal Safari reload returned to a usable state;
- no red error state, blank page, or infinite-loading failure was observed.

### D2 — iPhone Today / Product / OCR — PASS

Confirmed by physical iPhone acceptance on 2026-09-26:

- ordinary Today meal entry: PASS;
- snack/custom meal path: PASS;
- skip/unskip: PASS;
- MealEntry void: PASS;
- real barcode capture: PASS;
- Yahoo exact-JAN fallback reached successfully;
- Yahoo returned multiple exact-JAN identity candidates and **did not auto-select**; explicit user selection was required as designed.

OCR defect resolution:

- physical-device retests exposed parser row-alignment defects on a Japanese table label;
- first defect: serving basis `1食分(40g)当たり` was misread and `40g` could be assigned as a nutrient value;
- later retests exposed residual row shifts across protein/fat and vitamin B12/C/D/E;
- UI mapping was audited and confirmed code-keyed rather than index-keyed, isolating the defect to the parser;
- parser hardening now uses structural unit rows (kcal/g/mg/ug) as row boundaries, rejects conflicting inline units, and disables fuzzy cross-matching within the vitamin family;
- regression coverage includes skewed table rows, unsupported intervening rows such as folate/cholesterol, and vitamin-family separation;
- final physical-device retest on the same representative label was confirmed correct by the user;
- latest application lint/typecheck/test/build passed and the corrected Preview deployment reached READY.

### D3 — iPhone Nutrition / Sleep / Settings / export — PASS

Confirmed by physical iPhone acceptance on 2026-09-26:

- Nutrition default 30-day hierarchy opened and the review sections/drilldown remained usable;
- no obvious Nutrition layout overflow or blocked interaction was observed;
- Sleep summary/history displayed the real wearable record and stage breakdown;
- missing sleep days remained missing rather than being represented as zero-duration sleep;
- Settings → Library remained usable and existing records were visible;
- JSON export completed to the iPhone share/save flow;
- account-deletion UI was exercised through the safe pre-destructive boundary only;
- no real account deletion was performed.

### D4 — iPhone Home Screen PWA / offline / version recovery — PASS

D4a first physical-device attempt exposed an iOS PWA blocker:

- Home Screen standalone launch while offline failed with Safari/WebKit error:
  `Response served by service worker has redirections`;
- root cause: the cached `offline.html` Response could retain a redirect chain (notably relevant on protected Preview deployments), and iOS rejects redirected Service Worker navigation responses;
- fix: Service Worker now reconstructs cached shell responses as fresh final Responses, strips redirect/transport-only headers, sends same-origin credentials when priming the static shell, and validates that the final shell response remains same-origin;
- a dedicated regression test covers redirect stripping for iOS offline navigation;
- corrected Preview reached READY and the physical-device cold-start offline retest passed: the app displayed the dedicated offline shell instead of the WebKit redirect error;
- physical-device online → offline transition and offline → online recovery also passed;
- **D4a PASS**.

### D4b — pending outbox across app update — PASS

Physical-device pre-update checkpoint passed:

- a Preview-only acceptance control paused automatic outbox replay without disabling IndexedDB writes;
- one real meal mutation was queued and shown as `端末に保存・未同期`;
- Settings reported exactly one unsynced operation;
- after fully closing and reopening the Home Screen PWA with connectivity available, the same unsynced operation remained present;
- this confirms persistence across PWA process restart before the version transition.

The temporary Preview-only pause control was then removed and normal replay restored in the next app version.

Physical-device post-update checkpoint passed:

- the PWA updated/reloaded into the new version;
- the temporary D4b acceptance control disappeared as expected;
- the preserved pending mutation replayed for the same signed-in owner;
- the meal record appeared exactly once as authoritative server state;
- the local unsynced state cleared;
- closing and reopening the PWA did not create a duplicate.

This confirms pending intent persistence across restart + version transition and exactly-once user-visible recovery for the accepted path.

Remaining PWA contract behavior for unsupported/outdated outbox content is already covered by automated tests and remains blocked/preserved rather than silently converted or deleted.

### D5 — iPad responsive acceptance — PASS

Confirmed by physical iPad acceptance on 2026-09-27:

- Today remained usable at iPad width with no horizontal overflow or blocked primary actions;
- Nutrition review hierarchy and drilldown remained readable without layout collapse;
- Sleep summary/history/stage presentation remained within the viewport;
- Settings / Library navigation, forms, export and safe account-deletion boundary remained usable;
- portrait and landscape responsive behavior showed no blocking layout defect;
- touch targets and bottom navigation remained usable.

### 6.11-D result — PASS

Physical-device acceptance is complete across:

- D1 iPhone baseline/navigation;
- D2 Today/Product/barcode/Yahoo/OCR, including parser hardening discovered during acceptance;
- D3 Nutrition/Sleep/Settings/Library/export/account-deletion safe boundary;
- D4 Home Screen PWA offline/recovery + pending outbox persistence across restart/version update;
- D5 iPad responsive acceptance.

No real account deletion was performed during D.

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

Physical-device JSON save/share acceptance passed in 6.11-D3.

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

Physical-device safe-boundary acceptance passed in 6.11-D3.
No destructive test was performed against the real Preview or Production user.
An isolated synthetic destructive test remains optional and is not required to close Phase 6.11.

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

Physical-device PWA acceptance passed in 6.11-D4:

- Home Screen launch;
- cold-start offline;
- online → offline transition;
- offline → online recovery;
- update/reload while a pending operation existed;
- same-owner resume;
- pending intent survived restart/version update and replayed once without duplication.

## 6.11-E checkpoint — final blocker review

Status: **PASS**

Final review completed on 2026-09-27.

Current final-head evidence:

- application lint / typecheck / unit / environment validation / build: PASS;
- fresh Supabase start / reset / pgTAP regression: PASS;
- Preview workflow: PASS;
- latest Vercel Preview deployment: READY;
- latest Preview deployment error/fatal runtime log query: no matches;
- one earlier `JWT issued at future` 500 occurred on the temporary D4b acceptance deployment; it did not recur on the final deployment and is not treated as a current blocker;
- temporary D4b acceptance UI/pause hooks and temporary Yahoo runtime acceptance endpoint/workflow hooks are removed;
- the remaining Yahoo real-JAN script is a non-runtime acceptance utility only.

Final Hosted Preview integrity review:

- meals: 9;
- meal entries: 17 total / 16 active;
- Catalog items: 2;
- Products: 1;
- Sleep sessions: 2 active / 2 total;
- Sleep stage intervals: 45;
- Google Health connections: 1 connected / 1 total;
- deletion guards / operations: 0 / 0;
- invalid Sleep stage intervals: 0;
- overlapping Sleep stage pairs: 0;
- overlapping active Sleep sessions: 0;
- duplicate active provider resources: 0;
- null meal/catalog revisions: 0 / 0.

Final security/performance review:

- Security Advisor continues to report the six intentional private server-only tables with RLS and no end-user policies;
- Security Advisor continues to report the established 28 authenticated SECURITY DEFINER RPCs; 6.11-A already verified these are not anon-executable, reference `auth.uid()`, and define explicit `search_path`;
- leaked-password protection remains disabled because it is Pro-only; the user explicitly accepted this limitation for the current single-user Free-plan MVP;
- Performance Advisor reports unused-index INFO items only; no acceptance-time index deletion is warranted.

Production boundary verification:

- Preview Supabase migration chain reaches `phase6_account_lifecycle`;
- Production Supabase now includes the Phase 5/6 migration chain through `phase6_account_lifecycle`;
- Gate 13 Production Vercel deployment is READY at `nutrition-sleep-app.vercel.app`;
- public/unauthenticated Production smoke is PASS and runtime error/fatal scan is clean;
- no real-account deletion was performed.

No open Phase 6.11 blocker remains.

## Phase 6.11 result

**COMPLETE / PASS**

Passed checkpoints:

- 6.11-A security / logs / stack integrity;
- 6.11-B full Preview functional regression;
- 6.11-C Yahoo/JAN external acceptance;
- 6.11-D iPhone / iPad / PWA physical-device acceptance;
- 6.11-E final blocker review.

Gate 13 Production rollout was explicitly approved on 2026-09-29. Production preflight passed, Phase 5/6 database migrations were applied successfully, post-migration security/integrity review passed, `main` release PR #24 was merged, and the Production deployment reached READY. Public/unauthenticated smoke passed and the Production deployment had no error/fatal runtime entries in the inspected window. Final authenticated real-account acceptance remains pending.

## Production / MVP boundary

Phase 6.11 acceptance and the server-side Production rollout are complete, but **MVP COMPLETE still awaits authenticated real-account Production acceptance**.

MVP COMPLETE still requires:

- authenticated Production login/navigation smoke;
- Production Google Health OAuth connection + real-device sync confirmation;
- a final non-destructive Production data/export check;
- explicit Supervisor/user acceptance after those checks.

Production is deployed; destructive real-account deletion remains prohibited during final acceptance.
