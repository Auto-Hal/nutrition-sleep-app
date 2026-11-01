# カロミル転送・export・体重プロフィール連動

設計版1 / 2026-11-01。ここに記載するPNG、CSV、Body APIは未実装。

## 1. 転送の責務と対象量

自作アプリが正本。外部の非公開API、スクレイピング、自動操作、外部登録成功の推測に依存しない。公式の[カロミル画像解析ヘルプ](https://support.calomeal.com/hc/ja/sections/6568307796761-%E7%94%BB%E5%83%8F%E8%A7%A3%E6%9E%90)も確認したが、任意の29成分PNGを全て取り込める契約は得ていない。

| 起点 | 値の正本と倍率 | 避ける誤り |
|---|---|---|
| Today/History・食事全体 | 選択mealのactive entriesの摂取snapshotを合計 | snapshotにquantityを再乗算しない |
| 食品行 | そのMealEntryの摂取snapshot | 現在Catalogで過去値を再計算しない |
| Catalog/Product | 現在のserving basisに対して選んだquantity/serving_size倍 | 100gと1袋/1個を混同しない |
| Batch | 保存されている一食分から選択食数倍。全量はservings倍 | 全Batchを1食として画像化しない |

ライブラリのquantityは同一unitだけを許可し、g/ml/個の間に根拠のない換算をしない。食事全体の栄養素は構成食品のいずれかが不明なら全量不明。既知小計を料理全量の確定表示としてPNGへ載せない。

過去の栄養値はimmutableだが、既存MealEntryの名称は現Catalog joinに由来する。元の名前を保存していない期間を当時名として復元しない。転送名称は本人が確認・編集でき、食事正本名をその操作で変更しない。

## 2. 固定payloadと手動確認

prepare APIはsession ownerのsourceを検証し、単一snapshotで出力用payloadを生成する。source kind/id/revision、量の分母、選択量、code/amount/unit、由来、欠損理由、mode、renderer版、名称を固定しcontent hashを付ける。

karomiru_transfersにはこの固定payloadを保存し、status=preparedとする。画像はclientで描画する。画面でmode/量/名称を変えた場合は新しいprepare intentを作り、その内容のhashを使う。同一prepare再試行には同operation_idで冪等に応答する。

PNG保存/共有は状態をconfirmedにしない。本人が外部アプリで値と対象量を確認した後、「登録を確認した」でconfirmedにする。取り消しはrevokedで、revisionとreceiptにより再送/競合を制御する。外部側から登録成功を検出したという意味ではない。

共有途中のcancelは通常の操作として扱う。外部登録したか不明ならpreparedを維持する。sourceが後に変更/voidされても転送した固定payloadを上書きしない。現行内容とのhash差を示し、同じ食事の再登録が必要とは自動判断しない。

準備はonlineが必要。準備済み画像は同じ画面でofflineでも保存/共有を試せるが、オフライン冷起動で元データを新たに取得できるとは表示しない。手動確認はowner/environment拘束のoutboxで保持できる。

## 3. PNGレイアウト

**basic7（既定）:** energy、protein、fat、carbohydrate、carbohydrate_excluding_fiber、fiber、salt_equivalentの順。ユーザーからこの7項目の実機OCR成功実績が提示されているが、本実装の生成画像で再確認する。

**all29:** 標準29の既知・出力定義が一致する値を全て含む。sodiumは含めない。ここでの出力定義一致はDRIとのcomparableとは別であり、コレステロールのように基準がなくても量が分かれば画像化できる。未知の栄養量や根拠なしの形態換算値は画像に0として置かず、その行を省略する。上部プレビューで「記載N/29項目」と省略一覧を確認できる。

最初の実装では**1対象につき1枚**。白背景、黒文字、高コントラスト、単列のラベル/数値/unit、十分な行間。初期設計寸法はbasic7が幅1200px・文字48px・行高88px程度、all29が幅1440px・文字44px・行高76px程度（高さ約2800px）。これは実装・端末メモリ/OCR結果で調整する製品値であり、互換性保証ではない。

数値列は揃え、µg RAE等を明記する。栄養量と誤読される装飾数値、達成率、目標量、DRI値を画像に含めない。名称・表示対象量は栄養行と離れた短いheaderで示す。フッターの注意事項はOCR画像内へ大量に書かず、アプリのpreviewに置く。任意のHTMLや外部画像はcanvasへ描かない。

PNGの表示精度は元の保存精度を失わない方針とする。通常はkcal0〜2桁、g/mg/µgは値に応じた必要小数を用い、0<値<最小表示単位のとき0へ丸めない。必要なら保存精度6桁まで、ライブラリ量換算の微量ではさらに桁を増やして表す。描画可能な精度/桁数を超える場合は0を作らず省略し、表示精度による省略と元データ不明を別に通知する。長い数値は文字を小さくする前に列幅を調整する。**明示0だけが0表示**。目標や判定にPNG用丸め値を逆流させない。

推定・未確認値はアプリ内で該当項目を示し、生成前に品質を確認できる。画像生成のためにestimatedをofficialへ変更しない。生成PNGは公式のメーカーラベルを装わず、アプリ記録に基づく共有表であることを短い標題で示す。

### 長さと分割リスク

全29が長すぎる場合も、初版で自動分割しない。複数画像を順次OCR登録すると別メニューとしてenergy等が二重に計上され得るためである。all29のOCRが不十分ならbasic7を1回登録し、追加成分は同じメニューで手動確認する手順を案内する。

将来分割を検討するときは「参考明細・追加登録しない」画像と登録対象画像を明確に分け、実機で同一メニューへの追記動作を証明してから別設計で扱う。今回の完了条件に画像分割による29OCR成功を含めない。

## 4. iOS保存・共有・コピー

canvas→Blob→image/pngのFileを準備し、previewを表示してから操作ボタンを有効にする。PNG生成中にshareを連鎖してuser activationを失わないよう、本人の別tapでnavigator.shareを呼ぶ。

navigator.canShare({files})で判定し、HTTPS・権限・ブラウザ差を扱う。[Web Share API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Share_API)、[WebKitのuser activation説明](https://webkit.org/blog/13862/the-user-activation-api/)を根拠にする。共有成功はOSへ渡したことにすぎず、カロミル登録完了ではない。

PNG保存はBlob download、iOSでdownloadが使えない場合は画像を開いて保存するfallback。メニュー名はclipboard.writeTextを明示tapで呼び、不可なら選択可能なテキスト欄を示す。メニュー名のOCR入力は保証しない。

Blob URLはclose/再生成時にrevokeする。PNGをSupabase Storage、service worker cache、outboxへ保存しない。別アプリへ共有したファイルやトレーナー側のデータを本アプリのaccount削除で消せるとは表示しない。

## 5. 転送時の欠損通知

previewに次を表示する。

- 記載した値と対象量、推定/未確認を含む項目。
- 選択モードから省略した項目、データ不明/定義不一致の項目を別一覧で表示。
- 「転送先で画像にない成分が0表示になる場合があります。0であると確認された値ではありません」。
- energy/PFC/糖質/fiber/saltの認識値、単位、1食/全量、日付を外部で確認する手順。
- 同じ食事のbasic7とall29を両方新規登録しないこと、共有済みと手動確認済みの違い。

完全量不明の項目は画像にknown subtotalとして紛れ込ませない。全項目不明ならPNG生成を止め、出典/量の確認へ案内する。通常の食事記録は保存したままにする。

## 6. JSON互換性

現行POST /api/exportの未指定動作とexport_user_data_v1を維持する。v1のトップ構造、既存key/unit、snapshotの生値、single SQL snapshot、allowlistを変えない。nutrient_definitionsはもともと動的なので、DB拡張後はv1でも30定義/新codeが含まれ得る。

リポジトリ内に外部v1利用者のparserは見当たらない。hardcoded18の利用者との完全互換は保証できないため、既存fixtureと動的定義の利用を検証し、この意味の拡張をrelease noteへ書く。v1は新goal/body/transferの完全exportではないことをUIで明示する。

新UIの推奨JSONはversion=2を指定する。トップの既存profile/nutrition/sleep/provider_connectionsを残し、次を追加する。

| 区画 | 内容 |
|---|---|
| schema_version | 2 |
| definitions | nutrient_schema_version、全30定義、標準29の順序、internal code、単位、定義/renderer/目標計算/DRI dataset版 |
| nutrition | 保存されたcurrent valuesと全MealEntry snapshots、nullable新evidence属性 |
| goals | 全set/cancel/置換履歴、variant、day type events、有效日、保存/intent時刻、出典 |
| body | 現計測履歴、設定、削除tombstoneは値を含まない最小metadataとして明示 |
| transfers | 準備した共有payload、手動確認/取り消し、mode、hash。外部成功記録ではない |
| export_scope | サーバー保存済み、restorable_backup=false、retained normalized sleep scope |

古いsnapshotの新code行を合成して「当時保存された値」にしない。定義とLEFT JOINすれば不明を再現できる。データ型NULL/0を保持し、snapshot値・旧sourceを再計算しない。

exportは単一SQL statementまたは同等のread-only repeatable-read transaction、owner-scoped invoker。個別HTTPの寄せ集め禁止。timeout/size/行上限で途中を返さず、明示エラー。goal/body/transfer新テーブル追加と同時にallowlistへ含める。

既存除外に加えて、goal headの内部lock情報、operation receipt、raw Chat drafts/registration receipts、session/provider credentials、環境値、削除操作internalsを出さない。source URIは栄養由来の明示項目としてのみ扱い、token/query secretを含むURLを新入力で拒否する。

## 7. CSV

期間は必須のstart_date/end_date（inclusive）、最大366日。長期間は別exportとして選び直す。全粒度で選択した期間・timezone・schema versionが行から分かるようにする。

| granularity | 1行の定義 |
|---|---|
| daily | 指定範囲の各暦日。未記録日もstatus付きで出す |
| meal | 保存された各meal。customはmeal_id単位、skipped/空記録も状態を残す |
| food | active MealEntryの摂取明細1件。現Catalog単位の期間合算ではない |

foodは現在の100g基準の栄養値ではなく、保存snapshotの摂取量を出す。食事訂正でvoidされた行は通常CSVへ含めず、JSON v2に保持する。各行に粒度、meal_date、meal/entry/catalog ID、type、表示名、量/unit、record_stateを付ける。過去名を保存していない場合はcurrent_catalog_nameと明示する。

29項目の主列はcode＋unit suffix（例energy_kcal、protein_g、vitamin_a_ug_rae）。主列に入る量は完全な対象合計だけ。dailyは記録完了＋食品あり＋対象値全件既知、mealはrecorded＋食品あり＋全対象値既知、foodはそのsnapshot値を条件とする。

各codeに補助列を付ける:

    code__known_amount / code__state / code__missing_entries /
    code__quality / code__origin_summary / code__definition_basis /
    code__contains_estimates

stateはcomplete/partial/unknown/incompatible/not_recorded/empty等。日次不完全だが全登録食品値が既知の場合も、主列は空欄、known_amountで登録小計を示す。known entries=0ならknown_amountも空欄。明示0は0。sodiumは標準CSVには入れず、「内部項目を含む」の明示選択時だけ追加する。

UTF-8 BOM、CRLF、RFC4180のquote escapingを使う。日本語・改行・カンマ・引用符を含む名前を検証。名称など文字列の先頭=、+、-、@、tab/CR等によるspreadsheet formula実行を防ぐ安全化を行い、その仕様を説明する。実数列の負の差分は文字列の安全化と混同しない。元の文字列はJSONで取得できる。

CSVも同じownerの同じsnapshotを使用し、row limitによる欠落を成功として返さない。食事・食品名だけで他ownerの行が混入しないこと、3粒度を元snapshotから再集計して一致することを検証する。

## 8. 体重とプロフィールの連動

体重履歴の正本はbody_measurements。プロフィールのweight_kg/weight_updated_onは従来の単一参照値として残す。新body_settingsのmodeは既定profile_only。

### 初期状態と本人の選択

- migrationでprofileから計測行を生成しない。
- 既存profileに値があれば「履歴なし・単一プロフィール値」と表示。
- 本人が日付/値を確認して1件登録した場合だけsource=user_confirmed_profileを作る。
- 「最新計測をプロフィールに反映」を本人が選ぶとlatest_measurementへ。profile_onlyなら履歴追加でprofileを変更しない。

### latest_measurement mode

profileへ反映する値は未来でない最新measured_onの実計測1件。weight_updated_onはその測定日、weight_measurement_idはそのID。過去計測の追加/修正で最新日が変わらなければprofile値は変わらない。

最新計測の編集はprofileにも原子的に反映。最新計測の削除は次の最新へ切替え、0件ならweight_kg/date/pointerをNULLにする。以前の手動profile値を勝手に復活させない。削除確認画面で具体的な反映先を示す。本人はprofile_onlyへ切替え、別の単一値を設定できる。

未来日の計測は受け付けない。measured_atを入力した場合は明示offsetを要求し、そのtimezoneのmeasured_onと一致するか検証する。時刻なしを00:00の実測として保存しない。

計測行の削除は、その計測rowとprofileへの参照を対象にする。既に採用した目標のcalculation_inputsに保存された体格は目標設定時点の別履歴であり、計測削除に連動して書き換えない。削除の説明でこの範囲を示し、全てのコピーが消えたとは表示しない。account削除では両方を消す。

### 旧profile APIとの両立

legacy upsert_user_profile/upsert_user_profile_v2と通常/reliable routeを調査・更新対象にする。

- profileの体重/日付が変わらない更新はbody連動mode/pointerを保持。
- 本人が体重/日付を明示的に変えた旧profile更新は、同じトランザクションでprofile_onlyへ切替えpointerを外す。履歴を自動生成しない。
- 新UIではmode変更を説明する。旧pendingでprofile revisionが古い場合は既存409と手動解決を維持し、最新測定を無言上書きしない。
- body操作は必要なmeasurement revision、body_settings revision、profile revisionを送る。いずれか競合なら全体rollback。計測だけ保存されprofile反映が失われる途中成功を作らない。
- 同一operation再送は既存receiptで同じ結果。deleted IDに対する古いcreate/updateはtombstoneで拒否。

この整合方式はbodyとprofileに影響する全write pathを網羅して初めて有効。legacy RPCを残したまま新UIだけ対応して完了としない。

## 9. 体重の出力・削除・振り返り

JSON v2は実測row、任意体脂肪、実在時刻、source、revision、body設定とprofile pointerをallowlist出力。栄養CSVとは別の将来Body CSVは今回の必須要件には含めず、JSONで履歴の可搬性を保証する。

account削除はmeasurement/settings/tombstone/transfers/goalsをowner FK cascadeで消す。global nutrient definitionsは残す。他ownerのsynthetic rowが残ることをpgTAPで検証する。

30/90日画面では体重傾向と同期間の食事記録完了/目標達成の件数を並べる。未記録日は栄養不足と呼ばない。睡眠同期scopeはsleep-readonlyのまま、Fitbit/Googleの体重取得権限は追加しない。
