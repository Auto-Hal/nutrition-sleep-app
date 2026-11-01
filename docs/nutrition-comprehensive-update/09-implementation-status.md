# 段階的実装・検証記録

開始日: 2026-11-01。ブランチ: feature/nutrition-comprehensive-update。基準main: 7b2bcea。第1段階設計と追加指示を正本とする。Productionは読み取り監査だけで、merge/migration/deployは禁止。

## 重点4項目の判断

1. Hostedのpublic/privateについてcolumns 237、constraints 178、indexes 67、policies 17、RLS/table grants 23、functions 58の構造を再照合。両環境はBatch再計算のauthenticated EXECUTE以外一致。関数は空白を除いて照合。migration台帳はPreview24件/Production28件でversionも異なるため、既存台帳をrepairせず、新しい追加migrationだけをPreviewへ順番に適用する。
2. 旧18のfingerprintを固定する互換bridgeを先行。旧Catalog/Product更新が追加12値を消さないこと、分母変更で破損させないことをSQL回帰で証明してからコード定義を増やす。
3. 正式achievementと記録途中のknown/provisional progressを別出力にする。未完了・欠損・未同期でも観察できた量を表示し、判定保留を情報なしの画面にしない。
4. 目標開始前の過去日は、任意の「現在の目標で参考比較」を採用。正式target/history/count/weekly balanceは変更せず、参照日・版・variantと「当時の目標ではない」を表示する。

## 環境差分と移行方針

Previewはpprsfxpfljdjlwdfbtqo、Productionはvyvnicyupcrsmtgdyypv。両環境のDDLは上記範囲で同等。PreviewのChat直接登録は台帳がなくても存在し、Productionと同じ実装。既存migrationの一括push/resetはHostedへ行わず、生成した追加ファイルを一つずつ照合して適用する。台帳名/適用時刻とリポジトリ名の対応を記録する。

PreviewのBatch再計算実行権は広いが、アプリはBatch RPCから呼ぶ構成。互換bridgeの追加migrationでauthenticatedの直接実行を取り消しProductionと揃え、owner-scoped Batch作成/更新が継続することをpgTAPで確認する。Productionには適用しない。

ローカルWindowsにはDocker/WSLディストリビューションがない。JS検証は固定pnpm10.15.0を使用する。fresh Supabase replay/pgTAPは使い捨てCI DBで実施する。Hosted Previewの実アカウントを破壊的fixtureに使わない。

## 進捗

| 単位 | 状態 | 検証/環境 |
|---|---|---|
| P0 再監査・追加設計 | 完了 | remote main一致、両Hostedのread-only schema照合 |
| P1 旧契約bridge | 完了 | CI 41265351899 fresh replay/pgTAP・652 Vitest・lint/typecheck/build成功。Sleep E2E 41265351909成功 |
| P2 30コード基盤 | 基盤・接続完了 | CI 41266753928 replay/pgTAP・662 Vitest・lint/typecheck/build成功。手動/Product/OCR/Chat/Batchは新契約へ接続。実機入力は未検証 |
| P3 目標・期間読取り | 完了 | CI 41292501211：674 Vitest、lint/typecheck/Deno/build、fresh replay、506 pgTAP、認証済み別接続の同時保存/receipt/export isolation成功。Sleep E2E成功 |
| P4 体重履歴 | 実装中 | 未検証 |
| P5〜P9 | 未着手 | 未実施 |

新機能の実機・外部OCRは未検証。各単位が通過した結果とSHAを順次追記する。

## Preview適用台帳

| リポジトリmigration | Hosted Preview version | 確認 |
|---|---|---|
| 20261101022326_nutrition_legacy_nutrient_bridge.sql | 20261101023306 / nutrition_legacy_nutrient_bridge | apply成功、7関数の存在/ACL照合、Batch直接EXECUTE取り消し確認 |
| 20261101023441_nutrition_30_code_foundation.sql | 20261101025327 / nutrition_30_code_foundation | apply成功、内部30/標準29を照合。既存食品21行・snapshot322行の全旧列digest/件数とlegacy fingerprint digestが前後一致 |
| 20261101025358_nutrition_goal_history.sql | 20261101092348 / nutrition_goal_history | apply成功、4つのowner SELECT policy確認。新規goal/head/target/day-type全0行、目標バックフィルなし |

P1適用後security advisorは既存private server-only表のpolicyなしINFO、意図したowner検証付き公開SECURITY DEFINER RPC、既存のleaked password protection設定を報告。追加したprivate helperはauthenticated/anon実行不可。Productionは変更なし。

P2の新規DB書込はv3/contract_version=2に分離する。v1 outboxと18項目fingerprintは継続する。OFFのcarbohydrates-totalのみ総炭水化物候補に使用し、carbohydrates/sugarsを日本の糖質へ無条件変換しない。定義の参照元: [OFF公式nutrient taxonomy](https://github.com/openfoodfacts/openfoodfacts-server/blob/main/taxonomies/nutrients.txt)。

MCP Edge FunctionはPreviewだけversion 3へ反映。Deno 2.5.6型検査成功、resource metadata GET 200、未認証MCP 401＋WWW-Authenticateを確認。SDK 1.25.3ではtop-level securitySchemesが型定義外のため、[公式仕様の互換メタデータ](https://developers.openai.com/plugins/reference)へ宣言を移した。実ChatGPTからのOAuth接続・確定操作は実機受け入れに残る。ProductionのEdge Functionは変更なし。

P2 security advisorの追加10件は意図したowner検証付き公開write/reference RPCのSECURITY DEFINER警告。private coreの直接実行は取り消し、匿名実行不可をSQLテストで確認。新しいRLS欠落の警告はない。

P3は目標履歴・適用日・split/日別区分・将来予定の置換/取消、Settingsの食事目標、JSON v2を追加。正式履歴前の参考比較とPFC画面はP5以降。将来予定の取消/置換はintent日と実際の保存日の両方で未来のものに限定し、遅延した取消が既に適用済みの過去を消さないようにした。新setの遅延同期は元のintent日を維持する。

実接続テストの初回は補助SQLの予約語aliasで停止したため修正し、再実行成功。Hostedではなくloopback:54322の使い捨てCI DBだけを許可する実行ガードを設けた。認証済み別接続の同時初回保存は1成功/1 revision_conflict、同じoperationの再送は元receiptを回復する。

P4ではBodyの3テーブル、実測のみのCRUD、明示的なプロフィール連携、削除ID管理、v2 export、認証API/outboxを実装。旧プロフィールRPCとの共通ロック順序を維持するため、直接table DMLを取り消す設計補足を04へ追記。JSのBody単体/APIテストは通過。fresh replay/pgTAP/実接続の競合テストをCIで検証してからPreviewへ適用する。
