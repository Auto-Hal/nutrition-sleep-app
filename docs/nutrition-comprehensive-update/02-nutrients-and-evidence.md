# 栄養素・由来・DRI詳細設計

設計版: 1 / 2026-11-01。以下は第1段階で確定した実装契約。実装開始承認後の適用結果と制限は[09](09-implementation-status.md)と[12](12-feature-coverage-and-verification.md)を参照する。

## 1. コードと単位の確定

既存18コードの名称・保存単位を変えず、12コードを追加する。内部配列ALL_NUTRIENTSは30、通常フォーム・分析・PNG・CSVのSTANDARD_NUTRIENTSは29とする。単一の定義資料からTS/API/OCRのコード集合を生成または契約テストで照合し、Deno側を含む別配列の更新漏れを防ぐ。

| 表示順 | 名称 | code | 保存unit | 表示unit | 既存/追加 |
|---|---|---|---|---|---|
| 1 | エネルギー | energy | kcal | kcal | 既存 |
| 2 | たんぱく質 | protein | g | g | 既存 |
| 3 | 脂質 | fat | g | g | 既存 |
| 4 | 飽和脂肪酸 | saturated_fat | g | g | 追加 |
| 5 | n-3系脂肪酸 | n3_fatty_acids | g | g | 追加 |
| 6 | n-6系脂肪酸 | n6_fatty_acids | g | g | 追加 |
| 7 | コレステロール | cholesterol | mg | mg | 追加 |
| 8 | 炭水化物 | carbohydrate | g | g | 既存 |
| 9 | 糖質 | carbohydrate_excluding_fiber | g | g | 追加 |
| 10 | 食物繊維 | fiber | g | g | 既存 |
| 11 | 食塩相当量 | salt_equivalent | g | g | 既存 |
| 12 | カリウム | potassium | mg | mg | 追加 |
| 13 | カルシウム | calcium | mg | mg | 既存 |
| 14 | マグネシウム | magnesium | mg | mg | 追加 |
| 15 | リン | phosphorus | mg | mg | 追加 |
| 16 | 鉄 | iron | mg | mg | 既存 |
| 17 | 亜鉛 | zinc | mg | mg | 既存 |
| 18 | 銅 | copper | mg | mg | 追加 |
| 19 | セレン | selenium | ug | µg | 追加 |
| 20 | モリブデン | molybdenum | ug | µg | 追加 |
| 21 | ビタミンA | vitamin_a | ug_rae | µg RAE | 既存 |
| 22 | ビタミンD | vitamin_d | ug | µg | 既存 |
| 23 | ビタミンE | vitamin_e | mg | mg | 既存 |
| 24 | ビタミンB1 | vitamin_b1 | mg | mg | 既存 |
| 25 | ビタミンB2 | vitamin_b2 | mg | mg | 既存 |
| 26 | ビタミンB6 | vitamin_b6 | mg | mg | 既存 |
| 27 | ビタミンB12 | vitamin_b12 | ug | µg | 既存 |
| 28 | 葉酸 | folate | ug | µg | 追加 |
| 29 | ビタミンC | vitamin_c | mg | mg | 既存 |
| 内部 | ナトリウム | sodium | mg | mg | 既存・詳細/JSONで保持 |

糖質codeはsugarsを使わない。糖類、添加糖、利用可能炭水化物の単糖当量と無条件に同一視しない。表示は日本の栄養表示の「糖質」を意図するが、元資料の定義を別途保持する。

ミネラル値は元素量である。例えばクエン酸マグネシウムという化合物の製品質量をmagnesium mgへ写さない。n-3は総n-3で、EPA/DHAだけの値から不足成分を0と仮定して総量を作らない。

## 2. 栄養値の契約

既存amount/provenance/quality/source_uri/source_observed_atを維持し、item_nutrientsと今後作成するsnapshotに次のnullableメタデータを追加する。過去行にメタデータを推測して埋めない。

| 属性 | 意味 |
|---|---|
| value_origin | measured / official / database / label / calculated / estimated / user_reported。NULLは旧値など由来未特定 |
| definition_basis | jp_label_carbohydrate、jp_label_carbohydrate_excluding_fiber、total_n3、alpha_tocopherol、total_rae等。codeごとのallowlist |
| intake_scope | conventional_food / nonconventional_food / unknown。UL対象範囲の根拠がある場合だけ明示 |
| derivation | method_version、入力code/改訂/分母、換算係数、元の由来。任意JSONではなく制限したschema |
| contains_estimates | true / false / NULL。NULLは未確認で「推定なし」ではない |

value_originは資料/申告された値の種類であり、その真偽を認証する属性ではない。Chatのofficialも品質はunverifiedのまま、source URIと「出典未確認」を示す。公式URLがない値を公式確認済みにしない。手動の「確認済み」は品質の操作であり、推定値を公式値や実測値に変えない。

実測値であること、公式値であること、ユーザーが確認したこと、全食品分が揃うことは独立する。由来不明の過去値はlegacy provenanceを表示し、追加属性は不明とする。既存approved_external_dbからofficial/databaseを逆算しない。

新metadataを読めない旧APIが、既存値の数値や分母を変更した場合は古いmetadataをそのまま流用しない。変更したlegacy項目の追加属性を未特定に戻し、値が変わらない項目は保持する。詳しい旧契約保護は[DB設計](04-database-api-migration.md)。

### 不明、0、trace、部分量

- 欠損行とamount=NULLはいずれも不明。明示0だけを既知0とする。
- trace/「未満」などの検出限界は点の0へ変換しない。今回のamount schemaでは確定数値として採用せず、確認待ちの抽出証拠に残す。OCR原文/画像は既存の保持方針を守り、不要に永続化しない。
- 合計はknown_sum、known_entry_count、missing_entry_count、definition_mismatch_countを返す。観察された値が1件もなければ表示用known_sum=NULL。
- 完全合計amountは対象食品全件の比較可能値があるときだけ返す。known_sumを完全合計欄へコピーしない。
- Batchの材料が1つ不明ならその栄養素はNULL。材料の既知分は任意の内訳として示せるが、一食分の確定栄養量として出力しない。
- snapshotの不変性は栄養量だけでなく、その時点の由来・定義・計算式にも及ぶ。現Catalog修正で過去値を昇格しない。

新契約の計算で真に正の量が保存精度numeric(18,6)への丸めで0になる場合も、明示0として保存しない。amount=NULL、derivationの制限付きreason=below_storage_precisionとして確認可能にする。既存の保存済み0から元の微量を推測して復元しない。

出力可能性とDRIへの比較可能性は別属性。例えばcholesterolの一般DRIがなくてもmgの記録量は表示/画像化できる。逆に元値がDFE等でcanonical定義に変換できない場合は、数値があっても標準項目の確定値にはしない。

## 3. 換算方針

### 食塩とナトリウム

換算は **salt g = sodium mg × 2.54 / 1000**、逆はsodium mg = salt g × 1000 / 2.54。[文科省の定義](https://fooddb.mext.go.jp/nutman/nutman_09.html)。

新規登録時に一方のみ既知で、分母・単位・測定対象が一致する場合、確認画面で算出値を提示できる。保存時はcalculatedと入力由来を保持し、公式/実測へ昇格しない。過去snapshotには補完しない。

同一食品に両方あるときは両方を各codeで保持するが、食塩表示はsalt_equivalentを1回だけ集計する。salt＋sodium換算値という合計は禁止。両者が一致しない場合も自動上書きせず、丸めや資料定義の違いとして確認する。sodiumとsaltを独立した2件の減塩課題に重複計上しない。

新日次読取りで過去のsodiumからsaltをオンザフライ補完することも標準では行わない。必要なら元値からの「参考換算」欄だけを別に示し、元の不明状態を変更しない。

### 炭水化物・糖質・食物繊維

食品値のC−fiberは既定で無効。日本の同じ資料・同じserving basis・互換な分析定義が揃い、両値が既知かつ差が非負で、利用者が算出値を選択したときだけcalculatedとして保存可能とする。負値を0へclampしない。既存糖質を差分で上書きしない。

一方、個人の**糖質目標参考値**はC目標−fiber目標として表示できる。これは目標の算術で、食品の含有量の推定ではない。

[消費者庁の表示制度](https://www.caa.go.jp/policies/policy/food_labeling/nutrient_declearation)は糖質と糖類を別項目にしている。[文科省食品DB](https://fooddb.mext.go.jp/help.html)の利用可能炭水化物（単糖当量）等も区別する。資料の数値を似た成分名だけで統合しない。

### その他の単位・形態

g↔mg↔µgは同一物質・同一定義のみ。µg/μg/ugという記法の正規化と、µg→µg RAEという意味の変換を分ける。kJ→kcalは4.184で換算可能。食品の記録エネルギーをPFCの4/9/4合計へ置き換えない。

vitamin_aのIU/retinol/β-carotene/一般µg、vitamin_eのIU/α-TE/総トコフェロール、folateのDFE/葉酸/folic acidは、根拠のある専用変換なしでは統合不可。旧A/E/B6の非比較UL等を今回の追加で勝手に有効化しない。

## 4. 全入力・計算・出力への適用

| 面 | 実装契約 |
|---|---|
| 手動Catalog/Product | 標準29＋内部sodium。空欄NULL、非有限/負数/重複code/単位違いをAPIとSQLで拒否 |
| Barcode/OFF | 収録・定義が一致した項目だけ取り込む。saturated-fat、cholesterol、各mineral等のkey/unitをprovider fixtureで確認。新12が必ず埋まるとは表示しない |
| OFF炭水化物 | carbohydrates-totalが総炭水化物の根拠ある候補。carbohydratesはfiber除外なのでJP糖質と意味が一致する場合のみ新codeへ。定義不明時は候補保留。sugarsは糖質にしない |
| OCR | 29語彙を2つのparserへ追加。n-3/n-6、糖質/脂質/糖類、鉄/亜鉛/銅、B1/B12、葉酸をexactに識別。長いラベル優先、単位付き他成分行を境界にし行ずれ防止 |
| Chat URL/MCP | 旧schema v1=18コードを読み続ける。新nutrient_schema_version=2を追加。unknown NULL、estimated保持。MCP manifest・アプリ・SQLを同時に検証 |
| Chat直接登録 | legacy schema 1を維持し、専用v2経路で30コードを受理。上限を単に18→30へ変えるだけでは由来が失われる |
| Batch | 一食分の全30codeを計算。計算元の由来/推定/定義を伝播。混在した互換不能形態はNULL＋理由 |
| 日次/7/30/90 | 表示29、内部30。旧18のevidenceは互換維持。新codeの行なしはmissing |
| 見直し | DRIがあるcodeだけ各軸で判定。基準なしや形態不明を架空の目標で埋めない |
| JSON/CSV/PNG | 共通の出力用値resolverで単位/不明/由来を統一。保存snapshotは加工しない |

旧18の通常のP/F/Cはcodeが表していた意味を維持し、新metadata=NULLという理由だけで全て利用不能にはしない。ただしOFF由来Cなど今回具体的な定義不一致が判明したものは、新PFC/転送でdefinition_uncertainとして保留できるようにする。旧DRI互換フィールドの値を黙って補正せず、保存された元値と比較上の制約を詳細で説明する。必要な過去食事の訂正は本人の既存replace操作に限る。

## 5. 追加12項目のDRI調査結果

基準資料は厚労省[2025年版訂正版（最終訂正2025-03-25）](https://www.mhlw.go.jp/stf/newpage_44138.html)。今回の比較対象は既存同様に成人。妊娠授乳・疾患別処方・小児をプロフィールから推測しない。

EAR/RDAは必要量の分布に関する指標、AI未満は不足と断定できない。DGは生活習慣病予防の目標でありULと別。UL未設定は無制限に安全という意味ではない。単日PFCの範囲外をこれらの栄養学的評価へ読み替えない。[総論](https://www.mhlw.go.jp/content/10904750/001316460.pdf)。

| 新code | EAR | RDA | AI | DG | UL | 初回の評価方針 |
|---|---|---|---|---|---|---|
| saturated_fat | なし | なし | なし | 成人7%E以下 | なし | 9×g/記録energy。両者のcoverageを確認 |
| n3_fatty_acids | なし | なし | 年齢・性別 | なし | なし | 総n-3が比較可能な場合だけAI。未満は不足判定しない |
| n6_fatty_acids | なし | なし | 年齢・性別 | なし | なし | 総n-6にAI |
| cholesterol | なし | なし | なし | 一般の数値設定なし | なし | 量だけ。疾患別参考200mgを一般目標にしない |
| carbohydrate_excluding_fiber | なし | なし | なし | 糖質としてなし | なし | 個人目標参考値のみ。総CのDGを流用しない |
| potassium | なし | なし | あり | 下限あり | なし | AIとDGを別軸 |
| magnesium | あり | あり | 成人なし | なし | 通常食品以外の範囲に350mg/日 | 総量EAR/RDA。ULは対象範囲不明ならreference-only |
| phosphorus | なし | なし | あり | なし | 成人3000mg/日 | AI/ULを別軸 |
| copper | あり | あり | 成人なし | なし | 成人7mg/日 | EAR/RDA/UL |
| selenium | あり | あり | 成人なし | なし | 年齢・性別 | EAR/RDA/UL |
| molybdenum | あり | あり | 成人なし | なし | 男600/女500µg/日 | EAR/RDA/UL |
| folate | あり | あり | 成人なし | なし | 通常食品以外の葉酸範囲 | 定義照合したEAR/RDA。汎用総folateとULの比較は保留 |

脂質の出典: [脂質章・冊子pp.127–128](https://www.mhlw.go.jp/content/10904750/001316463.pdf)。コレステロールの一般目標なしと疾患別参考の脚注も目視確認した。糖質の基準を総Cや糖類から作らない根拠: [炭水化物章](https://www.mhlw.go.jp/content/10904750/001316464.pdf)。

### 数値データの採用表

下記の配列順は **18–29 / 30–49 / 50–64 / 65–74 / 75歳以上**。単位は上のコード表と同じ。第1段階では設計用の公式値転記表だけを作成した。実装段階ではdatasetへ追加し、比較可能性・摂取源の制限を付けている（特に葉酸EAR/RDAとMg/葉酸ULは現在の集計では参考表示）。

| 栄養素・指標 | 男性 | 女性 |
|---|---|---|
| n-3 AI g | 2.2 / 2.2 / 2.3 / 2.3 / 2.3 | 1.7 / 1.7 / 1.9 / 2.0 / 2.0 |
| n-6 AI g | 12 / 11 / 11 / 10 / 9 | 9 / 9 / 9 / 9 / 8 |
| 飽和脂肪酸 DG %E | 全成人7以下（包含） | 同左 |

出典・目視照合: [脂質章・冊子pp.127–128](https://www.mhlw.go.jp/content/10904750/001316463.pdf)。

| 栄養素・指標 | 男性 | 女性 |
|---|---|---|
| potassium AI mg | 全成人2500 | 全成人2000 |
| potassium DG mg | 全成人3000以上 | 全成人2600以上 |
| magnesium EAR mg | 280 / 320 / 310 / 290 / 270 | 230 / 240 / 240 / 240 / 220 |
| magnesium RDA mg | 340 / 380 / 370 / 350 / 330 | 280 / 290 / 290 / 280 / 270 |
| magnesium UL mg | 通常食品以外350 | 同左 |
| phosphorus AI mg | 全成人1000 | 全成人800 |
| phosphorus UL mg | 全成人3000 | 全成人3000 |

出典・目視照合: [多量ミネラル章・冊子pp.282、284–285](https://www.mhlw.go.jp/content/10904750/001316468.pdf)。Mgの「サプリのみ」への短縮は不適切で、通常食品以外という範囲の識別が必要。Batchのsource-unclassifiedを都合よく食品/サプリへ配分しない。

| 栄養素・指標 | 男性 | 女性 |
|---|---|---|
| copper EAR mg | 0.7 / 0.8 / 0.7 / 0.7 / 0.7 | 全成人0.6 |
| copper RDA mg | 0.8 / 0.9 / 0.9 / 0.8 / 0.8 | 全成人0.7 |
| copper UL mg | 全成人7 | 全成人7 |
| selenium EAR µg | 全成人25 | 全成人20 |
| selenium RDA µg | 30 / 35 / 30 / 30 / 30 | 全成人25 |
| selenium UL µg | 400 / 450 / 450 / 450 / 400 | 全成人350 |
| molybdenum EAR µg | 20 / 25 / 25 / 20 / 20 | 全成人20 |
| molybdenum RDA µg | 30 / 30 / 30 / 30 / 25 | 全成人25 |
| molybdenum UL µg | 全成人600 | 全成人500 |

出典・目視照合: [微量ミネラル章・冊子pp.347、350、352](https://www.mhlw.go.jp/content/10904750/001316469.pdf)。

葉酸は男女とも成人EAR 200µg/日、RDA 240µg/日。ULは年齢順900/1000/1000/900/900µg/日で、通常食品以外に含まれる葉酸の適用範囲を持つ。folateの化学形態・当量・scopeを確認できない汎用記録ではULをcomparable=falseにする。[水溶性ビタミン章・冊子p.239、脚注1–3](https://www.mhlw.go.jp/content/10904750/001316467.pdf)を目視照合した。妊娠関連の付加量や400µgの別の参考情報を通常成人の目標へ足さない。

### 既存ロジックを守る追加方法

DRI datasetは新しいrevision識別子（例: report-corrected-2025-03-25-app-30codes-v1）を持たせる。公式訂正日とアプリ実装版を混同しない。既存18の値・境界・comparable・comparisonScopeはgolden fixtureで固定する。

新12のreferencesとcodeごとの比較可能性を追加し、既存evaluateDriInterval、stableReferences、review-priorityの軸分離を再利用する。saturated_fatだけ9kcal/gのpercent-energy対応を増やす。Mg/folateのULは対象scopeが確定するまで表示専用とし、対象データなしを「UL以下」にしない。

汎用folateをDFEと決めつけない。食品由来の定義に適合する記録ならEAR/RDAへ比較可能、形態不明なら量表示と判定保留にする。旧A/E/B6や女性鉄の保留を「29項目対応」のために解除しない。

## 6. この設計の限界

29項目を保存・表示できることは、全食品の29項目が判明することでも、外部DB/OCRが全項目を返すことでもない。入力、値の由来、比較可能性、DRI適用、PNG生成、カロミルOCR取り込みは別々の受け入れ項目として管理する。
