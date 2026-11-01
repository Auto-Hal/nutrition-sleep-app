# 現状監査レポート

監査日: 2026-11-01。基準はmain **7b2bcea83c97d14aa8b11b06a8f2d0377dbbaec5**（2026-10-26 06:46:14 JST、PR #46）。remote mainのSHAとローカルcloneのHEADを照合した。

## 1. 構成と直近の変更

Next.js 15.5.24 App Router、React 19.1.1、TypeScript 5.9.2、Supabase JS 2.57.2、pg 8.16.3、Zod 4.1.5。pnpm 10.15.0をlockfileで固定する。package.jsonのNode指定は22.x、.node-versionは24.19.0、Sleep E2E workflowは22。実装前に実行環境を整理するが、今回package/workflowは変更しない。

| mainへの統合 | 現行判断への影響 |
|---|---|
| PR #39 | 既知量の平均と完全データ日の平均を分離 |
| PR #40/#41 | 記録からの行動支援、緑・青の簡潔なUI |
| PR #42 | profile outboxの起動・復旧 |
| PR #43 | 体重と更新日の扱いを改善 |
| PR #44（27aefa1） | 欠損を残すevidence・区間評価・見直し順序 |
| PR #45（126a2fa） | 少日数でも成立する既知量比較を維持 |
| PR #46（7b2bcea） | Sleep Score v1、期間傾向、観測に基づく提案 |

履歴はgitのfirst-parentとGitHub APIのmainコミットで確認した。過去の設計書よりこれらの実装を優先する。

## 2. 栄養モデル

根拠: [catalog.ts](../../lib/nutrition/catalog.ts)、[Phase 2 schema](../../supabase/migrations/20260914000000_phase2_meal_catalog.sql)、[integrity hardening](../../supabase/migrations/20260914010000_phase2_integrity_hardening.sql)、[Product provenance](../../supabase/migrations/20260923050000_phase6_product_provenance_v2.sql)。

| 対象 | 現行の保存と意味 | 再利用/変更 |
|---|---|---|
| nutrient_definitions | text PKの18コード、code CHECK、unit CHECK。認証済み参照のみ | CHECKを追加migrationで30へ拡張。既存コード・unit維持 |
| catalog_items | owner、type、名称、serving_size/unit、active、revision、作成意図キー | serving basisとrevisionを継続 |
| item_nutrients | (catalog_item_id, nutrient_code) PK、amount numeric(18,6) nullable、unit、provenance、quality、source_uri/observed_at | 新12項目と由来/定義メタデータを追加 |
| products | catalogと1対1、JAN/GTIN、package amount/unit、identity source | 栄養の出典と商品identityの出典を分離するv2を維持 |
| batches | catalogと1対1、servings、dish_name | 一食分と全量を区別 |
| batch_components | owner、材料catalog、quantity/unit、position | 単位検証・非循環等の既存契約を維持 |
| meals | owner、meal_date、朝昼夕/追加、state、eaten_at、revision | 固定3枠と追加食を維持 |
| meal_entries | catalogへの参照、quantity/unit、voided_at、intent key | 訂正はvoid＋新規snapshot |
| meal_entry_nutrient_snapshots | (entry, code) PK、実際の摂取量、unit、source catalog revision、quality、provenance、出典 | 不変。過去追加行の生成も禁止 |

現行18コード: energy、protein、fat、carbohydrate、fiber、calcium、iron、zinc、vitamin_a、vitamin_b1、vitamin_b2、vitamin_b6、vitamin_b12、vitamin_c、vitamin_d、vitamin_e、sodium、salt_equivalent。unitはkcal/g/mg/ug_rae/ug。完全な新一覧は[栄養素設計](02-nutrients-and-evidence.md)。

amountは非負またはNULL、栄養素unitは各書込みRPCで定義と照合する。authenticatedは栄養テーブルを直接書けず、RPCが書く。単位CHECKだけでは化学形態の一致を保証しない。既存CHECKの非負条件だけに非有限値拒否を委ねず、新契約ではSQL/API双方で有限性を検証する。

Batchは材料全件の対象栄養値が判明した場合のみ「材料栄養量×材料quantity/serving_sizeの合計÷servings」を保存し、どれか不明ならその栄養素をNULLにする。provenanceはbatch_calculation、qualityは材料の最も低い状態を伝播する。過去のMealEntryへ現在のBatchを再適用しない。

## 3. 取得・入力・ChatGPT

| 経路 | 現行実装 | 変更点 |
|---|---|---|
| 手動Catalog | [catalog-library](../../components/catalog-library.tsx)と定義配列からフォーム生成。空欄は省略 | 標準29のグループ化、sodiumは詳細へ |
| Product手動/OCR編集 | [product-ingestion](../../components/product-ingestion.tsx)。identityとnutrient sourceが別 | 単なる配列追加では完了しない。値由来を編集でも維持 |
| バーコード | local優先→OFF→Yahoo exact-JAN。Yahooはidentityのみ | 新コードは根拠のあるOFF項目だけ対応。不収録は不明 |
| OCR | [label-ocr](../../lib/products/label-ocr.ts)の語彙・単位換算と[geometry parser](../../lib/products/nutrition-label-parser.ts) | 2つの定義表・行割当・部分一致を更新 |
| URL fragment import | ChatNutritionDraft schema v1、18コード、確認後に通常登録 | v1互換と新schemaの併存 |
| OAuth/MCP draft | [Edge Function](../../supabase/functions/nutrition-mcp/index.ts)は18コード、pending draftのみ | コード一覧、上限、manifest/入力契約を更新 |
| Chat直接登録 | [private.register_meal_from_chat_v1](../../supabase/migrations/20261006110000_phase7_chat_direct_registration.sql) | DB内の18上限、payload schema、由来の保存を更新 |

Chat直接登録はアプリcookie認証APIではなく、管理connectorから私有aliasへ書く専用関数。alias→ownerはprivate binding、user UUIDを入力させない。multi-itemを単一トランザクションで登録し、request_idとpayloadによる私有receiptで冪等化する。同IDの異なるpayloadは拒否する。機能追加でこの境界を一般的な任意SQL書込みへ広げない。

Chatのofficial/databaseは既存モデルではどちらもapproved_external_dbへ写る。labelはproduct_label、estimatedはestimated_dish、user_reportedはuser_entered。外部値はunverified、推定値はunknownで、quality=verifiedという入力だけで昇格しない。商品/サプリというChat入力も正式な商品identityを作らず、食事用estimated_dishへ写る。新メタデータで失われる区別を補う必要がある。

OCRはkJ→kcal、g/mg/µgの質量換算を行うが、現在は一般的なビタミンAのµgもug_raeへ写せる。RAEの明示・根拠を必須にする必要がある。既存のrow alignment修正やビタミン系fuzzy match禁止を弱めない。

**確認した定義差:** [OFF adapter](../../lib/products/open-food-facts.ts)はcarbohydrates_100gをcarbohydrateへそのまま写す。一方、現行[OFF公式schema](https://openfoodfacts.github.io/documentation/docs/Product-Opener/schemas/schemas/product/)はcarbohydratesをfiber除外、carbohydrates-totalをfiber込みと定義する。新しい糖質追加でこの2つを同じ量として二重利用しない。既存snapshotの一括修正はしない。新取得はsource schema/definitionを確認し、比較不能な値を保留する。

## 4. 日次・7/30/90日・DRI・見直し順序

根拠: [最終版の日次RPC](../../supabase/migrations/20260915083000_phase4_astra_corrections.sql)、[analytics](../../lib/nutrition/analytics.ts)、[intake-evidence](../../lib/nutrition/intake-evidence.ts)、[known-intake](../../lib/nutrition/known-intake.ts)、[reference-comparison](../../lib/nutrition/reference-comparison.ts)、[review-priority](../../lib/nutrition/review-priority.ts)。

- 朝昼夕がrecorded/skippedならrecord_complete。追加食は集計に含むが、固定3枠の代わりにはならない。
- active MealEntry snapshotsを日×定義でLEFT JOINする。行なしとNULLを欠損として数える。
- known_amountは非NULL小計。全不明・未記録でもSQL上0となる場合があるため、entry_count/missing_entry_countなしでは解釈できない。
- eligible_for_referenceはrecord_complete、entry_count>0、missing_entry_count=0が条件。空の完了日を0摂取として評価しない。
- 旧完全日平均、観測できた日の既知量平均、新evidenceの記録完了日集合に対する下限/上限不明は別物。
- 新evidenceは完了・食品ありの日を分母に含める。全不明日も分母へ残すが、全日全不明なら量はNULL。未完了日は期間比較から除き、日数として示す。
- 部分データの既知小計が低いだけで不足としない。既知分で上限を超えるなど、区間全体で成立する比較だけを返す。qualityとcoverageは同義ではない。
- 栄養の90日取得は28日単位に分割し、全日×全コードの応答を検査する。30コードなら1chunk=840行、90日=2700行。月31日=930行だが、上限への依存を増やさない。
- 現在の分割RPC呼出し間は単一DB snapshotを保証しない。厳密な月/週の目標対比は新しい単一RPCでまとめ、JSON/CSVも整合したsnapshotにする。

DRIは2025年版訂正2025-03-25。成人・性別・年齢階級・活動量を使い、EAR/RDA/AI/DG/UL/EER_REFERENCEを分離する。女性の鉄は月経情報不足等で保留、妊娠授乳の付加量は自動適用しない。期間内で参照が変わる軸はstableReferencesで保留する。Aの総RAEとUL、Eの形態、B6のULはcomparable=false等の既存制約を持つ。

プロフィール体格による参考エネルギー計算は[display-reference](../../lib/nutrition/dri/display-reference.ts)に既にある。18〜79歳の適用範囲、PAL、参照体位へのfallback、50kcal表示丸めを持つ。個人目標保存への転用時は「体格から算出」と「参照体位fallback」を区別する。

Phase 6旧見直し閾値3/7、7/30、14/90は期間の代表性に関する表示として残る。新evidenceの成立する比較を、その日数だけで再び隠さない。総合栄養スコア、AI不足率、RDAまでの量を一括推奨する機能は導入しない。

## 5. UI・プロフィール・睡眠・export

| 現行 | 内容 | 設計上の扱い |
|---|---|---|
| Today | 日付選択、過去日、食事入力、エネルギー要約、Chat導線、draft inbox、睡眠compact score | 既存入力を残しPFC要約追加 |
| History | 期間・日別履歴、MealEntry訂正 | 転送と月カレンダーの遷移先に再利用 |
| Nutrition | 7/30/90日、既知量と参照、行動ガイド、見直し、日/食事/食品ドリルダウン | PFC/月/週と詳細分析をサブ画面に分割 |
| Settings | Profile、Library（Catalog/Product/Batch）、JSON、account削除 | 目標と出力選択を追加。LibraryをTodayからも開ける |
| Sleep | Google Health同期、stage/離床詳細、score、傾向、提案 | API・モデル・同期権限を維持 |

現在のToday bootstrapはCatalogの**energyのみ**を読む。新PFCのoptimistic表示にはP/F/Cも取得し、snapshot確定前は未同期の暫定小計とする必要がある。

プロフィール体重はweight_kgとweight_updated_onの組、revision保護あり。履歴テーブルはない。[profile-form](../../components/profile-form.tsx)はIndexedDB pendingの復旧、未同期表示、競合時の明示選択を持つ。新体重履歴の同期が旧pendingを無条件上書きしてはならない。

JSONは**POST /api/export**→export_user_data_v1。Origin、app session、no-store、attachmentを実装。SECURITY INVOKERで単一SELECTにより同じsnapshotを構成する。profile、current catalog/product/batch、void済みを含む食事と保存snapshot、保持された正規化睡眠、許可したconnection metadataを出力する。全Provider修正履歴や復元可能backupではない。credential/private receipt/deletion internalsを出さない。最新sleep_details migrationがexport関数を再定義している。

## 6. 認証・RLS・outbox・削除

- 個人用の事前作成Auth userとAPP_ALLOWED_USER_ID。サインアップ/匿名/OTP/Magic Linkを使用しない。
- Browser→same-origin Next API→server-side user JWT→RLS。tokenは暗号化private.app_sessionsに保持。ブラウザへSupabase資格情報を渡さない。
- 読取りRPCは主にSECURITY INVOKER。RPC-only書込みは既存SECURITY DEFINER、auth.uid()、明示search_path、EXECUTE制限で保護する。
- IndexedDB名nutrition-sleep-outbox、DB version 2、mutation contract 1。owner＋environment（deployment種別＋Supabase host）で拘束する。
- 30日自動replay、90日receipt保持、30秒lease、同一entity直列化。revision_conflict/reference_changed/operation_content_mismatchを区別し、自動rebaseしない。
- reference fingerprintは**全nutrient_definitionsを含む**ため、定義追加だけで未同期MealEntryの照合値が変わる。移行前の旧hash契約保護が必須。
- Account削除はパスワード再認証、Origin、共有rate limit、lifecycle lock/guard、Google revokeのbest effort、server-only Admin、曖昧結果照会、Auth hard delete→FK cascadeを使う。
- 新しいユーザーテーブル・RPCにもguard、cascade、exportを追加する。唯一の実アカウントを削除テストに使わない。

## 7. Hosted環境の読み取り監査

対象アカウントはnutrition-sleep専用のSupabase接続。study等の別アカウントは使用していない。

| 項目 | Preview | Production |
|---|---|---|
| project | nutrition-sleep-preview / pprsfxpfljdjlwdfbtqo | nutrition-sleep-production / vyvnicyupcrsmtgdyypv |
| 状態 / region | ACTIVE_HEALTHY / ap-southeast-1 | ACTIVE_HEALTHY / ap-northeast-1 |
| service version | 17.6.1.166 | 17.6.1.166 |
| 栄養素 | 18コード・現行unit | 同左 |
| publicテーブル | 15、全RLS有効 | 同左 |
| anon SELECT/INSERT | 全15テーブルで不可 | 同左 |
| migration履歴末尾 | sleep_details 20261025152224 | sleep_details 20261010150123 |
| Chat直接登録migration履歴 | 見当たらないが関数は存在 | 20261006110000/110100あり |
| export / Chat登録定義 | Productionと空白を除いて一致 | Previewと空白を除いて一致 |
| Batch再計算のauthenticated EXECUTE | あり | なし |

照会した主要RPCはいずれもanon実行不可。Chat直接登録はprivateでauthenticatedにも実行不可。日次summary/exportはinvoker。その他の全関数・全policy・実ユーザーでの横断アクセスを今回完全再検証したとは扱わない。

migration履歴のversionはリポジトリのファイル名と多く異なる。新実装前は名前と実DDL・grants・関数定義を照合する。今回はrepair/apply/resetを実行していない。Batch ACL差分の原因は未確定であり、推測して修正しない。

Vercel projectはnutrition-sleep-app（prj_WiPB989mXurOuIgVm8asfmfdPA6W、team_aTOsma3gZ9xkcFkGJ53dUCCO）。

| 環境 | 確認できたdeployment | SHA / 状態 |
|---|---|---|
| Production（公開aliasも照合） | dpl_6wWY3x49CEv6s4CotFjdXdAsiD3Z | 7b2bcea / READY |
| Preview最新一覧 | dpl_G4A2jg6owiQBQ7hjVpJHJFjk9k2Y | 7b2bcea / READY |

Productionはnutrition-sleep-app.vercel.appのaliasが同じdeploymentを指すこともget_deploymentで確認した。READYはデプロイmetadataの状態であり、今回の認証後・実機動作確認ではない。新機能のデプロイも行っていない。

## 8. テストの現状と監査証拠

main SHAの[CI run 40237042069](https://github.com/Auto-Hal/nutrition-sleep-app/actions/runs/40237042069)はchecks/databaseとも成功。stepsにlint、typecheck、Vitest、verify:env、production build、fresh supabase start/reset、pgTAP成功を確認した。

[Sleep E2E run 40237042111](https://github.com/Auto-Hal/nutrition-sleep-app/actions/runs/40237042111)は成功。Chromium、iPhone 13相当WebKit、iPad Mini相当WebKitを対象とする。ただし実認証済み栄養CRUDや実Google同期のE2Eではない。

testsには18コード、商品/OCR、Batch、DRI、欠損/evidence、90日完全取得、profile復旧、session競合、outbox、export、削除、sleepのunit/contract/SSR統合がある。supabase/testsにはowner isolation、snapshot不変性、冪等性、revision競合、export、cascade等のpgTAPがある。独立したtest:integration scriptはなく、Vitest統合とpgTAPを実装計画で明示的に分類する。

今回のローカル検証は文書・参照・git差分に限定する。上記成功は既存mainのCI証拠であり、新機能の自動テスト成功・実機合格を意味しない。禁止事項に従いlocalを含めmigration replayは再実行しない。

## 9. 参照文書との相違

| 文書 | 現行との差分/採用判断 |
|---|---|
| README | Phase 5進行中/Phase 6予定という冒頭は古い。Node説明もpackageと不一致 |
| nutrition-evidence-design | PR #44/#45と整合。旧完全日平均を残す点、source quality未解決を維持 |
| phase-6-nutrition-priority-design | 完全日中心・日数閾値の旧記述は新evidence経路に一律適用しない |
| phase-6-account-lifecycle-design | 提案GET /api/account/exportではなく実装はPOST /api/export。安全設計は再利用 |
| phase-6.11-full-mvp-acceptance | 冒頭の未反映文言より末尾2026-09-29 MVP完了記録を優先。14 public tablesという旧監査件数は現行15 |
| phase-7.0-chat-assisted-nutrition-bridge | Preview限定の記述が残るがProductionにも関数とmigration履歴あり。新承認を与えた記録とは解釈しない |
| sleep-score-v1-design | main実装の派生score/独立品質/元データ保持と整合 |
| sleep-score-v1-validation | Production GO待ち・開始時deployment記述は当時の記録。現在の最新Productionは7b2bcea |

未確認: 現在の全runtime log、端末のpending実在件数、全栄養値の品質分布、手元iPhoneでの最新表示、外部OCRの29項目成功範囲。未確認事項を「異常なし」として埋めない。
