# 栄養・睡眠管理アプリ — Phase 1 Foundation 設計・実装計画

作成日: 2026-09-12 / 状態: IMPLEMENTED・外部環境／実機受入待ち

基準はユーザー提示の「Astra Handoff / MVP Requirements v1.1」。Phase 0 APPROVEDを維持する。本書はPhase 1開始前の設計案であり、要件正本の改訂でもPhase 1承認記録でもない。DOCXファイル自体はこのワークスペースに提供されていないため、DOCXとの実ファイル照合は未実施。

## 1. 提案する到達点

新規の分離環境で、iPhoneからログインし、4タブを移動し、自分のプロフィールを保存・再表示できること。別ユーザーへのデータ漏洩をDBとAPIで検証し、空DBからのmigration再生、CI、Preview、iPhone/iPad実機、承認後の本番検証まで通す。

Phase 1完了はMVP完成を意味しない。食事記録、Snapshot、商品登録、OCR、栄養評価、睡眠同期、offline queue、exportはそれぞれ後続Phaseで実装する。

| 区分 | Phase 1の対象 |
|---|---|
| 画面 | Today / Nutrition / Sleep / Settings、Settings内のSettings・Library切替 |
| Today | 朝・昼・夕の固定枠と将来の入力導線の骨格。食事データ未実装を明示し、0 kcalやskippedを生成しない |
| Nutrition / Sleep / Library | 空状態・未提供状態・loading/error。架空の栄養値や同期済み表示を出さない |
| Settings | 基本プロフィール、体重と更新日を参照値として保存・表示 |
| 認証 | Supabase AuthのメールOTP、セッション更新、ログアウト、利用者間分離 |
| 基盤 | Next.js + TypeScript、Supabase migration/RLS/RPC、GitHub Actions、Vercel Previewと本番ゲート |
| PWA検証 | manifest、ホーム画面起動、safe area、カメラ取得・撮影、外部認証からの復帰の技術検証 |

## 2. 要件に影響する外部変更

**CR-001: Required Change。旧Sleep v1.2指定はsuperseded / do not implement。**

Fitbit公式のSleepページは、旧Fitbit Web APIを2026年9月に非推奨化しGoogle Health APIへ移行する旨を案内している。これは旧Sleep v1だけの話ではない。今回確認した案内だけでは、対象ユーザーに対する正確な停止日や、新規アプリの利用可否までは断定しない。[Fitbit公式案内](https://dev.fitbit.com/build/reference/web-api/sleep/)

Googleの移行資料には、OAuth・エンドポイント・応答形式の変更と、旧access/refresh tokenを移せず再同意が必要なことが記載されている。API名だけの置換として扱わない。[Google公式移行ガイド](https://developers.google.com/health/migration)

詳細なRequired Changeは[CR-001](./cr-001-fitbit-api.md)に記録する。Phase 1のAuth・RLS・4タブ骨格は独立して進め、health provider固有のOAuth schema・token形式・接続テーブルは作成しない。CR-001はPhase 1とは別トラックでAstraが審議する。Phase 1はこの調査を待たず、承認範囲の受入条件が揃えば完了できる。ただしPhase 1完了をhealth provider連携の実現・同等性の証明とは扱わない。

## 3. ENV-001: Dedicated Supabase Account / Two Free Projects

Supervisor判断（2026-09-12）により、Supabase Pro契約と既存organizationのprojectは使用しない。新しいSupabaseアカウントを本アプリ専用にし、Free枠の2 projectをPreview / Productionへ割り当てる。Study Graphとmoney-canvasのrepo、Supabase、Vercel、環境変数、OAuth登録、データ、接続設定は再利用・変更しない。

| リソース | 提案 | 分離方法 |
|---|---|---|
| GitHub | private repo `nutrition-sleep-app` | mainを実装正本。PR・必須CI・force push禁止 |
| Supabase local | このrepo専用CLI/Docker構成 | 合成データのみ。CIも毎回独立DB |
| Supabase Preview | 新しい専用アカウントの `nutrition-sleep-preview` | 検証用アカウント・合成プロフィールのみ |
| Supabase Production | 新しい専用アカウントの `nutrition-sleep-production` | Previewと別project ref・DB・Auth・Storage・secret |
| Vercel | 新規 `nutrition-sleep-app` | Preview/Productionごとに接続先を固定 |
| リージョン | Supabase東京、Vercel実行地域も近接を第一候補 | 作成時に提供状況を確認 |
| メール | アプリ専用のSMTP資格情報・送信元 | Study GraphのSMTP設定を流用しない |

PreviewとProductionは完全に別projectとし、DB・Auth・Storage・secretを共有しない。migrationは同じsourceから両環境へ適用できる形にする。Production固有の手作業schema変更は行わず、Previewで検証済みのmigrationだけをSupervisor承認後にProductionへ適用する。PreviewのDBを変更する受入候補は同時に1本だけにし、CIの環境ロックでmigrationから実機受入まで競合を防ぐ。候補変更時は実機証跡を失効させる。

作成前にGitHub owner、専用Supabaseアカウント、Vercel team、利用枠、メール送信元を実アカウントで確認する。Supabase新アカウントのログイン・OAuthが必要になったらユーザー操作で停止し、認証後に2 projectを作成する。環境IDの対応表を作り、migration/deployの対象照合に使う。Supabaseアカウント資格情報はGitHub、Vercel、source codeへ保存しない。secretの値は文書化しない。

Node.jsは22以上のサポート対象を使用し、作成時にNext.js/Vercelとの互換性を確認して正確なバージョンを固定する。TypeScript、Supabase SDK/CLI、Vercel CLIも固定しlockfileをcommitする。Node.js 20向けの古いCI雛形をそのまま使わない。[SupabaseのNode.js 20サポート終了案内](https://supabase.com/changelog/45715-deprecation-notice-dropping-support-for-node-js-20)

## 4. アプリケーションとAuthの境界

提案: Next.js App Routerを使い、ブラウザ → 同一originのNext.jsサーバー → Supabaseとする。画面からDBを直接操作せず、サーバーの境界で認証・入力検証・所有権確認を行い、DBのRLSでも制限する。

認証方式はメールOTPを第一候補とする。コードを元の画面へ入力するため、メールアプリへ移動した後もSafari/PWAの元の認証フローへ戻れる設計にする。Phase 1は登録済みの利用者のみを対象とし、公開signupと匿名ログインは無効。管理UIの開発は含めず、専用runbookで初期利用者を作成する。

Supabase OTPはメールテンプレートを設定し、サーバーで送信要求・検証を行う。[SupabaseメールOTP](https://supabase.com/docs/guides/auth/auth-email-passwordless)。新規Freeプロジェクトの標準SMTPにはテンプレート変更の制約があるため、専用SMTPの利用条件を環境作成時に確認する。[公式変更案内](https://supabase.com/changelog/46599-changes-to-email-template-customisation-on-free-tier)

要件のtoken非露出を満たすため、以下のBFF方式を提案する。一般的なブラウザSupabase client構成よりサーバー側のセッション処理が増えるが、プロバイダーtokenをクライアントへ渡さない。

- ブラウザに渡すのは推測不能なアプリ用セッションIDだけ。Secure / HttpOnly / SameSite=Lax / Path=/、Domainを指定しないcookieとする。JavaScript・localStorageへ認証情報を保存しない。
- Supabase access/refresh tokenは非公開schemaのサーバーセッションに暗号化保存。暗号鍵はDB外の環境別secret。cookieのセッションIDはハッシュ化してDBで照合する。
- セッションの失効・期限を毎回確認し、Supabase JWTを検証して利用者を確定する。`getSession()`内のuserをそのまま信用しない。認証応答・健康データ応答に共有キャッシュを使わない。[Supabaseサーバー認証](https://supabase.com/docs/guides/auth/server-side/creating-a-client)
- 通常のプロフィール照会・更新には利用者JWTを使い、RLSを通す。管理用secret/service-roleを通常CRUDに使わない。
- セッション保管専用の最小権限DBロールをサーバーだけが使う。プロフィール等への権限、DDL権限、BYPASSRLSを与えない。資格情報は環境別に管理する。
- refreshはDBのleaseとrevisionで直列化し、複数端末リクエストや複数サーバー間で古いtokenが新しいtokenを上書きしない。refresh成功後の永続化失敗は再認証へ誘導し、更新済みと偽らない。
- logoutはアプリセッションを失効してcookieを削除し、Supabase側のセッション失効も行う。Supabase JWT単体の即時失効を保証する実装だとは表示しない。
- OTP送信・検証をrate limitし、存在するメールかを外部へ区別して返さない。OTP・メール・Authorization・cookie・健康値をログへ出さない。
- mutationはPOST等に限定し、許可originの検証とCSRF対策を行う。任意のreturn URLを受け入れない。CSP等のヘッダーは実際のNext.js出力で検証する。
- 生存期限案は無操作7日・絶対30日。期限切れ時は再ログインし、値を0や正常へ補完しない。

アプリ用セッションIDはWebログイン維持に必要な資格情報であり、HttpOnly cookieとしてのみ保持する。外部プロバイダーtoken・管理secret・他人の健康データはブラウザへ送らない。本人向け画面に必要な本人の値だけをレスポンスへ含める。

## 5. Phase 1の物理データ範囲

UserはSupabase管理の`auth.users`へ対応付け、別のパスワードDBを作らない。ドメインテーブルは`user_profiles`のみ。技術テーブルは非公開schemaの`app_sessions`とする。Meal、CatalogItem、Nutrient、SleepSession、FitbitConnection、health provider固有の接続テーブルを未決のまま先行作成しない。

| user_profiles項目 | 意味・制約 |
|---|---|
| user_id | auth.usersへのFK、PK。クライアント入力で所有者を変更できない |
| birth_date | nullable date。年齢は参照日から算出し、別の固定年齢を正本にしない |
| sex | nullable。male/femaleを基準計算用の入力として保持。未回答はNULL。Phase 1では栄養評価へ使わない |
| height_cm / weight_kg | nullable numeric、入力時は正数。NULLを0にしない |
| weight_updated_on | nullable date。体重と更新日を一緒に保存し、両方NULLまたは両方あり |
| activity_level | nullable low/moderate/high。自己申告の低い/ふつう/高い。DRI係数への対応はPhase 4で決定 |
| nutrition_goal_note | nullableのユーザー入力目標。Phase 1は文字数制限付きで保存し、目標栄養量を計算しない |
| time_zone | IANA time zone。初期Asia/Tokyo。後続Phaseの摂取日付や睡眠日付を自動で再割当しない |
| revision | 初期1、更新ごとにDBで1増加。競合検知用 |
| created_at / updated_at | DBが付与するtimestamptz |

プロフィールは部分入力を許容する。birth_dateと更新日は未来日を拒否する。プロフィールだけの保存成功と、食事・睡眠データの完全性は無関係。栄養目標の数値・DRI・complete判定はPhase 4開始設計で確定する。

`app_sessions`はsession IDのハッシュ、user_id、暗号化token、鍵バージョン、expires_at、last_seen_at、revoked_at、revision、refresh leaseを持つ。平文secret、OTP、健康情報をこのテーブルへ追加しない。期限切れ行の清掃は運用手順に含める。

## 6. RLS / RPC / index / permissions

公開schemaの全テーブルでRLSを有効にし、GRANTもmigrationへ含める。新規プロジェクトではテーブルを作るだけでData APIから利用できるとは限らない。[Supabase Data API変更案内](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically)

| 対象 | anon | authenticated | サーバーセッション専用role |
|---|---|---|---|
| user_profiles SELECT | 拒否 | auth.uid() = user_idのみ | 拒否 |
| user_profiles INSERT | 拒否 | 本人の行のみ | 拒否 |
| user_profiles UPDATE | 拒否 | USING/WITH CHECKとも本人。所有者変更を禁止 | 拒否 |
| user_profiles DELETE | 拒否 | 拒否。アカウント削除はPhase 6設計 | 拒否 |
| app_sessions | schemaへのアクセスを拒否 | schemaへのアクセスを拒否 | セッション処理に必要な操作のみ。role専用RLS |

プロフィール保存RPCはSECURITY INVOKERを原則とし、`auth.uid()`から所有者を確定する。`expected_revision`を指定し、更新対象の現在revisionと一致した場合だけ保存する。PK競合した初回作成を無条件upsertで上書きしない。DB triggerで所有者不変、時刻、revision増加を保証し、APIからの直接操作もテストする。

更新結果を読み取れなかった場合は同じ変更を盲目的に再送せず、現在値とrevisionを取得して照合する。他端末の更新は409相当で再読込を促す。Phase 1で食事用の汎用idempotency基盤を先行実装しない。

関数はPUBLIC/anonへの既定EXECUTEを取り消し、必要なroleだけに許可する。固定search_pathと完全修飾名を使う。SECURITY DEFINERが必要になった場合は新しい高リスク判断としてAstraへ戻す。通常のpermission errorの回避に使わない。

user_profilesはuser_idのPK indexで本人照会を支える。app_sessionsはsession hashの一意indexとexpires_atの清掃用indexを持つ。将来のowner付き親子関係は複合FK等で越境参照を防ぐが、対象テーブルを作るPhaseで確定する。view追加時はRLS継承も検証する。[Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)

## 7. migration方針

1. 専用local DBでschema・制約・RLS・権限・RPCを検証する。
2. Supabase CLIの実バージョンとhelpを確認してmigrationを生成する。schema/RLS/grants/関数/trigger/indexを同じ変更単位に含める。
3. 空DBへ全migrationをfresh replayし、合成ユーザーA/Bを作ってDB/APIテストを行う。
4. 次のmigrationからは前main schema→PR schemaのupgradeも検証し、既存値が維持されることを確認する。
5. 生成型とのずれ・DB advisorの指摘を確認し、適用済みmigrationは書き換えず追加migrationで修正する。
6. Preview適用時はproject refと環境名を照合し、適用履歴を記録してから実機確認へ進む。
7. Productionでは同じmigrationを適用する。remote reset、実データseed、既存履歴を消すdown migrationは実施しない。

Auth設定・SMTP・環境変数・DB roleのパスワードはSQL migrationだけでは再生できないため、値を含まないprovisioning手順と環境検査を別途残す。migrationにはroleの権限構造のみを含め、資格情報はsecret管理で注入する。

食事Snapshotの不変性はPhase 2、Fitbit冪等upsertはPhase 5で実装する。Phase 1でそれらの実装済み・検証済みを宣言しない。契約として「Unknown≠0、Summaryは派生、後日のマスタ更新で過去Snapshotを変更しない」を後続handoffへ引き継ぐ。

## 8. 実装順序とモデル割当

| 順序 | 作業単位 | 担当 | 完了証拠 |
|---|---|---|---|
| 0 | 本計画の開始設計を確定 | Astra + ユーザー | 承認対象・条件・CR-001の扱いを記録 |
| 1 | 新規repoと環境、lockfile、基本CI | Luna MAX | 分離確認、lint/typecheck/test/build成功 |
| 2 | migration/RLS、Authとサーバーセッション | Luna MAX | fresh replay、A/B/anon、失効・refresh競合テスト |
| 3 | 4タブ、Settings/Profile、PWA骨格 | Luna MAX | 保存・競合・空状態・responsive E2E |
| 4 | Preview、iPhone/iPad実機、技術検証 | Luna MAX + 実機担当ユーザー | 同じcommitの実機証跡・未達項目 |
| 5 | Phase完了・高リスク境界レビュー | Astra | 不変条件、環境分離、証跡の確認 |
| 6 | ユーザー承認→main→本番検証 | Luna MAX、移行判断はAstra | 本番commit・migration・検証記録 |

テーマごとにfeature branchとPRを作る。通常のUI・tests・CI修正はLuna MAXで完結。AstraはAuth/RLS/セッションの高リスクPR、設計変更、Phase境界に限定する。Phase 2は別チャットで開始する。

空repoの初期mainはREADME・承認済み設計等のbootstrapのみとして記録し、アプリ実装は最初からfeature branchへ置く。GitHubの保護設定やEnvironment reviewer機能は契約で利用可否を確認し、使えない場合は自動main更新・自動本番公開を止め、ユーザー承認を検証する手動ゲートにする。

## 9. CI → Preview → main → Production

必須CIは、frozen lockfile install、ESLint、TypeScript noEmit、unit/integration、DB fresh replay、DB/RLS/RPC tests、Next.js production build、Playwright E2E、secret検査。CIは合成データとlocal Supabaseだけで完結させる。Actionsはcommit SHAで固定し、通常ジョブはcontents:readを基本とする。

PRの未信頼コードへremote DB資格情報やdeploy secretを渡さない。fork PRはlocal検証のみ。信頼済み候補のdeploy専用ジョブをCI成功後に起動し、権限をEnvironmentごとに限定する。health値入りのスクリーンショット・trace・ログはGitへ入れない。受入証跡は合成データを使用する。

Vercelの自動デプロイと独自CIが二重に本番公開しないよう、デプロイ入口をGitHub Actionsに一本化する。

1. feature branchで実装・ローカル検証・commit・PR。
2. 必須CI成功後、Preview DBへmigrationを適用。CLIでPreview環境をpullし、build→prebuilt deploy。
3. Preview E2EとiPhone/iPad実機。URL・commit SHA・migration識別子・端末/OS・結果を記録。
4. 変更が入れば影響チェックを再実行。受入後の別commitを無検証で通さない。
5. ユーザーが対象commitと実機結果を承認してからmainへmerge。mainのCIも再確認する。
6. mainと承認済み候補の差分を照合し、Production専用環境変数で再buildする。Previewの接続先を埋め込んだartifactをそのまま本番へ流用しない。
7. 本番DBの復旧手段とmigration互換性を確認して適用。Production設定で作成したstaged deploymentを検証し、成功後にdomainを割り当てる。
8. 本番URLで認証・プロフィール・アクセス拒否・ログを再確認し、Production verificationを記録する。

Vercelはstaged productionを作り、後からdomainを割り当てる手順を提供している。採用CLIのhelpと現行仕様でコマンドを確定する。[Vercel deploy](https://vercel.com/docs/cli/deploy)、[本番への昇格](https://vercel.com/docs/deployments/promoting-a-deployment)

本番のアプリ切戻しとDB復旧は別操作。互換性を保つ追加migrationを基本とし、公開失敗時はdomain切替を止める。初回公開で戻し先がない場合は未公開/メンテナンス状態を維持する。本番の健康データを上書きするDB復元は自動化しない。

Phase 1のProductionはFoundationの限定受入用。全MVPの利用開始判定はPhase 6で行う。

## 10. 受入テスト

| ID | 確認項目 | 合格基準 |
|---|---|---|
| F01 | 未認証アクセス | ページ/API/DBとも保護。private dataのHTML埋込みなし |
| F02 | OTP | 正常・誤入力・期限切れ・再利用・連打を確認し、tokenはJS/URL/logに出ない |
| F03 | セッション | refresh同時要求、失効、logout、再起動。logout後は既存アプリsession IDも拒否 |
| F04 | RLS | anon拒否、AはAのみ、BからAのread/write/所有者変更/delete/RPCを拒否 |
| F05 | private schema | anon/authenticatedからapp_sessionsへ到達不可。専用roleからprofile操作不可 |
| F06 | Profile | NULL・部分入力を保持。単位、未来日、体重更新日、2端末revision競合を検証 |
| F07 | migration | 空DB再生、型整合、権限、関数、indexを確認。後続変更はupgrade経路も確認 |
| F08 | IA | 4タブ固定、Settings内Library。未提供を0摂取・正常睡眠・同期済みにしない |
| F09 | iPhone | Safariとホーム画面起動でOTP→Today→Settings保存→再表示→logout成功 |
| F10 | iPad | 縦横、タブ、キーボード、Settings入力に横溢れ・操作不能がない |
| F11 | 通信断 | 保存応答前後の切断で保存済みを断定せず、復帰後にDB値/revisionを照合 |
| F12 | 環境分離 | Preview→Preview DB、本番→本番DB。誤接続は検査で失敗させる |
| F13 | 本番 | 承認されたmainに対応し、認証・保存・拒否ケース・機密ログを再確認 |

実機証跡には端末名、OS、Safari/PWA、縦横、日時、commit、Preview URL、期待値、実測結果を記録する。PlaywrightのWebKit/mobile viewportだけでは実機合格としない。ユーザーによる実機結果が未提供ならF09/F10は未達のまま残す。

PWAはmanifestとHTTPS、ホーム画面からの起動を検証する。Phase 1でofflineデータキャッシュやバックグラウンド同期を完成扱いしない。[Next.js PWAガイド](https://nextjs.org/docs/app/guides/progressive-web-apps)

## 11. 早期の技術実証と未決事項

後半で方式変更が必要になるリスクを検出するため、製品機能とは分けた小さな技術実証をPhase 1に含める。

- カメラ: Safari/PWA双方で背面カメラ・許可/拒否・撮影画像の取得・アプリ復帰を確認。検証画像はメモリ内で扱い永続化しない。
- バーコード: 合成/公開テストコードを読み取れる方式を検証。ブラウザ標準APIだけに依存せず代替decoderを評価する。本番の商品DB接続はPhase 3。
- OCR: 日本語ラベルの画像取得が可能かを検証。provider・精度・source priority・目視確認UIはPhase 3開始設計で決める。画像取得成功をOCR合格とは呼ばない。
- OAuth: Phase 1ではprovider-neutralな外部画面復帰の境界だけを確認する。実Fitbit/Google Healthでの同意・callback・失敗復帰はCR-001の別トラックで扱い、Phase 1の合格条件に含めない。模擬callback成功を実連携合格にしない。
- 重大なPWA制約が確認されたら、要件を弱めず代替方式の比較と差分を提示する。方式変更は承認前に実装しない。

実装前の確定事項は、環境の所有者・契約枠、OTP送信元、上記Auth案、プロフィール入力案、CR-001の調査/変更範囲。秘密値をチャットへ貼り付ける必要はない。

## 12. Luna MAXへのhandoff

**状態:** Phase 1の承認済み範囲を実装済み。ローカル検証は完了し、GitHub private repository、分離Supabase、Vercel Preview、実機確認は外部環境の準備後に実施する。main mergeとProduction移行は未実施。

- **決定事項:** 承認された版の本書を参照。Next.js/TS + 独立Supabase + Vercel。メールOTP、BFFセッション、利用者JWTによるRLS、4タブ、Settings参照プロフィール、CIから本番までのゲート。
- **不変条件:** Study Graph無変更、Unknown≠0、他人のデータ拒否、secret/token非露出、未保存を保存済みとしない。食事Snapshot等の後続契約を保持。
- **変更対象:** 新規repoのアプリ骨格、Auth/Profile、migration/RLS/RPC、CI、検証手順、専用環境。
- **非対象:** Meal/Product/Batch/Supplement/Nutrition評価/Sleep同期、Fitbit/Google Health等のprovider固有OAuth・schema・token実装、ランタイムLLM、BodyMeasurement、offline queue/exportの製品実装。
- **Acceptance criteria:** F01〜F13と技術実証の結果、残課題、ユーザー承認、Production verificationを記録。未達を合格としない。
- **Migration:** 新規作成あり。既存ユーザーデータの移行なし。fresh replay必須。適用済みmigration改変禁止。
- **Astraへ戻す条件:** Auth/RLS・session意味論の変更、要件との矛盾、履歴・日付・欠損・completeの意味変更、CR-001の採用判断、PWA方式変更、Phase完了判定。

承認後も通常実装はLuna MAXへ渡し、Astraが同テーマの実装全文を書き続けない。外部APIの要件差分承認はPhase 1基盤設計の承認と区別して記録する。
