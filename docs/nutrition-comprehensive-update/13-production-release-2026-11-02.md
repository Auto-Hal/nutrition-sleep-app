# 栄養管理総合アップデート 本番リリース記録

2026-11-02（Asia/Tokyo）。所有者の「良さそうです 本番へ反映してください」と再開指示に基づき、本アップデートのProduction DB・mainマージ・アプリ/Edge反映を実施した。設計・実装段階の未承認表記は本記録で更新する。所有者の確認・承認と、記録を取得していない物理端末/OCR/OAuthの検証は別である。

## 公開先とソース

| 対象 | 確定した状態 |
|---|---|
| Production | https://nutrition-sleep-app.vercel.app / READY、ログインなしで閲覧 |
| 配信ソース | `81519db95b49d074d8b95da441c15a1dca8e108f` |
| Production deployment | `dpl_GNYctPgVLbvRxufXafgT4Mmc6qg2` / https://nutrition-sleep-6hi9y3k4o-tsuno2.vercel.app |
| mainマージ | [PR #47](https://github.com/Auto-Hal/nutrition-sleep-app/pull/47)、`d6675ae3a8398b50d83c80d44f6e8595cfa6e4f0` |
| ソース照合 | マージ直後のmainの全ファイルが81519dbと一致（`git diff --exit-code`成功） |
| Preview | https://nutrition-sleep-cst6eaz8y-tsuno2.vercel.app / `dpl_c9s8yTKgPCuX1YCfkme2XQcrjKh6` / 同じ81519db |
| DB | Production `vyvnicyupcrsmtgdyypv`、Preview `pprsfxpfljdjlwdfbtqo`。混在なし |
| 本番MCP | `nutrition-mcp` v1 ACTIVE / bundle SHA256 `254f74f8e93f701418ec406daa50f488c5a3535344c4421d300010a14189505b` |

承認済み81519dbを、VercelのProduction環境で公開ドメインを割り当てず先行ビルドした。[staging workflow 41408360259](https://github.com/Auto-Hal/nutrition-sleep-app/actions/runs/41408360259)で専用本番Supabase URL/DB project照合とlint/test/buildを通し、検証中の公開URLが旧c45925bのままであることを確認した。先行URLでの検証後にPRをマージし、Vercel promoteで同じartifactを公開URLへ割り当てた。再ビルドによる差し替えはしていない。

`/api/app-version`は完全な81519db SHAを返す。`outbox_contract_version=1`は旧操作の既定値であり、対応する契約集合は1/2、新規操作は明示的に2を使用する。値が1であることを新機能未反映と解釈しない。

## 反映した製品機能

全経路・数値仕様・残る制限の詳細は[12の対応表](12-feature-coverage-and-verification.md)、操作は[10](10-preview-acceptance-and-production-plan.md)、ChatGPT向けは[11](11-chat-v2-instructions.md)を参照する。

| 画面/領域 | 本番に反映した内容 |
|---|---|
| 栄養データ | 標準29項目＋内部Na。Catalog/Product、バーコード/OCR、Chat v2、Batch、snapshot、日/7/30/90日、改善順位、JSON/CSV/PNGを拡張。未知と0・由来・定義/化学形態・推定を区別 |
| Settings → 食事目標 | 1800 kcal・25/20/55、P112.5/F40/C247.5gの初期値。比率100%検証、許容幅、履歴/開始日、プロフィール参考計算、トレーニング/休養日別 |
| Today / 履歴 | カロリー/PFCの既知量、暫定進捗、目標との差分、品質・完全記録・未同期。既存食事入力と過去履歴、転送入口を維持 |
| Nutrition | 日別/月間PFC、月間構成比と達成日数、週間帳尻合わせ、29項目詳細、従来7/30/90日・DRI・改善順位・食品内訳 |
| からだ | 体重/任意体脂肪の履歴CRUD、30/90日、観測数付き7日平均、目標体重/参考ペース、食事達成傾向。明示選択したプロフィール連動 |
| カロミル転送 | 食事/食品/Product/Batchの量を明示した基本7/全29 PNG、プレビュー/保存/共有/名称コピー、欠損通知、手動確認/取消。1対象1枚 |
| 出力 | JSON v1維持とv2、期間指定のCSV日別/食事別/食品別。不明本値は空欄/NULL、品質/既知量を別に保持。新履歴を削除/exportへ追加 |
| 公開閲覧 / Sleep | 5タブ・履歴の閲覧はログイン不要。登録・修正・削除・出力・転送履歴更新・外部連携は本人認証。既存睡眠ステージ/スコア/同期/分析を維持 |

正式なPFC判定は当時の目標・完全記録・対象栄養値の完全性・同期を条件とし、初期範囲は90〜110%の両端を含む。途中の既知量は正式判定と分けて常時表示する。月間比率はPFCエネルギー合計から算出し、週間は月曜〜日曜の各日の有効目標を合算する。未記録は摂取0としない。極端な翌日制限やproteinの週末まとめ摂りを提案しない。

目標開始前の過去日は正式達成判定を作らず、本人が選択した場合だけ現在の目標との参考比較を別枠で表示する。正式日数/週間残量へ入れない。PFC個人目標とDRIは別であり、基準のない項目や形態/対象源が比較不能な値を架空の基準で評価しない。

## DB migrationと前後照合

本番は旧台帳28件/18定義から、M1〜M8を順に1件ずつ適用し、台帳36件/30定義になった。Previewは旧24件＋8件の32件である。旧台帳のversionを書き換えず、Hostedへのreset/db push/repairやdown migrationを実行していない。

| 単位 | リポジトリSQLの先頭version / 名前 | Production台帳version |
|---|---|---|
| M1 | `20261101022326_nutrition_legacy_nutrient_bridge` | `20261102074541` |
| M2 | `20261101023441_nutrition_30_code_foundation` | `20261102074557` |
| M3 | `20261101025358_nutrition_goal_history` | `20261102074613` |
| M4 | `20261101092352_body_measurement_history` | `20261102074627` |
| M5 | `20261101101537_karomiru_transfer_snapshots` | `20261102074641` |
| M6 | `20261101104949_nutrition_csv_snapshot_source` | `20261102074651` |
| M7 | `20261101111309_nutrient_evidence_contract_guard` | `20261102074703` |
| M8 | `20261101142455_complete_catalog_library_read` | `20261102074716` |

SQLは承認済み81519dbの不変ソースを使用した。M6/M8だけセッションのlock_timeout=5s/statement_timeout=60sとresetで囲み、関数内容は変更していない。各適用成功後に照合してから次へ進んだ。

- 各段階と公開後に、過去snapshot全旧列、食品栄養全旧列、プロフィール全旧列、旧fingerprint、mutation receiptの全体digestが移行前と一致した。追加のnullable品質列とプロフィール参照列を除いて比較し、単なる新列追加によるhash変化と区別した。
- catalog 55、食品栄養558行、snapshot 1,650行、プロフィール1件を維持。不一致単位0、非有限数0。目標・Body・転送の架空行0。
- 本番/Previewのアプリ全列定義・制約・110関数が一致。30定義のcode/display_name/unitも一致。定義のcreated_atは環境ごとの適用時刻であり、値が異なることは定義不一致ではない。
- 新8表にowner SELECT RLS。anon SELECT不可、authenticatedの直接INSERT/UPDATE/DELETE不可。13の主要新RPCはauthenticated EXECUTEのみでanon不可。private schemaのanon/authenticated USAGEは共に不可。
- Supabase security advisorは、非公開private表のpolicyなしINFO6、意図した認証付きSECURITY DEFINER RPCのWARN49、既存の漏えいパスワード保護未有効WARN1を返した。新表のRLS欠落はない。認証付きRPCは本人確認/owner/revision/receiptを検証する設計であり、この警告だけを理由に意図したEXECUTEを取り消していない。[RPC監査の説明](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)、[パスワード保護](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)。

## バックアップと復旧範囲

本番プロジェクトはFreeプランで、接続ツールからprovider backup/PITRの復旧時点を取得できなかったため、DDL実施前に暗号化したアプリ論理バックアップを作成した。実データはリポジトリ・CI artifactへ保存していない。

- 保管先: `%USERPROFILE%\.codex\backups\nutrition-sleep-app\release-2026-11-02T07-31-20-756Z`（実行したWindows本人のPC内）。
- 時点: `2026-11-02T07:33:33.03412+00:00`。
- 対象: public/privateのアプリ23表、Auth user IDのみ、migration台帳28件、列/制約/索引/policy/RLS/ACL/enum、58関数定義/権限。
- 方式: 公開鍵PGP/AES256でDB内から暗号化。秘密鍵はWindows CurrentUser DPAPIで保護した`private-key.dpapi`。鍵の平文ファイルは作成していない。
- payload SHA256: `11c097820d45ee59ca1b587354cf426ea9cda3699e5f10f41ec09e8777a6b06e`。
- 同じディレクトリの`verify-backup.mjs`を実行し、メモリ内復号、SHA256、23表・定義18・台帳28・snapshot1,650行等の件数を照合して成功。平文データを書き出していない。

これはAuthのパスワード/全設定、Storage全体、provider PITRを含む完全バックアップではない。DPAPI復号には同じWindows本人のプロファイルが必要で、別PCの災害復旧を検証したものでもない。隔離DBへの全件復元試験は未実施である。

データ復旧が必要になった場合は本番へ直接上書きせず、復号可能性を再確認し、隔離DBで既存Auth owner ID・実DDL/ACL・FK順序・台帳差分を確認してから復元手順を確定する。復号した元JSONをPostgresで読み、JS数値への変換と再シリアライズによる精度損失を避ける。復旧先のsnapshot全旧列・fingerprint・receipt・owner隔離を照合し、事故後の新規実記録も救済してから切替可否を判断する。

## 自動検証・Hosted確認

| 検査 | 証拠と結果 |
|---|---|
| 承認済み81519db CI | [41388958613](https://github.com/Auto-Hal/nutrition-sleep-app/actions/runs/41388958613) 成功。lint/typecheck/Deno/production build、91ファイル787 Vitest、fresh replay/25ファイル650 pgTAP、並列接続、旧main upgrade、認証付き3環境、公開閲覧3環境 |
| 既存Sleep | [41388958539](https://github.com/Auto-Hal/nutrition-sleep-app/actions/runs/41388958539) 成功、36 E2E |
| 最終Preview | [41388958537](https://github.com/Auto-Hal/nutrition-sleep-app/actions/runs/41388958537) 成功 |
| Production先行build | [41408360259](https://github.com/Auto-Hal/nutrition-sleep-app/actions/runs/41408360259) 成功。専用DB project照合、lint/test/build成功。既存Productのimg lint警告1件、エラー0 |
| mainマージ後の再確認 | CI [41409574601](https://github.com/Auto-Hal/nutrition-sleep-app/actions/runs/41409574601)のchecks/database、Sleep [41409574490](https://github.com/Auto-Hal/nutrition-sleep-app/actions/runs/41409574490)とも成功。同じ787 unit/650 pgTAP・認証付き3環境・公開閲覧3環境・Sleep 36件、fresh/upgrade、lint/typecheck/Deno/buildを再確認 |
| Hosted先行URLと公開URL | 各々Chromium1280px / WebKit390px / WebKit768pxで主要11 URLの200、ログイン迂回、横スクロールなし、5タブの実クリック移動、実JSエラー0、本人session未発行、同一origin SW更新成功 |
| Hosted認証拒否 | 食事・目標・Body・転送状態・JSON・CSVの匿名POST6経路が各環境401。先行URLへの最初のPOSTは先行originを使ったため意図どおり403。本番設定済みoriginを使う検査へ直して401を確認し、アプリ側のOrigin制限を緩めていない |
| 本番MCP | 承認済み5ファイル。metadata 200、resource/challengeが本番HTTPS。未認証`/mcp`は401。`verify_jwt=false`でも関数内の`auth.getUser`と検証後OAuth claimsチェックを維持 |
| 公開後のDB/log | 上記の既存データ不変・ACL/RLSを確認。対象deploymentの直近error/fatalログ照会は該当行0。観測期間外まで無障害を証明するものではない |

WebKitの最初の先行試験では、先読みRSC/SW通信の中断がnative pageerrorとして出た。実JS error/unhandledrejectionは独立監視で0、対象画面200、同一origin SW更新成功を確認した。許可した経路/ホスト・query・固定suffixだけをnative診断として扱う検査にし、実エラーを一律無視していない。最終再実行は先行/公開両URLともこのnative診断0で通過した。

Hostedの本人Authを使った破壊的CRUDや試験データ投入はしていない。その経路の自動受け入れはloopbackの使い捨てAuth→Next→API→DBであり、Hosted本人操作の合格へ読み替えない。公開実データのスクリーンショットをCI artifactへ保存していない。

## 退避・障害時

現在のProduction artifact `dpl_GNYctPgVLbvRxufXafgT4Mmc6qg2` / 81519dbを、30コード・outbox 1/2・RPC・JSON v2を保持する検証済み基準として残す。今後のビルド/設定/公開先の切替不良では、このProduction artifactへのpromoteで戻せる。Preview環境artifactを本番へpromoteしない。

このコード自体に問題がある場合、同じartifactへ戻すだけでは直らない。原因を確認し、新契約を保持した前進修正を作る。旧18項目版c45925b/7b2bceaへ単純rollbackしない。DBの追加定義/bridge/履歴を残し、down migration・台帳repair・過去snapshotの再計算/上書き・pending削除/自動rebaseを行わない。公開閲覧だけを止める場合は既存flagをfalseにして互換ビルドを作る。

## 残る実機・外部確認

1. iPhone/iPad本体のSafari/PWA cold start、表示/入力、オフライン→復帰と二重登録なし。自動WebKitは物理端末ではない。
2. 編集用ログイン後に本人が希望する目標と開始日を選択し、必要な実測を入力する。リリース時に本人の目標/体重履歴を代行作成していない。
3. PNGの写真/ファイル保存、実iOS共有シート/キャンセル、メニュー名コピー。保存/共有だけで転送確認済みにしない。
4. 今回生成した基本7画像のカロミルOCR再試験と、全29の項目別認識値/単位/未知項目の0初期化を確認する。全29 PNG生成成功を全29取込み成功と報告しない。
5. 実ChatGPT OAuth/直接v2/Project切替、今回変更を含めた実Google Health同期。外部体重取得の権限は追加していない。

確認結果は[10の実機表](10-preview-acceptance-and-production-plan.md)へ記録する。これらはリリース済みでも未確認のままである。
