# Phase 1 実装ステータス

基準日: 2026-09-12 / 対象: `phase/1-foundation` / 状態: 外部環境と実機受入待ち

## 実装識別子

- ローカルrepository: `nutrition-sleep-app`（GitHub remote未設定）
- branch: `phase/1-foundation`
- main bootstrap commit: `c473829 docs: add Phase 1 foundation plan`
- 実装commit: `3f80909 feat: implement Phase 1 foundation`
- status document作成時点の実装head: `45f80fcfa2d450af2a50a0a4a86d0e2e3e11a235 chore: ignore generated local Supabase metadata`
- GitHub private repository: 未作成。GitHub connectorにはrepository作成操作がなく、ブラウザ作成画面はGitHubサインインを要求したため、認証を自動操作せず停止。

## 外部環境

- Supabase organization: `Auto-Hal's Org` (`ofmbnluuohkooklrhslo`)
- 要求したproject: `nutrition-sleep-preview`（未作成）
- 作成結果: organizationのFree枠に既存active projectが2つあり、新規project作成が拒否された。既存のStudy Graph / money-canvas projectは変更していない。
- Production Supabase project: 未作成。Previewと同一projectの流用もしていない。
- Vercel team: `Tsuno` (`team_aTOsma3gZ9xkcFkGJ53dUCCO`)
- Vercel project / Preview URL: 未作成。既存projectは変更していない。新規deployは明示的なproject/destinationが確定していない状態での実行を自動レビューに拒否されたため、既存projectを流用していない。

## Migration / DB

- migration: `supabase/migrations/20260912000000_phase1_foundation.sql`
- DB test: `supabase/tests/phase1_rls.sql`（pgTAP 16 assertions）
- schema: `public.user_profiles`、server-only `private.app_sessions`のみ。Fitbit / Google Health固有のschemaは作成していない。
- fresh replay: 未実行。ローカルDocker/Supabase DBが利用できず、`supabase db lint --local` は `127.0.0.1:54322` 接続拒否で終了した。CIには `supabase start` → `db reset` → `test db` → `supabase stop` を設定済み。
- RLS/policy/permission: migrationとpgTAP契約を実装済み。実DBでの実行結果は上記のDB未起動により未取得。未実行をPASSとは扱わない。

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
| remote GitHub CI | 未実行（repository未作成） |

## 実機

- iPhone Safari / ホーム画面PWA: 未実施（Preview URL未作成）。
- iPad Safari / 縦横・キーボード: 未実施（Preview URL未作成）。
- PlaywrightのChromium/WebKit mobile検証は通過したが、実機合格の代替にはしていない。

## Phase 1受入条件

| ID | 判定 | 根拠 |
|---|---|---|
| F01 未認証保護 | PARTIAL | route/APIの保護とE2E redirectは確認。Supabase実環境でのDB境界は未実行。 |
| F02 メールOTP | PARTIAL | server-side OTP request/verifyを実装。実SMTP・実ユーザーの送受信は未実施。 |
| F03 セッション | PARTIAL | encrypted cookie/session、refresh lease、logoutを実装。実Supabaseでの同時refresh/失効は未実施。 |
| F04 RLS | BLOCKED | migrationとpgTAPを実装。A/B/anon実DB試験はDB未作成。 |
| F05 private schema | BLOCKED | private schema/grantを実装。実DBのpermission試験は未実施。 |
| F06 Profile/revision | PARTIAL | UI/API/RPC/triggerを実装。DB保存・409競合の実試験は未実施。 |
| F07 fresh migration | BLOCKED | migrationはfresh replay可能な構成。local DBが起動できずreplay結果未取得。 |
| F08 IA / empty states | PASS | 4固定タブ、Settings/Library切替、未提供を0や同期済みにしない表示を実装し、build/E2E確認。 |
| F09 iPhone | BLOCKED | Preview未作成のため実機未実施。 |
| F10 iPad | BLOCKED | Preview未作成のため実機未実施。 |
| F11 通信断 | PARTIAL | 保存失敗を成功表示しないUIは実装。offline queue/復帰照合はPhase 6対象。 |
| F12 環境分離 | BLOCKED | 設定境界と検査を実装。分離Supabase/Vercel未作成。 |
| F13 Production verification | BLOCKED | user approval前のmain merge/Production移行は禁止されており未実施。 |

## 未解決事項

1. GitHubでprivate repositoryを作成し、feature branchをpushしてPR/CIを有効化すること。
2. Supabase organizationのproject上限を解消すること（契約変更、別organization、または明示承認された既存projectの整理）。Study Graph環境を変更・流用しない。
3. Preview / Production Supabase projectを別々に作成し、OTP送信元とserver-only secretsを登録すること。
4. Vercelに新規projectを作成し、Preview environmentへ接続すること。
5. Previewでfresh replay、RLS pgTAP、実OTP、iPhone/iPadを実施すること。
6. CR-001（旧Fitbit Sleep v1.2 superseded）のAstra審議をPhase 5開始前に完了すること。

## Phase 2開始前のSupervisor判断

- 新規Supabase projectを作成できる契約／organizationを承認するか。
- GitHub / Vercelの所有者、repository名、project名、Environment reviewerを確定するか。
- Preview実機受入をPASSとする対象commitと証跡を承認するか。
- CR-001の採用APIとprovider-neutral境界を承認するか。未解決のままPhase 5へ進めない。

main mergeとProduction移行は、上記のPreview・実機レビューとSupervisor承認が完了するまで行わない。
