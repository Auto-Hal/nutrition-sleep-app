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
| P2 30コード基盤 | 実装中 | 新v3 RPC・nullable evidence・parser/DRI拡張の検証中 |
| P3〜P9 | 未着手 | 未実施 |

新機能の実機・外部OCRは未検証。各単位が通過した結果とSHAを順次追記する。

## Preview適用台帳

| リポジトリmigration | Hosted Preview version | 確認 |
|---|---|---|
| 20261101022326_nutrition_legacy_nutrient_bridge.sql | 20261101023306 / nutrition_legacy_nutrient_bridge | apply成功、7関数の存在/ACL照合、Batch直接EXECUTE取り消し確認 |

P1適用後security advisorは既存private server-only表のpolicyなしINFO、意図したowner検証付き公開SECURITY DEFINER RPC、既存のleaked password protection設定を報告。追加したprivate helperはauthenticated/anon実行不可。Productionは変更なし。

P2の新規DB書込はv3/contract_version=2に分離する。v1 outboxと18項目fingerprintは継続する。OFFのcarbohydrates-totalのみ総炭水化物候補に使用し、carbohydrates/sugarsを日本の糖質へ無条件変換しない。定義の参照元: [OFF公式nutrient taxonomy](https://github.com/openfoodfacts/openfoodfacts-server/blob/main/taxonomies/nutrients.txt)。
