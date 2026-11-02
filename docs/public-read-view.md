# 公開閲覧（2026-11-02）

最新状態: 後続の総合更新も別途明示承認され、Productionへ反映済み。[本番リリース記録](nutrition-comprehensive-update/13-production-release-2026-11-02.md)を参照。下記の18項目版限定リリースは履歴であり、現在の30コード/outbox 2対応後に旧18項目版へ戻す手順として使用しない。

所有者の指示「Preview/Productionのログインを外す」「誰でも閲覧で良い」に対応する限定変更。29項目等の総合アップデートの本番承認とは別です。

## 公開範囲

`APP_PUBLIC_READ_ENABLED=true` を設定した環境では、未ログインの訪問者が Today、食事履歴、栄養分析、睡眠を閲覧できます。総合アップデート側では PFC/月間/週間・体重の読み取り表示も対象とします。新たなログインやユーザー別アカウントは作りません。

登録・修正・削除・JSON/CSV書き出し・画像転送履歴の更新・OAuth同意・Google Health接続/同期・ChatGPTからの登録は、従来の本人セッションとAPI認証が必要です。ログイン済み本人の画面/操作は維持します。通常アクセスでログイン画面を経由しません。「編集用ログイン」は明示的な操作入口です。

メール、認証/連携トークン、ログインセッション、未確定ChatGPT下書き、非公開管理テーブルは公開しません。公開ブラウザーでoutboxを起動せず、所有者の未同期記録を読まず送信もしません。

## 読み取り経路

- server-onlyのData APIクライアントに、内部専用のread selectorを渡します。外部HTTP APIやSupabase認証が受け付けるトークンではありません。
- SELECT用テーブル/列、演算子、RPCを明示的に限定。値はすべてSQLパラメーター。リクエストから所有者ID/SQL識別子を自由指定できません。
- 既存DB接続上で `READ ONLY`、`SET LOCAL ROLE authenticated`、環境の `APP_ALLOWED_USER_ID` に固定したtransaction-local JWT claimsを設定します。既存RLSを使い、複数ユーザーのデータを混在させません。COMMIT/ROLLBACKでrole/claimsが解除されます。
- SECURITY DEFINER関数経由を含め書き込みをDB側のread-only transactionでも拒否。匿名GRANTやRLS変更、DB migration、実データ変更は不要です。
- API/ページはno-storeの既存方針を維持。秘密情報やDB例外をクライアントへ返しません。

## 検証と反映

単体テストでquery allowlist、パラメーター化、write拒否、role/ownerの設定順、欠損/ページング、秘密情報の非表示を検証します。使い捨てloopback DBで別ownerの非表示、read-onlyのDB強制、3ブラウザーで公開ページと匿名書き込み/エクスポート拒否、セッション未発行を確認します。

Production用は既存mainの18項目版を起点とする限定ブランチから反映。総合更新側はこの変更を取り込みPreviewへ反映します。mainへのマージやProduction DB更新を伴わせません。

本番ビルドでも実際のSupabase URL/DB接続先のproject一致を検査するため、総合更新で検証済みのtarget verifierとリモートPreview build手順だけを共通化します。

公開を停止する場合はフラグをfalseにして再ビルド/反映。公開済み情報を第三者の保存先から回収できることは保証しません。以前の認証必須app deploymentへの戻しもDB変更なしで可能です。総合更新のDB/アプリのロールバック条件は既存設計書を参照してください。
