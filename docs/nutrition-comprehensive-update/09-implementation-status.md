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
| P4 体重履歴基盤 | 完了 | CI 41294836278：fresh replay、559 pgTAP、Body/旧プロフィールの実接続同時更新、lint/typecheck/Deno/build成功。Preview適用後も旧snapshot/profile digest一致 |
| P5 PFC日/月/週 | 完了 | CI 41295693517：lint/typecheck/unit/build、fresh replay/559 pgTAP/実接続成功。境界・途中記録・参照比較・集計19テスト、同期レース2テストを追加 |
| P6 Body画面 | 完了 | CI 41296434510：lint/typecheck/unit/build、fresh replay/559 pgTAP/実接続成功。実測CRUD、30/90日、移動平均、目標・連携、5タブを接続 |
| P7 PNG転送 | 実装・自動検証完了 | UI統合CI 41298773341：lint/typecheck/unit/build、fresh replay/605 pgTAP/実接続成功。Preview反映済み。保存・共有で自動確認しない回帰成功。物理iPhone/OCRは未確認 |
| P8 CSV・入力/品質・UI整理 | CSV完了・品質契約を検証中 | c1bc20a CI 41300275315：fresh replay/618 pgTAP/実接続・lint/typecheck/unit/Deno/build成功。入力と品質契約の回帰を追加中 |
| P9 統合・受け入れ | 未着手 | 未実施 |

新機能の実機・外部OCRは未検証。各単位が通過した結果とSHAを順次追記する。

## Preview適用台帳

| リポジトリmigration | Hosted Preview version | 確認 |
|---|---|---|
| 20261101022326_nutrition_legacy_nutrient_bridge.sql | 20261101023306 / nutrition_legacy_nutrient_bridge | apply成功、7関数の存在/ACL照合、Batch直接EXECUTE取り消し確認 |
| 20261101023441_nutrition_30_code_foundation.sql | 20261101025327 / nutrition_30_code_foundation | apply成功、内部30/標準29を照合。既存食品21行・snapshot322行の全旧列digest/件数とlegacy fingerprint digestが前後一致 |
| 20261101025358_nutrition_goal_history.sql | 20261101092348 / nutrition_goal_history | apply成功、4つのowner SELECT policy確認。新規goal/head/target/day-type全0行、目標バックフィルなし |
| 20261101092352_body_measurement_history.sql | 20261101095413 / body_measurement_history | apply成功、3つのowner SELECT policy確認。measurement/settings/tombstone/linked profile全0、旧profile/snapshot digest一致 |
| 20261101101537_karomiru_transfer_snapshots.sql | 20261101103222 / karomiru_transfer_snapshots | CI 41297687213：fresh replay/605 pgTAP/実接続成功後apply。owner SELECT policy、transfer0行、旧profile/snapshot digest前後一致 |
| 20261101104949_nutrition_csv_snapshot_source.sql | 20261101110940 / nutrition_csv_snapshot_source | CI 41300275315：618 pgTAP成功後apply。STABLE/invoker、匿名実行不可を確認 |
| 20261101111309_nutrient_evidence_contract_guard.sql | 20261101142723 / nutrient_evidence_contract_guard | 修正後CI 41315976268：642 pgTAP/実接続・731 Vitest・全アプリ検査成功後apply。食品5/栄養21/snapshot322・3種digest前後一致 |

P1適用後security advisorは既存private server-only表のpolicyなしINFO、意図したowner検証付き公開SECURITY DEFINER RPC、既存のleaked password protection設定を報告。追加したprivate helperはauthenticated/anon実行不可。Productionは変更なし。

P2の新規DB書込はv3/contract_version=2に分離する。v1 outboxと18項目fingerprintは継続する。OFFのcarbohydrates-totalのみ総炭水化物候補に使用し、carbohydrates/sugarsを日本の糖質へ無条件変換しない。定義の参照元: [OFF公式nutrient taxonomy](https://github.com/openfoodfacts/openfoodfacts-server/blob/main/taxonomies/nutrients.txt)。

MCP Edge FunctionはPreviewだけversion 3へ反映。Deno 2.5.6型検査成功、resource metadata GET 200、未認証MCP 401＋WWW-Authenticateを確認。SDK 1.25.3ではtop-level securitySchemesが型定義外のため、[公式仕様の互換メタデータ](https://developers.openai.com/plugins/reference)へ宣言を移した。実ChatGPTからのOAuth接続・確定操作は実機受け入れに残る。ProductionのEdge Functionは変更なし。

P2 security advisorの追加10件は意図したowner検証付き公開write/reference RPCのSECURITY DEFINER警告。private coreの直接実行は取り消し、匿名実行不可をSQLテストで確認。新しいRLS欠落の警告はない。

P3は目標履歴・適用日・split/日別区分・将来予定の置換/取消、Settingsの食事目標、JSON v2を追加。正式履歴前の参考比較とPFC画面はP5以降。将来予定の取消/置換はintent日と実際の保存日の両方で未来のものに限定し、遅延した取消が既に適用済みの過去を消さないようにした。新setの遅延同期は元のintent日を維持する。

実接続テストの初回は補助SQLの予約語aliasで停止したため修正し、再実行成功。Hostedではなくloopback:54322の使い捨てCI DBだけを許可する実行ガードを設けた。認証済み別接続の同時初回保存は1成功/1 revision_conflict、同じoperationの再送は元receiptを回復する。

P4ではBodyの3テーブル、実測のみのCRUD、明示的なプロフィール連携、削除ID管理、v2 export、認証API/outboxを実装。旧プロフィールRPCとの共通ロック順序を維持するため、直接table DMLを取り消す設計補足を04へ追記。JSのBody単体/APIテストは通過。fresh replay/pgTAP/実接続の競合テストをCIで検証してからPreviewへ適用する。

P7のtransfer payloadはsource amount×選択量の分子/分母を文字列で保存し、量換算の循環小数を画像用の有限表示へ丸めても正本へ逆流させない。画像は端末メモリのみでStorage/outbox/SWへ保存しない。手動確認/取り消しだけをIDs/revisionのoutboxで復旧可能にする。Web Shareは事前生成後の別tap、キャンセルはprepared維持（[MDN](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share)、[WebKit](https://webkit.org/blog/13862/the-user-activation-api/)）。新goal参照計算のmeasurement IDが実際のprofile pointerと一致することもM5で検証する。

## P8/P9で残る統合確認

- 29項目CSV（日/食事/食品、366日、BOM/CRLF/formula escaping、単一DB snapshot）と出力UI。
- Productの写真なし手動登録・既存値編集、明示的なNa→salt/定義一致C−fiberの算出と由来維持。
- definition_basis/derivation/source URIの新書込allowlist、単位・化学形態の不一致を新PFC/transferで共通判定。旧DRI互換を維持。
- Catalog/Product/Meal読取りのページ上限・欠落検出、29項目geometry OCR回帰。
- PFCのqueue直後の状態更新と端末暫定PFC。確定不明のpending追加分をサーバー合計へ重複加算しない。
- Todayの入力導線・重複エネルギーカードの整理、iPhone/iPad幅の実画面検証。
- 認証済み使い捨てDBから実Next API/ブラウザまでのPlaywright、新機能のオフライン復旧、Preview統合/PR本文/本番計画。
- 物理iPhone、iOS共有・写真保存、カロミル基本7/全29 OCR、実ChatGPT OAuth/確定は未検証。自動テスト合格と区別する。

## P8 追加の品質契約

30コードごとの単位・比較できる化学形態を共通JSONで定義し、TS/SQL/MCPの一致をテストする。新規書込みは不明な定義・認証情報付き出典URL・自由形式の計算根拠を拒否する。既存の保存行や旧18 APIの契約を一括変更しない。新PFC/CSV/画像/Batchでは明示的な非互換値と曖昧なOFFのA/E/Cを判定保留にする。

Na→saltは2.54/1000、C−fiberは同じ資料・同じ基準量と定義を明示確認した場合だけの操作とし、既知の転送先値を上書きしない。入力元に推定があれば計算結果にも推定情報を維持する。正の値がnumeric(18,6)で0へ丸められる新しい食品・食事・Batch計算はNULLとbelow_storage_precision理由を保存する。過去の0から値を推測して復元しない。

この単位のローカル検証は731 Vitest、lint（既存img警告1件のみ）、typecheck、Deno check成功。fresh replay/pgTAPとPreview適用はCI確認後に行う。

初回CI 41303982463のアプリ検査は成功。DB検査で新しいhelperの変数名と列名の衝突を検出し、変数名を修正した。旧SQLの文字列を探すテスト1件は、新しい換算helperがNULLを維持する実値検証へ変更した。Previewへは未適用。

修正後0ac4cb7で全検査が通過し、上記のPreview台帳へ反映済み。MCPはPreviewだけv4 ACTIVE（b7f5a1e3187bcba25de71c250fb3d70f67cc2c2767a33eb287e206dcb28698d8）。再デプロイの初回は既存の一時import mapパスを参照して失敗したため、今回のdeno.jsonを明示指定して成功した。Productionは未変更。security advisorは既存のprivate表INFO・意図したowner検証付き公開write RPC・既存パスワード設定の3分類で、新しいRLS欠落はない。

## 食品一覧の完全取得

Catalog/Batch/Product解決/Todayの入力候補は、STABLE/invokerの単一JSON RPCへ統合する。30項目×食品数がPostgRESTの1000行上限に達しても切り詰めず、revision・参照fingerprint・栄養の由来・Batch構成を同じsnapshotで返す。件数不一致や重複を検出した応答は編集へ渡さない。SQLで45食品/1350栄養行、0/NULL、owner isolationを確認する。旧「energyだけ先読み」の構造テストはPFC先読みに置き換わるため削除し、全件契約の実値テストを追加した。
