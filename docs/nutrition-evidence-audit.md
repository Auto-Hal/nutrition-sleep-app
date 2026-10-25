# 栄養評価のデータ監査

調査基点: `origin/main` = `728e34eb1801bf46ecac1631eb177e6695aa5520`（2026-10-25）。この文書と SQL テストに実ユーザーの食品名、食事内容、摂取量、ID、認証情報は含めない。

## main と関連ブランチ

`phase/4-nutrition-analytics`、`phase/6.6-nutrition-priority`、`phase/6.7-nutrition-priority-ux`、`phase/7.1-known-nutrient-averages` の各 remote branch は調査基点の main に取り込み済み。`phase/7.1-known-nutrient-averages` の基点は `513265b23fb82604b7a1580d1626c167e2e5c90c`。

main には、その後の `75454bb`（改善提案）、`8209564`（画面整理）、`49f3158`（平均値への個人基準併記）がある。旧ブランチへ戻すと main の表示・改善提案の変更を失うので、最新 main 上で扱う。

## 現行の集計契約と原因

実際に有効な RPC 定義は、最初の Phase 4 migration ではなく、後続の `supabase/migrations/20260915083000_phase4_astra_corrections.sql`。それ以降に同名 RPC を再定義する migration はない。

| フィールド | 現在の意味 | 注意点 |
| --- | --- | --- |
| `record_complete` | 朝・昼・夕の固定枠がすべて `recorded` / `skipped` | 食品栄養価の充足とは独立。生活全体が正確に記録された保証ではない |
| `entry_count` | その日の取消済みでない食品記録数 | 食品の種類数ではなく摂取記録の延べ数 |
| `missing_entry_count` | 対象栄養素の snapshot がない、または `amount IS NULL` の記録数 | 明示的な `amount = 0` は含まない |
| `known_amount` | NULL でない snapshot の和 | 欠損がある場合は合計摂取量ではなく既知分。すべて不明でも SQL 上は 0 になるため、件数と併読が必須 |
| `food_amount` | ingredient / product / estimated_dish の既知分 | Batch は食物・サプリ由来を分離できないため含めない |
| `supplement_amount` | supplement の既知分 | Batch のサプリ由来は含めない |
| `coverage_complete` | `missing_entry_count = 0` | 空の日も true になる。食品記録の存在は別判定 |
| `eligible_for_reference` | 記録完了かつ食品記録ありかつ欠損ゼロ | 従来の完全データ比較条件。部分データ評価の意味へ転用しない |
| `quality` | 全体の最も弱い品質を含む要約 | 数値欠損と出典品質が同じ `unknown_or_incomplete` に畳み込まれる |

従来の TypeScript は `eligible_for_reference` が true の日だけを DRI 平均とエネルギー比の分子・分母に使う。栄養価に NULL が 1 件あれば、同日の他の判明している食品の摂取量も基準比較から除外される。`known-intake.ts` により既知分の表示平均は残るが、完全データ日が 0 の栄養素には基準評価が付かない。

これは NULL の総和計算の失敗ではない。厳密な完全データ判定を、あらゆる栄養学的な判断の唯一の入口にしていることが原因。完全日だけを選ぶことで、詳細な栄養価を持つ食品を食べた日へ比較対象が偏る。

## 原因の分類

| 区分 | アプリで確かめられる証拠 | 自動でしてはいけない解釈 |
| --- | --- | --- |
| 1. 食事そのものが未記録 | 固定枠なし / `not_recorded`、`record_complete=false` | 栄養価だけを追加すれば一日分が完成する、食べていない |
| 2. 食品は登録済み、栄養価が不明 | 食品記録あり、snapshot NULL / 行なし | 摂取量 0 |
| 3. 成分表には値があるが未登録 | 原食品・可食部・調理状態と出典の照合が必要 | 現在の DB NULL だけからこの原因と断定する |
| 4. 信頼できる推定値がある | 数値と provenance / quality / source URI / 観測日時 | 確認済み値や数学的に保証された下限と同一視する |
| 5. 含まないことが確認済み | 出典・対象・定義に整合した明示的な 0 | あらゆる測定精度での真のゼロ、推測されたゼロとの同一視 |
| 6. 含まないと推測されるだけ | 現行契約では通常 NULL のまま | 自動で 0 補完する |
| 7. 単位・定義・対象の不一致 | canonical unit と出典の定義の照合、UL の比較可能性 | mg と µg、総量と特定化学形態、由来の異なる値を直接比較する |

`estimated_dish` は食品カテゴリにも provenance にも存在する。カテゴリだけで全栄養素を推定値と扱わず、栄養素ごとの snapshot の provenance を確認する。`quality=user_verified` はユーザーによる確認状態であり、分析化学的な実測精度や真値を保証しない。

Chat direct registration は provenance `estimated` を `estimated_dish`、quality を `unknown` として保存する。official / database なども、単に数値があることとユーザー確認済みであることを区別して保存する。未提供の栄養素には正規の NULL snapshot を生成する。この性質を今回の評価で上書きしない。

## 7 / 30 / 90 日の read-only 監査

実行する SQL: [nutrition_evidence_coverage_readonly.sql](../supabase/audit/nutrition_evidence_coverage_readonly.sql)。Production で許可されるのはこの SELECT の監査だけ。`BEGIN TRANSACTION READ ONLY` と `ROLLBACK` で囲んでおり、テーブル、関数、権限、食事・食品データを変更しない。

1. 既存の認可済み DB 接続で実行する。接続文字列や認証情報をシェル引数・ログ・PRへ出さない。
2. Tokyo の現在日付を末日にする。過去の実行を再現するときは `params.end_date` を監査用の固定日付へ変更する。
3. 過去 90 日内に食事行を持つ owner を母集団とし、owner ごとの 7 / 30 / 90 日のカレンダーを作る。各期間は同一の owner 母集団なので、アプリ開始前の日も未記録に含みうる。実測を解釈するときに利用開始前の空白と取り忘れを混同しない。
4. 出力は期間・栄養素ごとの件数だけ。食品名、owner ID、日付ごとの食事内容、摂取量を返さない。
5. 複数 statement を扱えない read-only connector の場合、`BEGIN` / `ROLLBACK` を connector 側の read-only transaction に置き換えて SELECT 部分を実行する。

主な出力:

- `known_food_entry_occurrences` / `missing_food_entry_occurrences`: 全記録日の既知・不明の摂取記録延べ数。摂取量による重みや栄養の充足率ではない。
- `complete_nutrient_days` / `partial_nutrient_days` / `all_unknown_nutrient_days`: **食事記録完了日内**の完全・一部既知・すべて不明の区分。
- `empty_complete_record_days`: 完了した固定枠があっても食品記録が 0 の日。完全なゼロ摂取日は意味しない。
- `incomplete_meal_record_days`: 食事記録自体が未完了の日。うち食事行もない日が `no_meal_record_days`、既知の栄養価はある日が `incomplete_record_with_known_days`。
- `explicit_zero_entry_occurrences`: 明示的な 0 の件数。不明件数と分離する。
- `unit_mismatch_entry_occurrences`: snapshot と栄養素定義の unit 不一致。0 でなければ、既知分として用いる前に個別調査が必要。
- `estimated_or_unknown_quality_entry_occurrences`: 数値があるが、明示的な estimated_dish provenance または unknown quality の件数。二つは別の概念であり、診断用にまとめた件数を「推定値件数」と表示しない。

完全 + 部分 + すべて不明 + 空の完了 + 未完了 = `owner_calendar_days` となる。データがある日と判定に使える日を増減させず監査できる。

この query だけでは「成分表に存在するが未登録」「含まないと推測された」「定義が一致する化学形態」を確定できない。これらを欠損件数から推計しない。実データの値や食事内容は公開テストの fixture に転記しない。

2026-10-25 の認可済み Production read-only 監査で、ビタミン A / B12 / C は既知の摂取量が存在する一方、完全データ日がないことを確認した。snapshot の canonical unit 不一致は検出されなかった。既知分そのものの消失ではなく、完全データ日のみを比較対象にする条件が主要因であることを実測で確認した。件数表、摂取量、食品名などの生データはこの文書・PRへ掲載しない。

## 権限・件数上限・追跡性

RPC は `SECURITY INVOKER`、`auth.uid()` が NULL なら `42501`、`PUBLIC` / `anon` の実行権を取り消し、authenticated だけに実行権を付与する。食事・食品・snapshot の owner RLS と明示的な owner predicate の両方が働く。authenticated は snapshot の SELECT のみを許可され、直接の書換えは許されない。

栄養素は現在 18 種。RPC の DB 上限 90 日は 1,620 行であり、Data API の返却上限と同一ではない。現行 TypeScript は 28 日（504 行）ずつ取得して日×栄養素のキーを全件検査し、不完全ならエラーにする。新しい実装でもこの分割と整合性検査を維持し、欠けた応答を 0 日分や 0 摂取量へ変換しない。

栄養素単位は catalog / product / direct registration の書込み RPC で `nutrient_definitions` と照合され、通常の記録 snapshot は定義 unit を保存する。直接の authenticated 書込みも許可されていない。ただし既存 summary RPC は snapshot の unit を独立には照合しないため、管理者による過去 import まで含めた整合性は監査で確認する。unit が一致していても、ビタミン A 総 RAE とレチノール UL などの化学形態の比較可能性までは保証されない。

source URI / source observed timestamp / source catalog revision / provenance / quality は immutable snapshot に保持される。現行の日次 RPC はこれらを集計結果に含めず、`quality` は部分データの不確実性と source の不確実性を区別できない。数値 subtotal をそのまま「確定下限」と呼ぶには限界がある。評価の確実性は source confidence とは別の軸で持ち、出典不明・推定値を含む比較には参考であることを示す必要がある。

現在の catalog を修正しても過去の摂取 snapshot は変わらない。履歴を訂正する場合、既存 `replace_meal_entry_v2` による旧記録の void と新 snapshot の作成が正規の経路。新しい日次集計は、その時点の active snapshots だけから再現される。今回のために過去データを一括補完・書換えしない。

## 検証

追加契約テスト: [nutrition_evidence_contract.sql](../supabase/tests/nutrition_evidence_contract.sql)。26 個の pgTAP 検証で、NULL と明示 0、部分データの subtotal、未記録、空の完了日、推定 provenance、owner 分離、Auth、anon、直接更新拒否、7 / 30 / 90 日、現在 catalog の修正と snapshot の再現性を確認する。fixture はすべて人工データで、transaction 最後に rollback する。

実行先は使い捨て local/CI DB、または確認済みの専用 Preview DB に限る。**Production ではこの fixture テストを実行しない。** 既存 CI の database job は `supabase start` → `supabase db reset` → `supabase test db` のため新テストも自動対象になる。

調査時の Windows 作業環境では `psql` / Docker / Supabase CLI がなく、127.0.0.1:54322 の DB も稼働していない。この環境のみでは pgTAP 実行済みとは報告できない。CI 結果または確認済み Preview での実行結果を別途確認する。

fixture は最新 migration まで照合済み。Phase 6.9 の lifecycle write guard は認証 context のない管理用 fixture 挿入を許可し、authenticated の新規記録作成時には通常の guard を通す。旧 `create_meal_entry` RPC の実行権は互換性のため維持されている。snapshot の quality / provenance / source URI / 観測日時の現行列・制約に合わせている。

参照した現行の一次ドキュメント: [Supabase Changelog](https://supabase.com/changelog)、[Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)、[Database Functions](https://supabase.com/docs/guides/database/functions)。changelog の markdown URL は取得不能だったため HTML 本文を確認。今回維持する invoker / ownership / 関数 execute grant の契約に適用する breaking change は確認されなかった。新テーブルは追加しない。
