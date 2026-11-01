# DB・API・互換性・migration設計

これは実装するDDL/RPCの設計であり、実行用migrationではない。既存migrationは編集しない。今回DDL、migration repair、push、apply、resetは実行しない。

## 1. モデルの全体像

~~~mermaid
flowchart TD
  C[Catalog / Product / Batch] --> N[現在の30コードと由来]
  N --> S[新規MealEntry immutable snapshots]
  S --> A[owner-scoped集計RPC]
  G[目標の有効日・版・日別区分] --> A
  A --> P[日次PFC / 月間 / 週間]
  S --> X[転送用固定payload / JSON / CSV]
  N --> X
  B[体重計測履歴] --> W[7日平均 / 30・90日推移]
  B --> L[本人が選んだプロフィール連動]
  L --> R[新しい参考目標候補]
  R --> G
~~~

集計結果やPFC達成を正本テーブルとして保存しない。新しい睡眠テーブル・権限・外部体重scopeは不要。体重変化から保存済みgoalへ自動フィードバックしない。

## 2. 既存栄養テーブルの追加変更

nutrient_definitionsのcode CHECKを旧18＋新12へ拡張し、12定義を挿入する。保存unit集合は既存の5種類で足りる。既存code/label/unitを改名しない。global定義は認証済みSELECTのみ。

item_nutrientsとmeal_entry_nutrient_snapshotsへ、value_origin、definition_basis、intake_scope、derivation、contains_estimatesの**nullable**列を追加する。既存行へUPDATEや推定バックフィルを行わない。追加nullable列のNULLは旧由来不明であり、推定なし/公式という意味を付けない。

新規snapshotは新コードを含む30コードを作成でき、amount不明はNULL。過去のsnapshotに新コードのNULL行すら追加しない。新しい列を含めたpayloadは摂取時に凍結する。旧snapshot列の値・行数・hashが移行前後で変わらないことを検証する。

新しい入力RPCはcode/unitの整合、有限性、precision、重複、数値>=0、source URI/時刻、code別definition_basis、制限付きderivationを検証する。単位集合CHECKだけに頼らない。既存非有限/単位不一致の有無は事前監査の集計で検出し、発見時に自動修正しない。

## 3. 新テーブル

名前は次を採用する。全user_idはauth.users(id) ON DELETE CASCADE、全public新テーブルでRLSを有効にする。以下でnullable/任意/条件付きと明記した列以外はNOT NULL。許可集合のCHECKだけに依存せず、必須属性のNULLも拒否する。

### nutrition_goal_heads

| 列 | 型/制約 |
|---|---|
| user_id | uuid PK、owner FK |
| revision | integer >=0 |
| updated_at | timestamptz |

goal設定と日別区分イベントのstreamをownerごとに直列化する。初回rowがない場合はrevision 0と扱い、同時初回INSERTをadvisory lockで競合制御する。技術用headをユーザー履歴として表示しない。

### nutrition_goal_versions

| 列 | 型/制約 |
|---|---|
| id / user_id | uuid PK / owner FK。UNIQUE(user_id,id) |
| stream_revision | integer>0、UNIQUE(user_id,stream_revision) |
| action | set / cancel |
| supersedes_id | nullable uuid。ownerと組にした自己FK、他owner不可、同じ版の複数置換不可 |
| effective_from | setでdate必須、cancelは対象版の日付を記録 |
| mode | custom / profile_reference / training_split（set時必須） |
| time_zone | IANA zone。入力時のcivil date解釈を保存 |
| training_weekdays | smallint[]、1〜7、重複なし。split以外は空 |
| intent_created_at / recorded_at | timestamptz、端末の意図とサーバー保存を分離 |
| definition_version | 目標計算契約版 |

cancel/置換対象はまだ過去へ適用されていない将来予定だけ。active版の内容変更は新set版として別開始日で追加する。payloadのUPDATE/DELETEを許可しない。FK cascadeによるaccount削除だけは妨げない。

有効版は「supersedesされたsetを除外→effective_from<=日付→開始日/stream_revision降順」。未来予定の開始日変更は置換イベントと新set内容を**同一トランザクション**で保存する。旧予定だけが残る途中状態を作らない。

### nutrition_goal_variant_targets

| 列 | 型/制約 |
|---|---|
| goal_version_id / user_id | 親とownerの複合FK、ON DELETE CASCADE |
| variant | default / training / rest。PK(goal_version_id,variant) |
| energy_kcal | numeric(10,3)>0、有限 |
| protein_bps / fat_bps / carbohydrate_bps | integer各0〜10000、合計10000 |
| fiber_goal_g / salt_limit_g | numeric(12,3)、fiber>=0、salt>0、有限 |
| pfc_tolerance_bps / energy_tolerance_bps | integer、0〜9999 |
| calculation_source | manual / profile_reference |
| calculation_inputs | nullable、許可フィールドだけのJSONB。式版・採用元・profile revision等 |

custom/profile_referenceはdefault1行、splitはtraining/rest2行。cancelは0行。正確な行数とmodeとの組合せはRPC検証＋トランザクション末尾のconstraint triggerで保証する。APIを通さない特権経路でも不完全なgoalを作れないようにする。g数は保存しない。

### nutrition_day_type_events

id uuid、user_id、meal_date date、day_type(training/rest/clear)、stream_revision、time_zone、intent_created_at、recorded_at。owner/date/revisionで最新を取得。nutrition_goal_headsの同じrevision直列化を使う。

append-only。RLSのownerだけでなく、split modeと開始日の妥当性もRPCで確認する。clearは過去イベントを消さず、曜日予定に戻す。

### body_measurements

| 列 | 型/制約 |
|---|---|
| id / user_id | uuid PK / owner FK、UNIQUE(user_id,id) |
| measured_on | date必須、UNIQUE(user_id,measured_on) |
| weight_kg | numeric(6,2)>0、有限 |
| body_fat_percent | numeric(5,2)、NULLまたは0〜100、有限 |
| measured_at | nullable timestamptz。未入力はNULL |
| time_zone | 入力時のIANA zone |
| source | manual / user_confirmed_profile。外部同期は今回追加しない |
| revision | integer>0 |
| created_at / updated_at | timestamptz |

1日1件。2回目は既存の編集を案内し、最終更新時刻で無言upsertしない。date編集の移動先重複も409で止める。新規IDはクライアント生成uuidを保存意図に含め、再送で二重作成しない。

### body_measurement_tombstones

user_id、measurement_id、deleted_revision、deleted_atのみ。PK(user_id,measurement_id)。削除した体重/体脂肪/測定日時は保持しない。古い更新・再作成intentの復活防止用で、通常一覧には出さない。owner FK cascade、RLS、RPC-only。receiptの90日を過ぎても同じIDを再利用しない。

削除はbody_measurementsの実DELETE＋tombstone＋必要なprofile再計算を原子的に行う。soft deleteした体重値を「削除済み」と呼びながら残す設計にはしない。

### body_settings

user_id PK、revision、target_weight_kg nullable numeric(6,2)>0、target_pace_kg_per_week nullable numeric(6,3)有限、weight_sync_mode(profile_only/latest_measurement)、created_at/updated_at。

行なしはrevision0・profile_only・目標なし。migrationで既存体重を履歴化しない。目安ペースは本人の設定として保持し、医療的に安全な速度という認証を付けない。

user_profilesへweight_measurement_id nullable uuidを追加する。owner付き複合参照で別ownerを指せないようにし、循環する削除順に配慮してDEFERRABLE INITIALLY DEFERREDのFKとする。計測削除前に同じトランザクションで参照を切り替える。legacy単一体重はpointer=NULLで保持できる。Auth userのcascade削除でも最終的に参照行が残らないことをfixtureで検証する。

### karomiru_transfers

id uuid、user_id、source_kind(meal/meal_entry/catalog)、source_id uuid、source_revision、basis/quantityの制限付きJSON、mode(basic7/all29)、renderer_version、payload_schema_version、prepared_payload JSONB、content_hash、status(prepared/confirmed/revoked)、revision、prepared_at、confirmed_at/revoked_at。

PNGそのものは保存しない。prepared_payloadは**認証・owner照合後の固定出力値**で、既知項目・欠損理由・由来・分母・名称をallowlist保存する。元Catalogが後で変わっても、本人が確認した転送内容のhashを再現できる。これは食事正本を更新する機構ではない。

generic source_idの所有者検証をRPCに必須化する。meal_entryはmealを通じてownerを確認、catalogはownerを確認する。owner FKだけを満たす他人のsource_idを許可しない。過去の転送記録はsourceのvoid/非active後も保持し、account削除で全消去。

preparedは未転送。共有/PNG保存ではconfirmedにしない。本人の明示確認だけで更新する。元payloadと現行source hashが異なれば「別内容の転送履歴」と表示する。外部サービスのreceiptとは呼ばない。

## 4. API/RPC境界

全APIはapp session必須。書込みはisAllowedOriginでfail closed、ownerをbody/queryから受けない。認証とserver-only user JWTは既存実装を再利用する。新API・exportはprivate,no-store。errorは安全な固定コードへ写し、SQLやhealth payloadを返さない。

| API案 | RPC/責務 | 書込み契約 |
|---|---|---|
| GET /api/nutrition/goals | get_nutrition_goal_history_v1、期間の有効版/履歴 | 読取り |
| POST /api/nutrition/goals/reliable | append_nutrition_goal_v1 | head expected_revision＋operation |
| POST /api/nutrition/day-type/reliable | append_nutrition_day_type_v1 | 同じheadで直列化 |
| GET /api/nutrition/pfc?date= | get_nutrition_goal_period_v1(date,date)＋純粋計算 | 単一snapshot |
| GET /api/nutrition/pfc/month?month= | 同RPCに月の範囲 | 日×30とgoal/overrideをまとめる |
| GET /api/nutrition/pfc/week?date= | 同RPCに月〜日 | 今日・過去・未来を区別 |
| GET /api/body?range=30/90 | get_body_progress_v1 | 計算lookbackを含む |
| POST/PATCH/DELETE /api/body/measurements/reliable | create/update/delete_body_measurement_v1 | measurement、body settings、profileの必要revision |
| POST /api/body/settings/reliable | update_body_settings_v1 | body設定revision＋必要profile revision |
| POST /api/transfers/karomiru/prepare | prepare_karomiru_transfer_v1 | operation_id、source owner、固定payload作成 |
| POST /api/transfers/karomiru/confirm/reliable | set_karomiru_transfer_status_v1 | transfer revision、本人の手動確認 |
| POST /api/export | v1既存維持、version=2はexport_user_data_v2 | 読取りだがOrigin検証を維持 |
| POST /api/export/csv | export_nutrition_rows_v1 | 日/食事/食品、期間 |

既存 /api/nutrition/today はenergy-only既存フィールドの意味を維持し、新フィールドでPFCを追加するか新pfc APIを併用する。legacy JSON fieldを部分小計や個人targetへ転用しない。

新period RPCは最大366日、入力日付を実在日として検証し、date×30全件を同じSQL snapshotで集める。PostgRESTの行数制限に切られないよう**単一JSONB値**としてdays/rows/goalsを返し、期待件数を検査する。上限/timeout超過は明示失敗で、途中のレスポンスを完全評価にしない。

返却には同じsnapshotのプロフィールtimezone、集計as_of、nutrient/goal計算版も含める。新精度対象のnumericはSQLでtextへ明示変換し、JSの浮動小数へ一度落としてから文字列化しない。known/missing/definition mismatchの件数、既知分の品質/推定状態を別fieldにし、旧qualityの欠損maskから推定の有無を逆算しない。

既存7/30/90 analyticsのRPCと応答形式は残す。新UIの栄養詳細は同じperiod RPCから30コードを一括取得し、既存analyticsの完全日平均/known/evidenceフィールドを互換adapterで作る。これにより新UIの7/30/90にも単一snapshotを適用できる。旧client用の28日分割経路は残し、既存v1のRETURNS TABLEの列を破壊的に変更しない。metadataを表形式で必要とする場合は別v2 daily関数を追加する。

## 5. RLSとRPC-only書込み

読取りはSECURITY INVOKER、明示auth.uid()、owner predicateとRLSを併用。新テーブルのauthenticatedはowner-scoped SELECTだけ。anon/PUBLICのDMLを撤回する。

新write RPCは、authenticatedにtable DMLを与えない既存のRPC-only方式を継承するため、限定したSECURITY DEFINERを使う。利便性だけを理由に追加するものではない。全関数にauth.uid()のNULL拒否、owner照合、search_path=pg_catalog、完全修飾名、PUBLIC/anonのEXECUTE取消、必要なauthenticatedだけのgrantを置く。private helperは直接実行不可。

目標履歴のappend-only、所有者変更禁止、cross-owner親子参照拒否をDBでも保証する。new tableには(select auth.uid())=user_idのSELECT policy。書込みtable grantはないが、将来grantされてもowner越境しないpolicy/triggerを設計する。service_roleは通常CRUD/exportへ使用しない。

全新write RPCは既存private.phase6_acquire_write_guardへ参加する。削除開始のexclusive lifecycle lockと競合するshared writer lockを使い、削除guard後の新書込みを止める。外部HTTPの間にDB transaction/lockを保持しない。

bodyのlock順はlifecycle→operation receipt→既存profile advisory/row lock→body_settings→body_measurement。legacy profile更新もprofile→body_settingsの順に統一する。goalは別owner headで直列化。新しい跨ぎ方のdeadlockをpgTAP/実接続並列テストで検証する。

### インデックス

- goals: (user_id,effective_from DESC,stream_revision DESC)、owner/supersedes_id、head PK。
- day type: (user_id,meal_date,stream_revision DESC)。
- body: UNIQUE(user_id,measured_on)、UNIQUE(user_id,id)、profileのmeasurement参照列。
- transfers: (user_id,prepared_at DESC)、(user_id,source_kind,source_id,content_hash)。
- 子テーブルは親FK/ownerによるjoinとcascadeを支えるindex。

RLS内のauth.uid()をSELECTで包み、owner/dateを先頭にした複合indexを用いる。新たな大量の単列indexは測定なしに追加しない。[Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)に従い、viewを追加する場合もinvokerにする。

## 6. outbox・fingerprint互換性

### 最も重要な互換変更

現行reference payloadは全nutrient_definitionsから作られる。12定義の追加でhashが変わる。**定義追加より先に**legacy fingerprintの対象コードを旧18へ固定し、移行前と全く同じcanonical payload/hashになることをgolden testで保証する。

- legacy phase6 helperとcreate_meal_entry_v2は旧18契約を保つ。旧pendingを勝手に30コードpayloadへ変換しない。
- 新helperの参照schema 2は30コード＋追加metadataを含む。新MealEntry作成/履歴replaceのv3はこのfingerprintで照合し30コードをsnapshotする。
- 旧v2経路からのMealEntryは旧18のsnapshotで、追加12は不明となる。この制限を互換経路として明示し、新UIはv3を使う。
- 既存receiptの検索/照合順を維持し、同operation_idの応答欠落再試行が定義更新後も同じ結果を返すようにする。

outer mutation contractは新操作を2、既存pendingを1として併存。IndexedDBのDB_VERSION=2はrecord store構造が同じなら据え置く。normalizeRecordをsupported versions {1,2}へ拡張し、1をblockedへ落とさない。DB schema version、outbox contract version、nutrient schema version、Chat payload version、export schema versionを別々に扱う。

新kind: goal_append、day_type_append、body_measurement_create/update/delete、body_settings_update、karomiru_transfer_confirm。entity_key、mutationRequest、safe error mapping、lease/retry/wakeup、receipt lookup、current-device cleanupへ追加する。goal/day-typeはownerの同じheadをentity keyにする。prepareはonline限定の直接mutationだがoperation receiptで再送を保護し、outbox kind追加は不要。

operation_id、owner/environment、created_at、expected revision、payloadは保存したintentのままreplayする。30日上限・90日receipt・失効/競合時の保持・手動解決は既存を維持する。

goal/day-typeの同一head、またはprofile連動を伴うbody設定に未同期intentがある間は、その状態に依存する次の設定保存をUIで止める。順番待ちのexpected revisionを暗黙に書き換える機構は作らない。通常の食事入力をこの設定待ちで止めない。

### 旧編集による新12項目の消失防止

legacy Catalog full replacementを新30の全置換として解釈しない。旧契約での変更対象は旧18だけとし、basisが同じなら新12とそのmetadataを保持する。legacy payloadに既知の新codeが来たら無視せずunsupported_nutrient_schemaで拒否。

legacyのserving size/unit変更時に新12値が存在する場合、全項目の分母が揃うことを旧画面で確認できないため409 upgrade_required_for_serving_basisを返し、新アプリでの再確認へ導く。Productのreplace_all_nutrientsも旧18の範囲でだけ置換。既存のverified overwrite確認を解除しない。

Batchの再計算と新規snapshotは新contractのmetadata伝播に対応する。材料変更で影響した現在Batchを更新できるが、過去の摂取snapshotは不変。

### 遅延同期と有効開始日

目標の「当日以降」は、online操作なら保存時、outboxなら検証したintent_created_atの保存timezoneにおける日付を基準とする。例えば月曜に月曜開始を選んで火曜に同期したintentを、火曜になったという理由だけで異なる開始日に書き換えない。

serverは既存30日intent期限/未来時刻制限を検証し、effective_fromがintentのlocal dateより前なら拒否する。記録にはrecorded_atも保持し、「後日同期した設定」と分かるようにする。端末作成時刻が本物であるとの保証を付けず、過去にサーバーへ保存済みだったかのように表示しない。競合したpendingを現時点のgoalへ自動適用しない。

## 7. 追加migrationの分割案

実装開始後にSupabase CLIの現行helpを確認し、migration newで発行する。以下のM1等は論理IDであり、捏造したtimestampファイル名ではない。

| ID | 内容 | 依存/安全策 |
|---|---|---|
| M1 | 旧fingerprint18固定、旧更新の保護、互換入口の準備 | 既存golden hash・receipt不変 |
| M2 | code CHECK拡張、12定義、nullable evidence列、30code用v3 RPC、daily v2 | M1後。過去snapshot DMLなし |
| M3 | goal/head/variant/day-type、RPC、RLS、guard | 目標値バックフィルなし |
| M4 | body/settings/tombstone、profile pointer、旧profile RPC連動 | 旧profile値を維持、架空計測なし |
| M5 | transfer固定payload/手動確認、RLS、guard | 画像/外部APIなし |
| M6 | JSON v2 / CSV snapshot RPC、cascade/export契約の完成 | M2〜M5後、v1を維持 |

どの段階でも新テーブル導入と同じPRでRLS・grant・guard・cascade・export対応を入れる。M3/M4/M5を導入した時点で暫定export v2へそのテーブルを含め、最後M6で出力UI/CSVを統合する。「次PRでセキュリティを追加する」期間を作らない。

### migration前flight

1. main/作業head、対象project、environment bindingを記録。
2. Hosted履歴のversionが異なるため、名前・DDL・function body・grantsを照合。PreviewのChat履歴欠落やBatch ACL差を説明できる状態にする。
3. global定義18/units、snapshot列、RPC署名、RLS、既存index、孤児/単位不一致/非有限件数をread-onlyで確認。実値は成果物に持ち出さない。
4. 実装後のfresh空DB replayと旧18データupgradeの両方をisolated環境で検証。
5. migrationのlock timeout/statement timeoutを設定し、想定外の待機で止める。CHECKの置換はtransaction内。大量テーブルへ不要なdefault/backfillをしない。
6. 制約が既存違反を見つけたらfailして調査し、過去snapshotを都合よく修復しない。

migration ledgerのrepairや既存migration改名は今回の機能導入と混ぜない。必要なら別の根拠付き運用作業として承認範囲を確認する。

## 8. rollback

基本は**前向き互換DDLを残してアプリを最後の互換版へ戻す**。新コードを保存し始めた後に18code CHECKへ戻す、定義をDELETEする、新履歴tableをDROPする、過去snapshotを復元dumpで上書きする操作は禁止。

rollback先はM1と新metadataを認識する互換版である必要がある。元の7b2bceaへ無条件に戻すと旧全置換で新12項目を失うため、M1互換bridgeを最初の退避可能版として確保する。30code未導入時だけ元版へ戻せる。

読み取りUIのfeature切戻しでも新kindのpendingを消さない。旧アプリがversion2を理解できない場合は新操作を停止・保持し、version1の復旧を優先できる互換bridgeを使用する。DB downgradeが不可避なら、データを削らない追加修復migrationと別の明示承認が必要。

## 9. 環境と本番ゲート

Preview/Productionの接続先・private alias・Admin・Google credentialsを混用しない。Migrationは専用projectへだけ適用し、study等は対象外。通常export/CRUDへAdmin keyを持ち込まない。

現在PR作成でPreview workflowが動く。実装段階ではユーザーのPreview変更許可範囲を確認してからPRを開く。main更新とProduction deploymentは関連して起動し得るため、手動workflowだけが本番ゲートと仮定しない。今回のアップデートの自動/Preview/実機検証が揃った後に、新しい明示承認を得るまでmainマージ・Production migration/deployを行わない。
