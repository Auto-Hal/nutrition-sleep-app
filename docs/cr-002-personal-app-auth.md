# CR-002: Personal App Auth Simplification

基準日: 2026-09-13 / 状態: Supervisor承認済み・Phase 1実装中

## 決定

メールOTP要件は **superseded** とする。個人専用アプリに対してSMTP、Magic Link、OTP配送へ依存する構成は過剰であり、認証配送障害を健康データの閲覧可否へ持ち込まないためである。Supabase Authと`auth.uid()`による本人識別、本人限定RLS、server-sideの暗号化app sessionは維持し、事前登録済みの単一ユーザーによるemail/passwordログインへ簡素化する。

- public signupとanonymous sign-inはPreviewで無効化する。アプリにsignup routeは存在しない。
- `/api/auth/login`だけがログイン入口で、`signInWithPassword`の結果を既存`persistAuthSession`へ渡す。
- `/api/auth/request-otp`と`/api/auth/verify-otp`は削除し、Magic Link fallbackも実装しない。
- `APP_ALLOWED_USER_ID`を認証成功直後のsession発行と、cookieからのsession読込の両方で照合する。不一致は認証済みとして扱わない。
- passwordはSupabase Authの管理領域だけに保存する。アプリDB、browser storage、response、URL、ログには保存しない。

## State-changing API

ログイン、ログアウト、Profile保存は`Origin`が設定済みの`APP_ORIGIN`と完全一致する場合だけ受け付ける。Originまたは設定値の欠落も拒否するため、fail-openにはならない。ログイン応答は`Cache-Control: no-store`で、認証失敗（誤password、未登録、許可外user）は同じ401本文を返す。

## Login rate limit

Preview migration `20260913120000_cr002_login_rate_limits.sql` がserver-onlyの`private.login_rate_limits`を追加する。15分窓で5回までを許可し、6回目以降は429と`Retry-After`を返す。Vercelの`x-forwarded-for`の最初の値を入力にするが、保存値は`APP_LOGIN_RATE_LIMIT_KEY`によるHMAC-SHA-256（64桁hex）のみで、raw IPをDB・ログへ書かない。成功時は同じfingerprintのbucketを削除する。DB障害時は認証を継続せず503とする。

## Password setup / recovery

`pnpm auth:admin -- set-password`または`recover-password`は、local interactive terminalでのみ実行できる。service role keyは一時的なlocal環境変数として渡せるが、passwordは引数、環境変数、ファイル、ログに渡さず、非表示のstdinへ2回入力する。utilityは`private.app_sessions`の対象ユーザーの全行を先に失効させてからSupabase Auth passwordを更新する。Productionでは実行しない。

## 維持する不変条件

- access/refresh tokenは暗号化された`private.app_sessions`だけに保存し、browserへ返さない。
- cookieはDB session保存が成功した後だけ発行する。
- refresh lease、revision、bounded retryのA〜D意味論を変更しない。期限切れtokenを有効扱いしない。
- RLSは`auth.uid()`本人行だけを許可し、private schemaはData APIとanon/authenticatedから閉じる。
- Unknown / missingを0や正常値へ変換しない。
- Production Supabase、Production Vercel、main、Phase 2は変更しない。

## 検証計画

自動検証はpassword login routeの契約、旧OTP routeの404、Origin欠落/不一致、HMAC-only rate limitの同時実行（5成功・6回目429・成功後解除）、DB session保存失敗時のcookie不発行、allow-list強制、refresh A〜D、fresh migration / pgTAP / RLS / revisionを対象とする。Previewでは同じHTTP契約に加えて、事前Provision済みユーザーの正しいpassword、誤password・未登録・許可外userの同一401、signup/anonymous拒否、OTP route不存在を確認する。

## Phase 1受入変更

旧F02「メールOTP」は「事前Provision済み単一ユーザーのemail/password」と置換する。OTP受信確認は受入対象から削除し、Previewのpassword login成功、全401同値、signup/anonymous拒否、Origin fail-closed、rate limit、session秘匿を必須項目とする。実機ではiPhone/iPadでpassword login、4タブ、Settings / Library、Profile保存、縦横表示を確認する。
