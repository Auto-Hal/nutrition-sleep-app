# Phase 1 実装ステータス

基準日: 2026-09-13 / 対象: `phase/1-foundation` / 状態: Final Hardening済み・Preview実機受入待ち

## 実装識別子

- GitHub repository: [Auto-Hal/nutrition-sleep-app](https://github.com/Auto-Hal/nutrition-sleep-app)（private）
- branch: `phase/1-foundation`
- current head: `86cf4c3dda69b8893cb8a4063b75a8b4f4305e40`（`fix: guard refresh persistence races`）
- Next.js: `15.5.24`
- eslint-config-next: `15.5.24`
- main bootstrap commit: `c473829439a82eac34284fe0bc6086d5fd99ef53`
- Phase 1 implementation commit: `3f80909`（履歴上の実装起点）
- Draft PR: [#1](https://github.com/Auto-Hal/nutrition-sleep-app/pull/1)（`phase/1-foundation` → `main`、未merge）

## 外部環境

- ENV-001: Supabase Proは使用せず、本アプリ専用organizationのFree project 2件を使用。
- 専用Supabase organization: `TsunoApp` (`vaupyfcztcoglwvqjict`)（Free）
- Preview project: `nutrition-sleep-preview` / ref `pprsfxpfljdjlwdfbtqo`（migration適用済み、検証用データなし）
- Production project: `nutrition-sleep-production` / ref `vyvnicyupcrsmtgdyypv`（schema/data未適用）
- 既存 `Auto-Hal's Org` (`ofmbnluuohkooklrhslo`) の `study-graph` / `money-canvas` は変更・pause・停止していない。
- Vercel team: `Tsuno` (`team_aTOsma3gZ9xkcFkGJ53dUCCO`)
- Vercel project: `nutrition-sleep-app` / ID `prj_WiPB989mXurOuIgVm8asfmfdPA6W`
- Vercel Preview deployment: GitHub Actions Preview run `34704461734` / deploy job `103581888948` / [https://nutrition-sleep-r77sgi2ri-tsuno2.vercel.app](https://nutrition-sleep-r77sgi2ri-tsuno2.vercel.app)
- Vercel Preview環境変数: `SUPABASE_URL`、`SUPABASE_PUBLISHABLE_KEY`、`DATABASE_URL`、`APP_SESSION_ENCRYPTION_KEY` をPreview専用に登録。値はGitHub/sourceへ保存していない。
- Production Vercel deployment、Production environment variables、Production Supabase schema/dataは未適用。

## Migration / DB

- migration 1: `supabase/migrations/20260912000000_phase1_foundation.sql`
- corrective migration: `supabase/migrations/20260912155034_phase1_profile_timezone.sql`
- DB test: `supabase/tests/phase1_rls.sql`（pgTAP 21 assertions）
- fresh replay: GitHub Actions CI run `34704461656` の database job `103581888528` で `supabase start` → `supabase db reset` → `supabase test db` → `supabase stop` をPASS。初期migration → corrective migrationの順で適用し、pgTAP 21 assertionsをPASS。
- Preview適用: Preview projectのSQL Editorで2 migrationを順に適用し、corrective migrationはSuccess。Productionには適用していない。
- corrective migrationは元migrationを変更せず、`pg_timezone_names`でIANA timezoneを検証し、`(now() at time zone new.time_zone)::date`をbirth/weightの日付検証に使用する。
- Preview実DB検証: User A `own=1 / sees B=0 / timezone=Pacific/Kiritimati`、User B `own=1 / sees A=0 / cross-update後のheight=175`、anonは`42501 permission denied`、invalid timezoneは`22023`、stale revisionは`40001`。検証用Auth/profileはrollback後0件。
- `private.app_sessions` はData APIへ公開せず、authenticated/anonに不要なtable privilegeを付与していない。RPCはSECURITY INVOKERでauthenticatedのみにEXECUTEを付与。

## Auth / session hardening

- OTP requestは`shouldCreateUser: false`を維持し、登録済みPreview userのみを対象とする。
- `lib/auth/refresh.ts` にbounded retry、短時間wait、lease再読込、expiry再評価、未解決時null返却を実装。
- refresh persistenceがrevision競合で0行になった場合は更新後tokenを有効扱いせず、最新rowを再読込して再評価する。
- `tests/session-concurrency.test.ts`: 同一sessionの並行refreshでrefresh実行1回・双方revision 2のfresh token、lease timeout時nullを確認。

## 自動検証

| 検証 | 結果 |
|---|---|
| `pnpm install --frozen-lockfile` | PASS |
| `pnpm lint` | PASS |
| `pnpm typecheck` | PASS |
| `pnpm test` | PASS（3 files / 8 tests） |
| `pnpm build` | PASS（Next.js 15.5.24） |
| `pnpm test:e2e` | PASS（Chromium + WebKit mobile、4 tests） |
| `pnpm verify:env`（安全なダミー値） | PASS |
| `git diff --check` | PASS |
| GitHub Actions CI run `34704461656` | PASS（checks + database） |
| GitHub Actions Preview run `34704461734` | PASS（Vercel deploy job `103581888948`） |

## 実機

- iPhone Safari / ホーム画面PWA: Preview URLは取得済み、ユーザー確認待ち。
- iPad Safari / 縦横・キーボード: ユーザー確認待ち。
- PlaywrightのChromium/WebKit mobile検証は通過したが、実機合格の代替にはしていない。

## Phase 1受入条件

| ID | 判定 | 根拠 |
|---|---|---|
| F01 未認証保護 | PASS（Preview DB / E2E） | 未認証route保護、anon table拒否、未認証RPC拒否を確認。 |
| F02 メールOTP | PARTIAL | `shouldCreateUser: false`とEmail providerを確認。Preview userの事前Provisionと実OTP受信・入力は未実施。 |
| F03 セッション | PASS（unit） / PARTIAL（実Auth） | encrypted server session、refresh lease、bounded concurrent refresh testはPASS。実Supabase token refreshは実ユーザー受入待ち。 |
| F04 RLS | PASS（Preview + CI） | RLS enabled+forced、owner policy、A/B相互不可視、anon拒否、pgTAP 21 assertionsを確認。 |
| F05 private schema | PASS（Preview + CI） | `private.app_sessions`のData API非公開と不要privilegeなしを確認。 |
| F06 Profile/revision | PASS（Preview + CI） | revision `1→2`、stale `40001`、invalid timezone `22023`を確認。 |
| F07 fresh migration | PASS | 初期migration → corrective migrationのfresh replayとpgTAPをPASS。 |
| F08 IA / empty states | PASS | Today / Nutrition / Sleep / Settingsの4固定タブ、Settings / Library切替、empty状態をbuild/E2E確認。 |
| F09 iPhone | BLOCKED | ユーザーの実機操作確認待ち。 |
| F10 iPad | BLOCKED | ユーザーの実機操作確認待ち。 |
| F11 通信断 | PARTIAL | 保存失敗を成功表示しないUIは実装。offline queue/復帰照合はPhase 6対象。 |
| F12 環境分離 | PASS（構成） / PARTIAL（Production未検証） | 専用Free organizationのPreview/Production project、Preview専用Vercel envを確認。Production schema/dataは未適用。 |
| F13 Production verification | BLOCKED | main merge、Production migration/deployはSupervisor承認前のため未実施。 |

## 未解決事項

1. Preview Auth userをメールアドレスで事前Provisionし、OTP requestが422ではなく送信受付になることを確認すること。実OTP受信・入力はユーザー実機レビューで行う。
2. iPhone / iPadでPreviewのログイン、4タブ、Settings / Library、Profile保存、iPad縦横を確認すること。
3. 専用Supabase migration ledgerはSQL Editor直接適用のため、CLI適用履歴の正規化は別途判断が必要。
4. CR-001（旧Fitbit Sleep v1.2 superseded）のAstra審議をPhase 5開始前に完了すること。

## Phase 2開始前のSupervisor判断

- Preview OTP・実機受入の対象commitと証跡を承認するか。
- Preview migration/RLS/revision/session hardeningの結果を承認するか。
- Production Supabase schema/data、Production Vercel deployを開始してよいか（現時点は禁止）。
- CR-001の採用APIとprovider-neutral境界を承認するか。未解決のままPhase 5へ進めない。

main merge、Production migration、Production deploy、Phase 2開始は、Preview・実機レビューとSupervisor承認が完了するまで行わない。
