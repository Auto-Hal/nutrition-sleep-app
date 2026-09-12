# Phase 1 実装ステータス

基準日: 2026-09-12 / 対象: `phase/1-foundation` / 状態: Preview migration適用前・実機受入待ち

## 実装識別子

- GitHub repository: [Auto-Hal/nutrition-sleep-app](https://github.com/Auto-Hal/nutrition-sleep-app)（private）
- branch: `phase/1-foundation`
- Next.js: `15.5.9`（Supervisor指定の安全基準を満たす既存固定版。`eslint-config-next`も`15.5.9`）
- main bootstrap commit: `c473829 docs: add Phase 1 foundation plan`
- 実装commit: `3f80909 feat: implement Phase 1 foundation`
- 現在の実装head: `b351ded0a92d6cc261b4648ce3b5ef9b6524f2cc`（専用Preview実DB検証記録）
- Draft PR: [#1](https://github.com/Auto-Hal/nutrition-sleep-app/pull/1)（`phase/1-foundation` → `main`、未merge）

## 外部環境

- ENV-001更新: Supabase Proは使用せず、新しい専用SupabaseアカウントのFree枠2 projectを使う。
- 専用Supabase organization: `TsunoApp` (`vaupyfcztcoglwvqjict`)（Free）
- Preview project: `nutrition-sleep-preview` / ref `pprsfxpfljdjlwdfbtqo`（既存の空projectを改名。Phase 1 source migration適用済み、実データなし）
- Production project: `nutrition-sleep-production` / ref `vyvnicyupcrsmtgdyypv`（新規作成。migration/data未適用）
- Supabase MCP: 専用organization向けOAuth接続を完了（project ref `pprsfxpfljdjlwdfbtqo`）。このturnの既存connector表示は旧organizationのままのため、専用MCP reload待ち。
- 既存 `Auto-Hal's Org` (`ofmbnluuohkooklrhslo`) のStudy Graph / money-canvas projectは変更・pause・停止していない。
- Vercel team: `Tsuno` (`team_aTOsma3gZ9xkcFkGJ53dUCCO`)
- Vercel project: `nutrition-sleep-app` / project ID `prj_WiPB989mXurOuIgVm8asfmfdPA6W`（Tsuno team）
- Vercel deployment: `dpl_7G4yrqpbSDzWbnDfrzMdjk5iQYjm` はREADYだが、要求したPreviewではなく `target=production` と返されたため、実機確認には使用していない。Production利用・移行はSupervisor承認まで行わない。Preview URLは未取得。

## Migration / DB

- migration: `supabase/migrations/20260912000000_phase1_foundation.sql`
- DB test: `supabase/tests/phase1_rls.sql`（pgTAP 17 assertions）
- schema: `public.user_profiles`、server-only `private.app_sessions`のみ。Fitbit / Google Health固有のschemaは作成していない。
- fresh replay: GitHub Actions CI run `34694666203`（rerun database job `103556171339`）で `supabase start` → `supabase db reset` → `supabase test db` → `supabase stop` を実行しPASS。pgTAP 17 assertionsもPASS。
- Preview適用: 専用Preview (`pprsfxpfljdjlwdfbtqo`) のSQL Editorでsource migration全文を実行しSuccess。Previewは空projectからの適用で、Productionには適用していない。
- Hosted dashboardのmigration ledgerはSQL Editor直接適用では作成されないため、適用の正本はGitHub migration fileとCI fresh replay。専用MCP reload後にCLI適用へ切り替える余地を未解決事項として残す。
- RLS/policy/permission: Preview SQL検証でRLS enabled+forced、owner policy 3件、authenticatedのselect/insert/update/RPC executeのみtrue、anonとprivate schema/tableはfalseを確認。user A/B実DB試験は `A sees own=1 / A sees B=0 / B sees own=1 / B sees A=0 / B height after A cross-update=180.00`、anon実DBは `42501 permission denied for table user_profiles`、未認証RPCは `42501 authentication required`。revision実DBは `1→2`、stale `40001` conflict。試験用Auth/profileはcleanup後0件。

## 自動検証

| 検証 | 結果 |
|---|---|
| `pnpm install --frozen-lockfile --ignore-scripts` | PASS |
| `pnpm lint` | PASS |
| `pnpm typecheck` | PASS |
| `pnpm test` | PASS（2 files / 5 tests） |
| `pnpm build` | PASS（Next.js 15.5.9） |
| `pnpm test:e2e` | PASS（Chromium + WebKit mobile、4 tests） |
| `pnpm verify:env`（安全なダミー値） | PASS |
| `git diff --check` | PASS |
| GitHub Actions CI run `34695383714` | PASS（checks + database） |
| GitHub Actions Preview run `34695383711` | BLOCKED（`VERCEL_TOKEN`等のGitHub Environment secret未設定） |

## 実機

- iPhone Safari / ホーム画面PWA: 未実施（安全なPreview URL未取得）。
- iPad Safari / 縦横・キーボード: 未実施（安全なPreview URL未取得）。
- PlaywrightのChromium/WebKit mobile検証は通過したが、実機合格の代替にはしていない。

## Phase 1受入条件

| ID | 判定 | 根拠 |
|---|---|---|
| F01 未認証保護 | PARTIAL | route/APIの保護とE2E redirectは確認。Supabase実環境でのDB境界は未実行。 |
| F02 メールOTP | PARTIAL | server-side OTP request/verifyを実装。実SMTP・実ユーザーの送受信は未実施。 |
| F03 セッション | PARTIAL | encrypted cookie/session、refresh lease、logoutを実装。実Supabaseでの同時refresh/失効は未実施。 |
| F04 RLS | PASS（Preview） | Preview実DBでRLS enabled+forced、owner policy、user A/B相互不可視、anon拒否を確認。CI pgTAP 17 assertionsもPASS。 |
| F05 private schema | PASS（Preview） | Preview実DBで`private` schemaのauthenticated/anon usageと`app_sessions` selectがfalse、Data API向けgrantなしを確認。 |
| F06 Profile/revision | PASS（Preview） | Preview RPCでprofile revision `1→2`とstale `40001` conflictを確認。 |
| F07 fresh migration | PASS | GitHub Actionsでfresh `db reset` とpgTAPをPASSし、Preview空projectへsource migrationを適用。 |
| F08 IA / empty states | PASS | 4固定タブ、Settings/Library切替、未提供を0や同期済みにしない表示を実装し、build/E2E確認。 |
| F09 iPhone | BLOCKED | 安全なPreview URL未取得のため実機未実施。 |
| F10 iPad | BLOCKED | 安全なPreview URL未取得のため実機未実施。 |
| F11 通信断 | PARTIAL | 保存失敗を成功表示しないUIは実装。offline queue/復帰照合はPhase 6対象。 |
| F12 環境分離 | PARTIAL | 専用Free organizationにPreview/Production projectを用意し、Preview migrationを適用。Vercel安全なPreview URLと環境別secret設定が未完了。 |
| F13 Production verification | BLOCKED | user approval前のmain merge/Production移行は禁止されており未実施。 |

## 未解決事項

1. Vercelのproduction-target deploymentを実機確認に使わない形で整理し、安全なPreview deploymentを作成すること。
2. Preview / Production projectへOTP送信元とserver-only secretsを別々に登録すること。
3. 専用MCP reload後にPreview migration ledgerをCLI経由で確認し、必要なら適用手順を正規化すること。
4. Previewで実OTP、iPhone/iPadを実施すること。
5. CR-001（旧Fitbit Sleep v1.2 superseded）のAstra審議をPhase 5開始前に完了すること。

## Phase 2開始前のSupervisor判断

- 専用Supabase organizationでのPreview migration適用を許可するか（Productionは未適用のまま）。
- Vercel projectのtarget不整合を解消し、安全なPreview URLを受入対象にするか。
- Preview実機受入をPASSとする対象commitと証跡を承認するか。
- CR-001の採用APIとprovider-neutral境界を承認するか。未解決のままPhase 5へ進めない。

main mergeとProduction移行は、上記のPreview・実機レビューとSupervisor承認が完了するまで行わない。
