# Phase 6 status

Updated: 2026-09-26

## Current state

- Phase 6 design: **APPROVED — ASTRA CORRECTIONS APPLIED + SUPERVISOR/USER ACCEPTED**
- Phase 6 implementation: **6.1–6.10 IMPLEMENTED / 6.11 ACCEPTANCE IN PROGRESS**
- completed / review-ready chain:
  - 6.1 Reliability server primitives
  - 6.2 IndexedDB client outbox / contract versioning
  - 6.3 revisioned conflicts for non-Product state
  - 6.4 Product provenance v2 + reliable Product writes
  - 6.5 Yahoo exact-JAN identity fallback
  - 6.6 Nutrition review-priority derivation
- completed / review-ready:
  - 6.7 Nutrition review-priority UX
  - 6.8 consistent export
  - 6.9 account deletion / lifecycle guard
  - 6.10 PWA shell / version recovery
- current batch: **6.11 full MVP acceptance — 6.11-A/B/C PASS; 6.11-D device acceptance not started**
- Production: untouched

## Phase 6.7

Implemented on `phase/6.7-nutrition-priority-ux` / PR #19:

- 30-day default review view;
- 記録上の過剰確認;
- 先に見直す項目;
- 見直す項目;
- 参考・判定保留 / データ不足;
- factual RDA percentage;
- DG distance wording;
- mixed-axis presentation;
- evaluable days and data quality;
- existing nutrient → day → meal → item drilldown;
- authoritative server analytics only; unsynced outbox values excluded;
- responsive narrow-screen layout.

Application checks and Preview are green. A previous DB job failed before startup because
`supabase/setup-cli@v1` hit GitHub release rate limiting; the branch is being reverified by a fresh run.

## Phase 6.8

Implemented on `phase/6.8-consistent-export` / PR #20:

- versioned JSON v1;
- one owner-scoped PostgreSQL statement snapshot;
- explicit export allowlist;
- Profile, Catalog, Product v2, Batch, Meal and immutable nutrient snapshots;
- stored active/superseded normalized Sleep rows and stored child intervals;
- safe provider connection metadata only;
- credentials, provider internal IDs, payload hashes, idempotency keys and mutation receipts excluded;
- server-authoritative export; unsynced IndexedDB mutations explicitly excluded/warned;
- Settings download UI;
- owner-isolation / allowlist pgTAP;
- route and UX contract tests.

Automated acceptance:
- lint / typecheck / unit / verify-env / build: PASS;
- fresh DB replay / pgTAP: PASS;
- Preview workflow: PASS.

Real-wearable Sleep export acceptance passed on 2026-09-25 after Phase 5 device validation. Public status records intentionally omit personal sleep measurements.

## Phase 6.8 real-wearable export acceptance

Completed on 2026-09-25 in Hosted Preview:

- real normalized STAGES Sleep data is present;
- stored stage intervals are included in the export;
- exported Sleep/session counts match the persisted owner-scoped rows;
- stored normalized summary fields match the persisted observation;
- provider resource/external IDs, payload hashes, health-user identifiers, OAuth token material and mutation receipts remain absent;
- `sleep_history_scope` correctly states that the export contains stored normalized rows, not complete provider revision history;
- Production remains untouched.

## Phase 6.9

Implemented on `phase/6.9-account-lifecycle` / PR #21:

- deliberate Settings danger-zone flow with current-password reauthentication and literal `削除` confirmation;
- dedicated DB-backed reauthentication rate-limit namespace;
- server-only Supabase Admin boundary bound to the expected deployment environment and Supabase project;
- pre-destructive, same-origin HttpOnly recovery-operation cookie;
- short-lived private deletion status with explicit `deletion_outcome_unknown`;
- user-scoped shared writer lock / exclusive deletion-start advisory lock;
- Phase 6 reliable mutations and Google Health credential/sync/backfill writes participate in the lifecycle guard;
- legacy RPC compatibility retained while authenticated writes are forced through lifecycle table triggers;
- bounded Google authorization revocation that does not block local deletion on provider failure;
- Storage ownership preflight before Auth hard deletion;
- authoritative Auth deletion outcome re-check before success is reported;
- current-device IndexedDB / local storage / session storage / Cache Storage cleanup only after confirmed deletion;
- explicit wording that provider source data, downloaded exports, other devices and backups are outside this operation.

Automated acceptance:

- lint / typecheck / unit / verify-env / build: PASS;
- fresh DB replay / pgTAP including guard, legacy-write, cascade and status-recovery fixtures: PASS;
- Preview workflow / deployment: PASS;
- Hosted Preview migration applied and schema verified;
- existing normalized Sleep and Nutrition data remained intact after the migration;
- Hosted Preview deletion guard/status rows remain empty because the real user was intentionally not deleted;
- lifecycle private tables are not readable by `authenticated`;
- established legacy RPC privileges remain compatible while lifecycle triggers are active.

Security advisor review after the Hosted Preview migration reports the expected information-level
"RLS enabled with no policy" findings for private server-only tables. It also continues to report
the established public SECURITY DEFINER RPC warnings and the project-level leaked-password
protection setting; these are not introduced by the Phase 6.9 lifecycle tables and are not treated
as a 6.9 implementation blocker.

Destructive acceptance against the real Preview user was intentionally **not** performed.
The deletion Admin environment remains fail-closed unless its complete server-only configuration
is present. Production remains untouched.

## Phase 6.10

Implemented on `phase/6.10-pwa-version-recovery` / PR #22:

- static-shell-only Service Worker;
- cold-start offline fallback page;
- authenticated HTML/RSC/API responses are never cached/replayed as current health state;
- `/api/*` and `/auth/*` excluded from Service Worker interception;
- deployment version + outbox contract no-store endpoint;
- update banner with explicit reload;
- static update never clears IndexedDB;
- incompatible outbox contract remains `blocked` and visible instead of being dropped or guessed;
- live connectivity boundary hides previously rendered protected health UI while offline;
- offline shell inspects only local unresolved-operation counts/statuses, not payload contents;
- service-worker cache rotation deletes only app shell caches;
- iOS standalone metadata and explicit Service Worker revalidation headers.

Automated acceptance:

- lint / typecheck / unit / verify-env / build: PASS;
- fresh DB replay / pgTAP regression: PASS;
- Preview workflow / deployment: PASS;
- Vercel Preview deployment: READY;
- no Phase 6.10 DB migration was required;
- Production remains untouched.

Device-specific PWA acceptance (Home Screen install, cold-start offline, update/reload with pending intent) remains part of Phase 6.11 full MVP acceptance.

## Phase 6.11

Acceptance tracking is now recorded in `docs/phase-6.11-full-mvp-acceptance.md`.

Current integrated findings:

- current stacked application checks: green;
- fresh DB / pgTAP regression: green;
- Hosted Preview migration chain through Phase 6.9: present;
- Phase 6.10 requires no DB migration;
- Hosted Preview Nutrition + real-wearable Sleep state remains intact;
- Preview runtime error/fatal review: no matching errors in the inspected 24-hour window;
- all public user-data tables have RLS enabled;
- anon has no SELECT/INSERT access to public user-data tables;
- public SECURITY DEFINER RPCs are not anon-executable, reference `auth.uid()`, and set explicit `search_path`;
- existing Security Advisor warnings are documented in the 6.11 acceptance matrix.

Checkpoint status:

- 6.11-A security / logs / stack integrity: PASS;
- leaked-password protection: deferred as required Production Auth configuration check, not an implementation blocker;
- 6.11-B automated + Hosted Preview functional regression: PASS after fixing reload-time provisional Today nutrition hydration;
- 6.11-C Yahoo/JAN external acceptance: PASS — 20/20 samples produced exact-JAN candidates; 1 single candidate, 19 ambiguous/manual-selection cases, 0 not-found, 0 unavailable; identity-only/no-nutrition/raw-payload invariants held.
- next: 6.11-D iPhone/iPad/PWA device acceptance.

Remaining final acceptance:

- iPhone device E2E including Product/OCR and PWA offline/update recovery;
- iPad device E2E;
- final Preview regression after device/external acceptance;
- approved Production rollout;
- explicit MVP COMPLETE decision.

Production remains untouched.

## Phase 5 relationship

Phase 5 real wearable/STAGES/device acceptance is complete in Preview.

Phase 5 Production rollout remains a separate gate and is intentionally deferred until the
Phase 6 integration/rollout sequence is approved.

## Production rule

No Phase 6 changes are merged/deployed to Production until the required Preview, fresh replay,
security, Phase 5 boundary, and explicit rollout gates are satisfied.
