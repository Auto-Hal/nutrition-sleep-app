# Preview受け入れとProduction移行手順

2026-11-02。この文書は本番反映の承認を代替しない。検証中の結果と確定結果を[09](09-implementation-status.md)で区別する。

## 対象と確認範囲

- PR: https://github.com/Auto-Hal/nutrition-sleep-app/pull/47
- 実装branch: feature/nutrition-comprehensive-update。mainは7b2bcea83c97d14aa8b11b06a8f2d0377dbbaec5。
- Preview DB: pprsfxpfljdjlwdfbtqo。Production DB: vyvnicyupcrsmtgdyypv。
- Vercel project: prj_WiPB989mXurOuIgVm8asfmfdPA6W / team_aTOsma3gZ9xkcFkGJ53dUCCO。
- Production再監査: 内部18コード、migration台帳28件、新goal/body/transfer/library関数・テーブルなし。今回の機能はProductionへ反映していない。

Hosted Previewの実ユーザーへ合成データを投入していない。破壊的CRUD/削除/オフラインの自動受け入れは、loopbackの使い捨てSupabase Auth/DBと実Nextで実施する。Hosted Previewの公開ページ、認証拒否、スキーマ・権限・実データの前後digest照合と、物理端末の確認は別の証拠である。

## Previewの確認先と検証状況

- 継続するPreview入口: https://nutrition-sleep-app-git-feature-nutrition-compreh-65baa1-tsuno2.vercel.app （Vercelの保護とアプリ自身のログインがある）。
- 機能受け入れ通過版: 7b00814 / https://nutrition-sleep-6j0ozabrq-tsuno2.vercel.app / dpl_6gLYr6xf3KkdBgheAzcupx5cG6zJ READY。後続版は入口の`/api/app-version`とPR headを照合する。
- [自動検証の確定結果](09-implementation-status.md#自動受け入れの確定結果): 748 Vitest、650 pgTAP、認証付き3ブラウザー、fresh/upgrade replay、既存Sleep E2E成功。
- Preview DBはM1〜M8まで適用済み、内部30コード、台帳32件。食品5・栄養21行・snapshot322行、栄養/プロフィール/snapshotのdigest不変。
- Hostedはlogin 200、version SHA、主要4 APIのアプリ401、MCP metadata 200/HTTPS resource/401 challenge、RLS/ACL/private helper非公開を確認。Vercel環境target分離もmetadataで確認。保護や環境変数は変更しない。
- Hosted認証後の実ユーザー操作は未確認。接続済みブラウザーが環境のkernel assets pathエラーで初期化できず、実Auth/CRUDの成功は使い捨てDBでの証拠である。

最初に通常のPreviewアカウントでログインし、本人が希望する新目標の適用開始日を確認する。過去の実記録を試験のために編集・削除したり、試験値を実測として登録したりしない。新しい測定履歴がない空状態も正常である。

## 操作案内

1. Settings → 食事目標: 初期1800 kcal・25/20/55を確認し、必要に応じて変更。適用開始日・カスタム/プロフィール参考計算/トレーニング別・許容幅を保存する。変更履歴は上書きしない。
2. Settings → ライブラリ: 食材・推定料理・Batchを登録。市販品は番号を入力して写真なしで登録/編集でき、既存カメラ/OCRも維持する。空欄は不明、0は確認したゼロ。基準量変更時は全値を再確認する。
3. Today: 上部のカロリー/PFCで既知量・進捗・差分・品質を確認し、「食事を記録」から入力へ進む。端末の未同期小計はサーバー合計へ足さない。
4. Nutrition: 月のカレンダーで日別P/F/C、週間で日別目標の合計と途中経過を確認。詳細から29成分と従来の7/30/90日・改善順位・食品内訳を見る。
5. 目標開始前の日: 当時の正式目標は空欄。本人が「現在の目標で参考比較」を選んだ場合だけ別枠で比較し、正式達成日数や週間残量は変えない。
6. からだ: 実測を日付とともに登録し、30/90日、観察日数付き7日平均を確認。プロフィールへの反映は明示選択。プロフィールの単一体重を自動で時系列にしない。
7. 食事/食品/Batchの「カロミルへ転送」: 対象量と名称を確認して基本7/全29のPNGを準備。保存・共有・名称コピー後に外部アプリで確認し、最後に手動で登録確認する。
8. Settings → データ書き出し: JSON v1/v2、CSVの日/食事/摂取食品と期間を選ぶ。新履歴を含む完全な書き出しはv2。不明のCSV本値は空欄、既知分と状態は別列。

## 物理端末の受け入れ記録

次の結果はまだ取得していない。自動WebKit成功で代替しない。

| 操作 | 期待結果 | 結果 |
|---|---|---|
| Hosted Previewログイン後 | 本人の既存履歴・プロフィール・新しい空状態が表示される | 未確認 |
| iPhone Safari/PWA、iPad | 5タブ、目標/PFC/カレンダー/Bodyが読みやすく入力できる | 未確認 |
| オフライン入力→復帰 | 端末保存、既知の暫定進捗、同期後に1件だけ登録 | 実機未確認 |
| PNG保存→写真/ファイル、長押しfallback | 1対象1画像、十分な解像度 | 未確認 |
| iOS共有シート、共有キャンセル | 保存/共有だけで登録確認にならない | 未確認 |
| 名称コピー | 正しい名称、コピー不可なら選択欄で代替 | 実機未確認 |
| 基本7 OCR | kcal/P/F/C/糖質/fiber/saltの値・単位・対象量が一致 | 今回の生成画像では未確認 |
| 全29 OCR | 下表の項目別結果を記録。画像生成成功とは別 | 未確認 |
| 実ChatGPT直接v2登録/確認draft/OAuth | 追加12・NULL・由来・同一request再送を保持 | 実接続未確認 |
| Google Health実接続・recent/backfill | 既存scope/睡眠分析を維持 | この変更での実接続未確認 |

全29項目は、認識した値、単位、アプリで確認/修正した値を各々記録する。未認識の成分が転送先で0になった場合は「実測0」として正本へ戻さない。同じ食事の基本7/全29画像を別メニューで重複登録しない。

| 成分群 | 確認対象 | OCR結果 |
|---|---|---|
| エネルギー/PFC関連 | kcal、P、F、飽和、n3、n6、コレステロール、C、糖質、fiber、salt | 全項目未確認 |
| ミネラル | K、Ca、Mg、P、Fe、Zn、Cu、Se、Mo | 全項目未確認 |
| ビタミン | A（µg RAE）、D、E、B1、B2、B6、B12、葉酸、C | 全項目未確認 |

## Production移行順序（現在は実行禁止）

1. 最新main/PR head、最終CI、Previewのdeployment SHA/DB台帳、物理端末結果を確認する。別変更との競合があれば再評価する。
2. バックアップの復旧時点・復旧手順を既存運用で確認する。実データをリポジトリやCI artifactへ保存しない。
3. **このアップデートへの新しい明示承認を得る。** 対象はProduction DB migration、mainマージ、Productionアプリ/Edge反映を具体的に示す。設計承認と今回の実装開始指示はこの承認ではない。
4. Productionの実DDL/関数/ACLと台帳を再照合する。Previewと台帳versionが違うため、db push/repair/resetをしない。リポジトリの追加SQLを1ファイルずつ、Previewと同じ順に適用する。
5. 下記M1〜M8を順に適用し、各回の成否・transaction・lock/statement timeoutを確認する。途中失敗時は次へ進まず、部分適用の有無を照合する。既存migrationを書き換えない。
6. M1は旧18 APIを保護するbridge、M2は30コード/v3、M3は目標、M4はBodyと旧profile API共通lock/ACL、M5は転送、M6はCSV、M7は品質/精度、M8は完全library読取り。新アプリは全RPCが揃ってから公開する。
7. 新アプリのPreviewと同じ確定SHAをmainへ反映してProduction build/deployする。承認された場合だけProduction MCPへ5ファイルをデプロイする。既存verify_jwt=falseでも関数内JWT検証を維持する。
8. Productionのdeployment/version、正常/エラーログ、private helper ACL・RLS・匿名拒否、既存データdigest、旧API/新API、エクスポートを確認する。破壊的fixtureを実アカウントに作らない。

| 単位 | リポジトリSQL |
|---|---|
| M1 | 20261101022326_nutrition_legacy_nutrient_bridge.sql |
| M2 | 20261101023441_nutrition_30_code_foundation.sql |
| M3 | 20261101025358_nutrition_goal_history.sql |
| M4 | 20261101092352_body_measurement_history.sql |
| M5 | 20261101101537_karomiru_transfer_snapshots.sql |
| M6 | 20261101104949_nutrition_csv_snapshot_source.sql |
| M7 | 20261101111309_nutrient_evidence_contract_guard.sql |
| M8 | 20261101142455_complete_catalog_library_read.sql |

## ロールバック・障害時

- DBの30コード制約、M1保護、追加履歴テーブルは残す。18コードへの縮小、旧snapshotの復元上書き、追加値/履歴の削除、migration台帳repairはしない。
- 問題のある新しい操作を止め、原因を確認した互換修正版へ切り替える。UIを一時停止する場合も、新outbox 2/RPC・旧18契約・JSON v2を保持する。
- main旧版へ単純にVercel rollbackすると新outboxを処理できないため、初回公開後の標準手順にしない。Production投入前に、上記を保持した退避用artifactと、そのSHA/動作確認を最終リリース担当者が指定する。
- sourceや目標の不整合はrevision/reference_changedとして保留し、端末pendingを削除・自動rebaseしない。過去の食事を「修復」名目で再計算しない。
- 新MCPを止める必要があれば接続/呼出を一時停止し、旧直接登録v1と正本データは維持する。誤ったpayloadへ同一request IDを使い回さない。
- Productionの切替・再デプロイも既存の承認ゲートを守る。今回の作業では実行しない。
