# Phase 1 実装ステータス

基準日: 2026-09-13 / 対象: `phase/1-foundation` / 状態: CR-002実装済み・Supervisorレビュー待ち

## 実装識別子

- GitHub repository: [Auto-Hal/nutrition-sleep-app](https://github.com/Auto-Hal/nutrition-sleep-app)（private）
- branch: `phase/1-foundation`
- current PR head（確認時点）: `git rev-parse HEAD`で取得（docs-only commitで変動するため固定しない）
- implementation / acceptance target commit: `0e03aa8879a325cac7f5b2690fe42df31bb05be2`（`fix: verify app sessions are revoked during recovery`）
- Next.js: `15.5.24`
- eslint-config-next: `15.5.24`
- main bootstrap commit: `c473829439a82eac34284fe0bc6086d5fd99ef53`
- Phase 1 implementation commit: `3f80909`（履歴上の実装起点）
- Draft PR: [#1](https://github.com/Auto-Hal/nutrition-sleep-app/pull/1)（`phase/1-foundation` → `main`、未merge）

## 外部環境

- ENV-001: Supabase Proは使用せず、本アプリ専用organizationのFree project 2件を使用。
- 専用Supabase organization: `TsunoApp` (`vaupyfcztcoglwvqjict`)（Free）
- Preview project: `nutrition-sleep-preview` / ref `pprsfxpfljdjlwdfbtqo`（migration適用済み、email/password受入用Auth user 1件を事前Provision済み）
- Production project: `nutrition-sleep-production` / ref `vyvnicyupcrsmtgdyypv`（schema/data未適用）
- 既存 `Auto-Hal's Org` (`ofmbnluuohkooklrhslo`) の `study-graph` / `money-canvas` は変更・pause・停止していない。
- Vercel team: `Tsuno` (`team_aTOsma3gZ9xkcFkGJ53dUCCO`)
- Vercel project: `nutrition-sleep-app` / ID `prj_WiPB989mXurOuIgVm8asfmfdPA6W`
- Vercel Preview deployment (runtime verified): `dpl_8iUmdkjJWMX9ruwJjzcc9yzdDCxC` / [https://nutrition-sleep-pq2x8hzos-tsuno2.vercel.app](https://nutrition-sleep-pq2x8hzos-tsuno2.vercel.app)（commit `0e03aa8879a325cac7f5b2690fe42df31bb05be2`、`phase/1-foundation`、READY、branch alias `nutrition-sleep-app-git-phase-1-foundation-tsuno2.vercel.app`）
- GitHub Actions CI run `34737129020`（checks job `103670440872` / database job `103670440799`）とPreview run `34737128989`（deploy job `103672961483`）をPASS。
- Vercel Preview環境変数: 既存の`SUPABASE_URL`、`SUPABASE_PUBLISHABLE_KEY`、`DATABASE_URL`、`APP_SESSION_ENCRYPTION_KEY`に加え、CR-002の`APP_ALLOWED_USER_ID`、`APP_LOGIN_RATE_LIMIT_KEY`、`APP_ORIGIN`を`phase/1-foundation` Preview専用へ登録した。値はGitHub/sourceへ保存していない。登録時に誤って作成されたProduction側3値は即時削除し、現在Production環境変数は未設定。
- Production Vercel deployment、Production environment variables、Production Supabase schema/dataは未適用。

## Migration / DB

- migration 1: `supabase/migrations/20260912000000_phase1_foundation.sql`
- corrective migration: `supabase/migrations/20260912155034_phase1_profile_timezone.sql`
- CR-002 migration: `supabase/migrations/20260913120000_cr002_login_rate_limits.sql`
- DB test: `supabase/tests/phase1_rls.sql`（pgTAP 25 assertions）
- fresh replay: GitHub Actions CI run `34737129020` の database job `103670440799` で `supabase start` → `supabase db reset` → `supabase test db` → `supabase stop` をPASS。初期migration → corrective migration → CR-002 migrationの順で適用し、pgTAP 25 assertionsをPASS。
- Preview適用: Preview projectへ3 migrationを順に適用し、CR-002 `private.login_rate_limits`の作成・RLS・権限を確認した。Productionには適用していない。
- corrective migrationは元migrationを変更せず、`pg_timezone_names`でIANA timezoneを検証し、`(now() at time zone new.time_zone)::date`をbirth/weightの日付検証に使用する。
- Preview実DB検証: User A `own=1 / sees B=0 / timezone=Pacific/Kiritimati`、User B `own=1 / sees A=0 / cross-update後のheight=175`、anonは`42501 permission denied`、invalid timezoneは`22023`、stale revisionは`40001`。検証用Auth/profileはrollback後0件。
- `private.app_sessions` はData APIへ公開せず、authenticated/anonに不要なtable privilegeを付与していない。RPCはSECURITY INVOKERでauthenticatedのみにEXECUTEを付与。

## Auth / session hardening

- CR-002によりメールOTP、Magic Link、SMTP配送依存はsuperseded。`/api/auth/login`の`signInWithPassword`と既存server-side sessionだけを使用し、signup/anonymousはPreviewで無効化した。
- Preview Auth user `90ffbd25-b787-442d-8bb5-8b4d61ee2d56`を事前Provision済み。passwordはlocal-only utilityで設定し、Production userは作成しない。
- `APP_ALLOWED_USER_ID`をsession発行時とcookie session読込時に照合し、許可外userは認証済み扱いにしない。
- State-changing APIはOrigin欠落を含めfail-closed。Vercel `x-forwarded-for`はHMAC化した値だけをDB rate-limit keyに使用し、15分5回窓を共有する。
- DB障害時はrate-limitを通過させず、session保存失敗時はcookieを発行しない。
- `lib/auth/refresh.ts` にbounded retry、短時間wait、lease再読込、expiry再評価を実装。retry bound後も`tokenExpiresAt > now`なら現access tokenを継続利用し、期限切れだけをnullとする。
- refresh persistenceがrevision競合で0行になった場合は更新後tokenを有効扱いせず、最新rowを再読込して再評価する。
- `tests/session-concurrency.test.ts`: A)並行refresh完了時の双方fresh token、B)lease超過でも旧token有効、C)lease超過かつ旧token期限切れ、D)refresh persistence revision race後のDB最新row再読込を確認。

## 自動検証

| 検証 | 結果 |
|---|---|
| `pnpm install --frozen-lockfile` | PASS |
| `pnpm lint` | PASS |
| `pnpm typecheck` | PASS |
| `pnpm test` | PASS（7 files / 24 tests） |
| `pnpm build` | PASS（Next.js 15.5.24） |
| `pnpm test:e2e` | PASS（Chromium + WebKit mobile、6 tests） |
| `pnpm verify:env`（安全なダミー値） | PASS |
| `git diff --check` | PASS |
| GitHub Actions CI run `34737129020` | PASS（checks `103670440872` + database `103670440799`） |
| GitHub Actions Preview run `34737128989` | PASS（deploy `103672961483`、Vercel CLI deploy） |
| Vercel Preview redeploy `dpl_8iUmdkjJWMX9ruwJjzcc9yzdDCxC` | PASS（Preview / branch alias / READY） |

## 実機

- iPhone Safari / ホーム画面PWA: Preview URLは取得済み、ユーザー確認待ち。
- iPad Safari / 縦横・キーボード: ユーザー確認待ち。
- PlaywrightのChromium/WebKit mobile検証は通過したが、実機合格の代替にはしていない。

## Phase 1受入条件

| ID | 判定 | 根拠 |
|---|---|---|
| F01 未認証保護 | PASS（Preview DB / E2E） | 未認証route保護、anon table拒否、未認証RPC拒否を確認。 |
| F02 email/password | PARTIAL（コード・Preview設定PASS、実ログイン待ち） | OTP route/UIを削除、`signInWithPassword`、single-user allow-list、signup/anonymous拒否、rate-limit、password local utilityを実装。Preview Auth userのpassword設定と正しいpasswordでの実ログインは未確認。 |
| F03 セッション | PASS（unit） / PARTIAL（実Auth） | encrypted server session、refresh lease、bounded concurrent refresh A〜DはPASS。実Supabase token refreshは実ユーザー受入待ち。 |
| F04 RLS | PASS（Preview + CI） | RLS enabled+forced、owner policy、A/B相互不可視、anon拒否、pgTAP 25 assertionsを確認。 |
| F05 private schema | PASS（Preview + CI） | `private.app_sessions`のData API非公開と不要privilegeなしを確認。 |
| F06 Profile/revision | PASS（Preview + CI） | revision `1→2`、stale `40001`、invalid timezone `22023`を確認。 |
| F07 fresh migration | PASS | 初期migration → corrective migration → CR-002 migrationのfresh replayとpgTAP 25 assertionsをPASS。 |
| F08 IA / empty states | PASS | Today / Nutrition / Sleep / Settingsの4固定タブ、Settings / Library切替、empty状態をbuild/E2E確認。 |
| F09 iPhone | BLOCKED | Supervisorレビュー後の実機操作確認待ち。 |
| F10 iPad | BLOCKED | Supervisorレビュー後の実機操作確認待ち。 |
| F11 通信断 | PARTIAL | 保存失敗を成功表示しないUIは実装。offline queue/復帰照合はPhase 6対象。 |
| F12 環境分離 | PASS（Preview構成） / PARTIAL（Production未検証） | 専用Free organizationのPreview/Production project、`phase/1-foundation`専用Vercel env、Production側3値の削除を確認。Production schema/dataは未適用。 |
| F13 Production verification | BLOCKED | main merge、Production migration/deployはSupervisor承認前のため未実施。 |

## 未解決事項

1. Preview Auth userへpasswordをlocal-only utilityで設定し、Preview `/api/auth/login`の正しいpasswordによる実認証を確認すること。
2. iPhone / iPadでPreviewのpasswordログイン、4タブ、Settings / Library、Profile保存、iPad縦横を確認すること。
3. 専用Supabase migration ledgerはSQL Editor直接適用のため、CLI適用履歴の正規化は別途判断が必要。
4. CR-001（旧Fitbit Sleep v1.2 superseded）のAstra審議をPhase 5開始前に完了すること。

## Phase 2開始前のSupervisor判断

- CR-002のemail/password実認証・rate-limit・OTP route不存在のPreview証跡を承認するか。
- Preview migration/RLS/revision/session hardeningの結果を承認するか。
- Production Supabase schema/data、Production Vercel deployを開始してよいか（現時点は禁止）。
- CR-001の採用APIとprovider-neutral境界を承認するか。未解決のままPhase 5へ進めない。

main merge、Production migration、Production deploy、Phase 2開始は、Preview・実機レビューとSupervisor承認が完了するまで行わない。

## Production deployment cleanup（2026-09-13）

- Phase 1環境構築時に意図しない初期Production deployment（`dpl_7G4yrqpbSDzWbnDfrzMdjk5iQYjm`）が1件作成された。
- Supervisor reviewで検出した。
- 当該deploymentはProduction Supabase、Production secret、Production dataへ接続されていなかった。
- Phase 1 acceptance前に当該deploymentを削除し、`nutrition-sleep-app.vercel.app` と `nutrition-sleep-app-tsuno2.vercel.app` のProduction aliasを解除した。
- 削除後、Vercel API上の当該deploymentは404、active Production deploymentは0件、project domainsは空、Project Overviewは `No Production Deployment` となった。
- Production branch trackingを `phase1-production-disabled` へ変更し、同名Git branchが存在しないことを確認した。GitHub/Vercel Git連携は維持した。

## CR-002 Personal App Auth（2026-09-13）

- Supervisor/User承認によりメールOTP要件をsupersededとし、理由を個人専用アプリにおけるSMTP/OTP配送依存の削減と記録した。
- `signInWithPassword` → `persistAuthSession`へ認証経路を置換し、OTP request/verify route、OTP UI、Magic Link fallbackは削除した。
- Previewでは公開signupを無効化し、anonymous sign-inも無効のまま確認した。Auth userは単一の事前Provision済み利用者だけを対象とし、Production user/dataは作成していない。
- `APP_ALLOWED_USER_ID`をsession発行時・session読込時の両方で強制し、Origin検証をfail-closedへ変更した。
- `private.login_rate_limits`を追加し、Vercel `x-forwarded-for`のHMAC fingerprintだけを15分5回の共有rate limitへ保存する。
- password設定/復旧はlocal-only interactive utilityに限定し、対象ユーザーの全app sessionを失効させてからSupabase Auth passwordを更新する。passwordは引数/env/file/log/Gitへ残さない。
- Production Vercel / Production Supabase / main / Phase 2は変更していない。
