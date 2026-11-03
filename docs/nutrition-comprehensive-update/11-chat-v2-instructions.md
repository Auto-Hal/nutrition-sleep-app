# ChatGPT食事登録のv2利用案内

アプリの既存ChatGPTリンクは維持している。既存の専用Projectがv1登録手順を記憶している場合、追加12項目を使うには登録契約をv2へ切り替える必要がある。以下はProjectの指示として確認・コピーできる文章。今回、外部のChatGPT Project設定を自動変更したり、実食事を登録したりはしていない。

## コピー用の指示

```text
栄養記録の正本はnutrition-sleep-appです。
通常の食事記録先はProduction Supabase project vyvnicyupcrsmtgdyypvです。
確認画面は https://nutrition-sleep-app.vercel.app/today または /history です。
Preview project pprsfxpfljdjlwdfbtqoは検証用です。日常の実食事をPreviewへ記録しないでください。
アプリで選んだ日付と同じ本人の現地日付へ登録します。

直接登録には専用RPC private.register_meal_from_chat_v2を使います。
target_aliasはprimaryです。ユーザーUUIDを推測・入力しないでください。
Catalog/Mealテーブルを直接INSERT/UPDATE/DELETEしたり、複数の下位RPCを別々に呼んだりしないでください。

payloadはschema_version=2、registration_mode="direct"、request_id=新しいUUID、meal、itemsです。
mealには本人が指定した現地日付meal_date、breakfast/lunch/dinner/customのmeal_type、
eaten_atを指定する場合はタイムゾーン付きISO日時を使います。
固定の朝昼夕で時刻が不明ならnullにでき、customでは時刻の本人確認が必要です。未知の日時を作らないでください。
各itemはname、item_type、serving_size、serving_unit、摂取quantity、nutrientsを持ちます。
栄養値はserving_sizeあたりです。摂取量に合わせた二重乗算をしないでください。

nutrientsの各値はcode、amount（不明はnull）、unit、provenanceを持ちます。
provenanceはmeasured/official/database/label/calculated/estimated/user_reportedを区別します。
公式資料には認証情報を含まない出典URLを付け、推定値をofficialにしないでください。
推定や推定を含む計算はcontains_estimates=trueを維持してください。
source_observed_atを付ける場合もタイムゾーン付きISO日時を使います。

未収録成分に架空の値を与えないでください。空欄・不明を0にせず、確認された0だけ0にします。
ビタミンAの一般µg/IUをµg RAEへ、葉酸DFEを食品葉酸µgへ無条件に変換しないでください。
n3はEPA/DHA/ALA単独ではなくn3系総量、n6も総量です。
英語carbohydratesやsugarsを日本の総炭水化物・糖質へ推測で転記しないでください。
食塩相当量とナトリウムは同時に持てますが、塩分へ二重加算しません。
糖質のC−fiber算出は定義・資料・基準量が一致し、本人が確認した場合だけです。
計算根拠にはアプリの制限付きderivation契約を使い、自由な秘密情報や認証URLを入れないでください。

同じ内容の再送は同じrequest_idと同じpayloadで行い、duplicate結果を確認します。
内容を修正するときは同じrequest_idを使い回さないでください。
成功結果のentry/meal IDと対象日を本人へ示し、アプリのToday/Historyで確認できるようにします。
既存記録の訂正・取消はアプリのHistoryから行い、過去snapshotを書き換えないでください。
```

SQL呼出の形は次のとおり。payloadやUUIDは実際に確認した内容を使う。

```sql
select private.register_meal_from_chat_v2('primary', :request_id::uuid, :payload::jsonb);
```

## コード・単位

標準29は[02の一覧](02-nutrients-and-evidence.md)と`lib/nutrition/catalog.ts`が正本。内部Naを加えた30コードは次のとおり。

| 単位 | コード |
|---|---|
| kcal | energy |
| g | protein, fat, saturated_fat, n3_fatty_acids, n6_fatty_acids, carbohydrate, carbohydrate_excluding_fiber, fiber, salt_equivalent |
| mg | cholesterol, potassium, calcium, magnesium, phosphorus, iron, zinc, copper, vitamin_e, vitamin_b1, vitamin_b2, vitamin_b6, vitamin_c, sodium（内部用） |
| ug | selenium, molybdenum, vitamin_d, vitamin_b12, folate |
| ug_rae | vitamin_a |

`carbohydrate_excluding_fiber`が日本の糖質で、`sugars`コードはない。化学形態のallowlistは`lib/nutrition/nutrient-basis-contract.json`、制限付きderivation契約は`lib/nutrition/evidence-contract.ts`を参照する。

## 切替時の確認

- v1の18コード登録は継続できる。v1へ12コードを混ぜて送らない。
- 直接v2は1回のDB処理でCatalogと食事を確定する。OAuth/MCP経路はv2の確認待ちdraftを作り、アプリ本人の確定操作が必要。
- Chat側の`quality`分類だけでアプリのuser_verifiedには昇格しない。出典と本人確認は別の属性。
- 実ChatGPTでの接続、追加12項目、NULL、再送の受け入れ結果は未確認。DB/スキーマ自動テストの成功と分けて記録する。
- 本番への明示承認と移行は完了済み（[13の実施記録](13-production-release-2026-11-02.md)）。既存ChatGPT Projectが古いPreview専用の指示を持っている場合は上記へ更新し、実際の接続先projectを確認する。アプリの公開閲覧や本人ログインは、別DBへ記録したデータを本番へ移動する操作ではない。
