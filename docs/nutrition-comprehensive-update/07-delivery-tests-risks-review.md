# 実装フェーズ・受け入れ・リスク・設計レビュー

2026-11-01に作成した第1段階の計画と受け入れ基準。実装開始の追加承認後の実績は[09](09-implementation-status.md)、Preview受け入れと本番手順は[10](10-preview-acceptance-and-production-plan.md)を参照する。下記の計画上の完了条件を、実際に全て検証済みという意味にはしない。

## 1. 依存関係と安全な実装単位

~~~mermaid
flowchart TD
  A[P0 環境差分と契約fixture] --> B[P1 旧契約bridge]
  B --> C[P2 30コードと由来]
  C --> D[P3 目標履歴・日別区分]
  C --> E[P4 体重基盤・profile整合]
  D --> F[P5 日次・月次・週間]
  E --> G[P6 Body画面]
  C --> H[P7 カロミルPNG]
  F --> I[P8 UI・JSON/CSV統合]
  G --> I
  H --> I
  I --> J[P9 自動・Preview・実機]
  J --> K[本変更のProduction承認]
~~~

段階を分けても毎PRで既存機能が使えること、追加tableのRLS/削除/exportが欠けないことを条件にする。未公開機能は準備完了までUIへ出さず、秘密を含まないserver config/通常の分岐で制御できる。新しい外部feature flagサービスは必須ではない。

| phase / PRの主題 | 主な範囲 | 依存 | その段階の完了条件 |
|---|---|---|---|
| P0 監査差分の再確認 | main更新差、Hosted migration/ACL、旧fixture、実行Node統一方針 | 設計承認＋実装開始指示 | 説明できない環境差を移行前チェックへ固定。秘密/実データをfixture化しない |
| P1 旧契約bridge | M1、fingerprint18固定、旧full replacement保護、outbox 1/2併存 | P0 | hash/receipt不変、新12消失防止、旧pending復旧。rollback先bridgeを確保 |
| P2 栄養基盤 | M2、全30code、由来/定義、manual/Product/OFF/OCR/Chat/Batch/v3 snapshot | P1 | 29標準/30内部、欠損・単位・化学形態・18回帰、Chat全経路 |
| P3 目標基盤 | M3、goal history、profile参考、split/override、reliable API、暫定JSON v2 | P2 | preset計算、100%、revision、有効日、未同期/取消、owner/削除/export |
| P4 Body基盤 | M4、計測CRUD、profile連動、legacy profile API、JSON v2 | P2 | 複数write経路で整合、架空履歴なし、削除/cascade/競合 |
| P5 PFC分析 | 日次、共通日集合の月次、週次、単一snapshot RPC、純粋計算 | P3 | 境界・欠損・曜日・目標変更・timezone・極端提案防止 |
| P6 Body画面 | /body、平均/推移/ペース、目標体重、食事傾向並列 | P4、P5の期間データ | 日付/時刻不明、空状態、7/30/90、profile表示一致 |
| P7 PNG転送 | M5、prepare、7/29、canvas、保存/共有/コピー、手動確認 | P2 | 全起点/量/不明/metadata固定。外部成功とは別の状態 |
| P8 統合 | M6、5タブ、Nutritionサブ画面、JSON v1/v2/CSV、全出力 | P5〜P7 | 従来URL維持、29全経路、iPhone情報量、single snapshot |
| P9 受け入れ | 全自動、Preview、実機、PRリリース資料 | P8 | 下記ゲートを証拠付きで完了。未確認は未確認のまま報告 |

「小さなPR」でもM1〜M6を一度に本番へ自動適用しない。migration順と対応app contract、rollback可能版をPRごとに明記する。今回の設計PRを本番コード変更として扱わない。

## 2. 要件と受け入れID

| ID | 要件と証明する内容 | 主な層 |
|---|---|---|
| N01 | 標準29/内部30、旧18code/unit保持、全12登録/取得 | unit、RPC、pgTAP、UI |
| N02 | NULL/欠損行/明示0/trace/非有限を分離 | unit、SQL、CSV/PNG |
| N03 | Na↔salt、両方既知時の二重計上なし | unit、RPC、集計 |
| N04 | 糖質/糖類/利用可能C、A RAE、E、Mg/葉酸scopeを誤統合しない | adapter/OCR、DRI、出力 |
| N05 | Catalog/Product/Barcode/OCR/Chat URL/MCP/direct/Batchの一貫対応 | contract、統合、pgTAP |
| N06 | 過去snapshot/旧source/hash不変、訂正はvoid＋replace | upgrade fixture、pgTAP |
| N07 | 旧DRI/evidence/見直しと新12の指標・境界 | unit golden、SQL→API |
| G01 | 1800・25/20/55→112.5/40/247.5、fiber20→糖質参考227.5 | 純粋計算、RPC |
| G02 | 比率合計100、負数/過剰精度/0目標/有限性 | unit、API、pgTAP |
| G03 | 保存/変更/履歴/未来予定取消、有効開始前は目標なし | unit、SQL、UI |
| G04 | 体格参考の適用範囲/不足入力/fallback、split曜日/override | unit、統合 |
| P01 | 90/110包含、89.99/110.01、差分/達成率/構成比の分離 | unit、SQL同値 |
| P02 | 完了/未記録/空完了/不明/未同期/競合/目標なし | unit、API、E2E |
| P03 | 月日数、共通日集合の加重構成比、判定可能日数 | unit、RPC、E2E |
| P04 | 体づくりの参考提案、目標差を有害判定にしない | 文言fixture、UI |
| W01 | 月〜日、年越し/閏日/timezone/週移動 | unit |
| W02 | 日別goal合算、途中変更、training/rest、goal欠損 | unit、RPC |
| W03 | 未記録を0にしない、既知小計/全量/途中週の分離 | unit、UI |
| W04 | 参考量の条件/安全表示制約、proteinまとめ摂りなし | unit、文言、UI |
| K01 | 5起点の対象量、snapshot二重倍率なし、7/29 PNG | unit、統合、画像目視 |
| K02 | 微小正値→0なし、未知省略、欠損一覧、scope固定 | unit、画像目視 |
| K03 | iPhone保存/共有/コピー、キャンセル、手動確認/取消 | browser＋実機 |
| K04 | 基本7実OCR再確認、29全項目の成功/失敗を記録 | 外部アプリ実機のみ |
| B01 | 計測追加/編集/日付変更/削除/重複/任意体脂肪 | unit、pgTAP、E2E |
| B02 | 7日平均、30/90日、ペース、履歴0件 | unit、UI |
| B03 | profile連動/解除、旧outbox競合、最新削除/0件 | 並列統合、pgTAP |
| X01 | JSON v1構造、新v2の全履歴・由来、NULL/0 | contract、pgTAP |
| X02 | CSV3粒度/期間/全29/Unicode/quote/formula/欠損 | unit、統合 |
| X03 | owner/anon/Origin/機密除外/single snapshot/cascade | API、pgTAP、並列 |
| R01 | 食事、Product/OCR、Batch、Chat、栄養分析、睡眠/認証/PWA全回帰 | 全層 |
| R02 | outbox 1/2、fingerprint/receipt、更新途中/期限/削除guard | unit、pgTAP、E2E |

29項目について、「入力可・provider収録あり・分析可能・画像生成可・外部OCR成功」を別の列で受け入れ表に記録する。全29が入力可でも不明値を埋めたという意味ではない。

## 3. 重要な人工テストケース

### 栄養と旧データ

1. 旧18snapshotだけがある1食に12定義を追加。旧行の数・全既存列hashが同一で、新12の日次missing数が増えるだけでamount=0にならない。
2. 食品Aがvitamin C 0、BがNULL、Cは行なし。known entries=1、missing=2、小計0だが完全量NULL。
3. sodium1000mgのみ→新規で選択した算出salt2.54g、両者を保持してもsalt総量は2.54。salt既存値と不一致でも二重加算/上書きしない。
4. 食品C100gとfiberの分母が1袋、OFF net C、糖類、単糖当量は糖質差分計算に使わない。
5. Aのµg一般値/IUをRAEとして採用しない。folate DFEを汎用ugへ無根拠に写さない。Mg350のULを総食品Mgへ適用しない。
6. Batch材料2件のうち一方のselenium不明→一食selenium=NULL。他の既知codeは計算可能。estimated材料の由来をcomputedで洗い流さない。
7. 30code×90日2700行を切らず取得、応答欠落/重複keyをfail。month/weekly RPCは単一snapshotでgoalとfoodを取得。
8. OCRに葉酸/リン/糖類/コレステロールの行が挟まる、斜めtable、B1/B12、n3/n6、µg/mgを混ぜて行割当回帰。

### 目標・日次・月次・週間

1. P112.5の90%=101.25、110%=123.75は達成。101.23875（89.99%）/123.76125（110.01%）は外側。表示丸め後が同じでも判定を変えない。
2. kcal/比率を保存→読み直し→再保存を繰り返してもtarget gがずれない。除数9の循環小数でも交差乗算が一致する。
3. PFC合計99.99/100.01拒否、100.00受理。P0%の場合、既知0と不明を区別し%はNULL。
4. 初回目標が11/1開始なら10/31は目標なし。11/5の予定を11/6へ置換すると11/5に旧予定を残さない。過去版を編集しない。
5. 月曜に作った月曜開始intentを火曜同期。元の日付を保持し、後日同期表示。30日期限超過とrevision競合では自動適用しない。
6. 未記録、全skip・食品0、固定2枠だけ、追加食のみ、PだけNULL、同期pendingで個別/全体状態と日数を確認。
7. 日1がP10/F0/C0、日2がP0/F0/C90なら月間P10%/F0%/C90%。日別%平均の50/0/50にならない。Fだけ不明な日はPFC構成比の共通日集合から除く。
8. 2026/11/1は10/26〜11/1、11/2は11/2〜8。12月→1月、2/29、Asia/TokyoとDST zoneを固定時刻で検証。
9. 月〜水1800、木〜日2000なら週13400。途中初回設定で月火goalなしなら週完全目標NULL。
10. 週間目標12600、完了3日5500なら残り4日平均1775。closed dayに1件不明なら調整案保留。残量負、残り0、scale範囲外でも極端な摂取量を出さない。
11. protein週不足でも残りの日次目標は通常の値。記録不足を埋め合わせる摂取量を提案しない。
12. 目標kcal1800、PFC4/9/4合計1700でも記録energyを1700へ変更しない。DRI %Eと構成比が異なることを検証。

### Body・export・転送

1. 体重70/71kgがd−6/dにだけあるなら7日平均70.5、n=2/7。未記録5日を0として20.14等にしない。体脂肪NULLを体重と同じ分母で平均しない。
2. profile単一値だけではchart0点。本人確認した登録だけ1点。
3. latest_measurementの最新を編集/削除→profileとpointer更新。最後の削除→NULL。profile_onlyでは履歴CRUDでprofileを変更しない。
4. body保存と旧profile pendingを並列実行。古いexpected revisionを409、片側だけ成功させない。同日追加競合、削除IDへの再作成も拒否。
5. 食事全体のsnapshot合計、食品1行、Product100g→150g、Batch1食→全量の倍率を比較し、再乗算を検出。
6. PNG既知0/不明/微小正値、all29長さ、食事合計の一部未知、prepare後source改訂、share cancel、手動確認の冪等/競合を確認。
7. JSON v1/v2の同じlegacy値、snapshotとcurrent値の違い、全goal履歴/body削除/transfer状態を照合。private secret fixtureの文字列が漏れない。
8. CSV daily/meal/foodを再集計してJSON snapshotと一致。未記録/部分/0を検証し、日本語改行/カンマ/quote/=から始まる名前を含める。
9. export中の別接続書込みを人工fixtureで同期し、前後が混在しないことを確認。owner Bの行と機密fixtureはexport/transferへ出ない。
10. account delete cascadeは隔離した2 ownerのfixtureで実行し、対象ownerの全新table消去、他owner/定義維持を確認。実アカウントには行わない。

## 4. 自動検証の実行計画

| check | 実行/証明 |
|---|---|
| lint | pnpm lint |
| typecheck | pnpm typecheck |
| unit | pnpm test（新計算・adapter・状態と既存suite） |
| application integration | Vitestのroute/SSR/component harness、mockだけでなくisolated DB APIテストを追加 |
| production build | pnpm verify:env、pnpm build。ダミーlocal/CI値、秘密や実DBへ接続しない |
| fresh migration replay | **実装段階の使い捨てlocal/CIだけ** supabase start→db reset |
| upgrade replay | 旧18fixture＋既存migration→追加migration、旧snapshot/hash/grantsの比較 |
| pgTAP | supabase test db、既存全SQL＋新RLS/制約/RPC/並列契約 |
| Playwright E2E | Chromium/WebKit mobile/iPad、実Next＋isolated auth/DBの新フロー。既存合成Sleep検証も残す |
| docs/契約整合 | code集合30/標準29、APIとDeno/SQL、参照/出力の定義一致 |

CLIの実在コマンド/flagは実行時の--helpで確認する。DB replayはHosted/Productionを指すDATABASE_URLで実行しない。第1段階ではmigration検証を実行していない。追加指示後の実行結果は[09](09-implementation-status.md)を参照する。

失敗は原因を修正して必要な層を再実行する。合成ブラウザfixture、mock API、実認証・実DB E2E、実機OCRを同じ「E2E成功」へまとめない。結果にはSHA、環境、コマンド、件数、失敗/未実行、既知warningを付ける。

## 5. Preview・実機の受け入れ

Previewを変更できる実装フェーズに移った後、対象project/branch/headを再確認し、migration順とapp contractを合わせる。新機能の受け入れに必要な範囲以外の環境を触らない。

### Preview統合

- 29項目の全起点登録→snapshot→Today→月/週→DRI→exportを同一fixtureで追う。
- 過去18記録/History訂正、inactive Product、Batch、Chat direct/draft/linkを回帰。
- 同じownerの2端末、offline pending、失効/競合、再認証、version更新後のexactly-once表示を確認。
- 初回目標なし、途中変更、体格参考、split、Bodyとprofileの同時更新、削除/JSONを確認。
- Google Healthの接続・recent sync・backfill・stage/score/提案・Todayでの障害分離を回帰。新scopeを要求しない。
- exportのno-store/owner/完全性、単位・不明値、新tableを確認。唯一の実アカウントを破壊的テストに使わない。

### iPhone/iPad実機記録表

| 実機項目 | 記録する結果 |
|---|---|
| SafariとHome Screen PWA | 端末/OS/アプリ版、対象deployment SHA、縦横/文字拡大 |
| Today / 5タブ / 月calendar / Body | 初画面、tap/keyboard、横overflow、screen reader |
| offline・更新 | cold offline shell、online→offline→recovery、pending再開と重複なし |
| PNG | 7/29各pixel寸法、生成/保存/共有/clipboard、キャンセル/非対応fallback |
| カロミルbasic7 | 出力7値と認識7値・単位・対象量を一対一で照合 |
| カロミルall29 | 項目別に成功/誤認識/未認識/未試験。生成できただけを成功としない |
| 0/欠損 | 画像外の項目が外部で0になる挙動と、手動確認手順 |
| 二重登録 | basic7/all29、1食/全量、別画像で同じ食事を重複させない操作 |
| JSON/CSV | iPhoneのファイル保存/共有、日本語と欠損、再開後の状態 |
| Sleep | 既存実同期・score/詳細/期間、既存sleep-readonly |

実データの値を公開PR/画像artifactへ貼らず、受け入れ表は人工メニューまたは安全に最小化した結果だけを共有する。29の全OCR成功が得られない場合も、項目別の実測限界を正確に報告し、基本7へfallbackする。ユーザーが外部OCRの限界を受け入れる前に「29完全対応」と宣言しない。

## 6. リリースと承認ゲート

1. 各PRに問題/新挙動、DB/互換性、検証、未確認、rollback先を記載。
2. 全実装headで自動check、fresh/upgrade DB、pgTAP、認証済みE2Eを揃える。
3. Previewの同じheadで統合/実機、OCR項目表、データ整合・runtime error scanを揃える。
4. 本番migration/appの対応、退避bridge、backup/restore条件、outbox互換、現時点のProduction SHAを具体化。
5. **このアップデートについて新たな明示的Production承認**を得る。設計承認・過去GO・Preview許可では代替しない。
6. 承認後だけProduction migration、main merge、Production deployを承認範囲・依存順で行う。
7. app-version/SHA、deployment READY、移行履歴、ログ、owner機能の非破壊smoke、profile/export/Sleepを確認し記録する。

第1段階では1〜7を実行していない。追加承認後は実装branch/PRで自動検証とPreview反映を実施しており、Production操作は未承認のままである。現行workflowはPRでPreviewを起動し、Production workflowはpreview GitHub environmentにあるtokenを使用する。環境名だけで承認・接続分離が保証されると判断しない。将来の権限改善は機能変更と分けて提案する。

## 7. 主要リスクと対策

| risk | 影響 | 対策/残る制約 |
|---|---|---|
| 定義追加で旧fingerprintが変わる | 正当なpendingが大量競合、再送で重複 | M1を先行、旧18hash固定、receipt先行照合、旧intent非変換 |
| 旧全置換が新codeを消す | 現在食品の栄養損失 | 旧18だけの変更、basis変更は明示upgrade |
| OFF総C/net C差 | PFC/糖質/PNG誤表示 | 新取り込みの定義照合、旧不確実性表示、過去値は自動修正しない |
| 形態/scopeの混同 | A/E/葉酸/Mg等の誤判定 | definition_basis/scope、comparable制約、基準なしは保留 |
| 既知小計0の誤用 | 不明/未記録を0摂取扱い | countと状態必須、共通resolver、PNG/CSV/achievementsでNULL保持 |
| 目標履歴の遡及 | 過去を現targetで評価 | append-only、有効日、未設定期間、遅延同期開示 |
| 週の不足を食事制限へ変換 | 極端な提案 | 条件付き参考、scale制限、protein再配分なし |
| profileとbodyの二重正本 | 古いpendingで最新値喪失 | mode/pointer、全write経路更新、複数revisionと原子transaction |
| 29 PNGの長さ/OCR | 誤認識・欠損0・二重登録 | 基本7既定、1枚、実機項目別記録、手動確認 |
| Hosted履歴/ACLの差 | migration二重適用/予想外権限 | preflightで実DDL照合、無断repairしない |
| 行上限/複数snapshot | 月/週/exportが欠ける/混在 | 単一JSONB period RPC、全件検査、snapshot export |
| rollback先が古すぎる | 新table/outbox/新code損失 | 互換bridgeへ戻す、schemaを縮小しない |
| 自動Preview/Production経路 | PR/mergeだけで環境変更 | 実装branchのPreviewだけ承認済み。main merge/Productionは新たな承認まで禁止 |
| timezone runtimeの差 | 週境界ずれ | civil-date計算・IANA検証、DB/JS一致fixture |

Supabaseは2026-10-30に一部zoneのtzdata修正を公表している。今回確認したservice 17.6.1.166から、Asia/Tokyo以外の全zoneが正しいとは推測しない。[公式changelog](https://supabase.com/changelog/tzdata-local-time-vancouver-edmonton-casablanca)。対象zoneの検証と必要な運用判断は移行前flightへ記録し、今回アップグレードは行わない。

## 8. 設計レビューと反映結果

実装者による独立した観点別セルフレビューを実施した。外部レビュー依頼、第三者承認、栄養専門職の査読を実施したとは報告しない。ユーザー確認後の実装PRでは通常のコード/DBレビューを別途行う。

| review | 指摘 | 文書へ反映した解決 |
|---|---|---|
| DR01 履歴保全 | 定義追加だけでも参照hashが変わる | P1/M1先行、旧18固定、新v3/contract2、rollback bridge |
| DR02 旧編集 | legacy full replacementが追加値を消す | 旧18限定、basis変更の409、新metadataの誤流用防止 |
| DR03 栄養定義 | 糖質≠糖類、OFF net C≠JP総C、A µg≠RAE | 新code名・definition_basis、取り込み保留、snapshot非修正 |
| DR04 評価軸 | PFC構成比とDRI %Eの分母が異なる | 2つの式・ラベルを分離、日集合も定義 |
| DR05 週次欠損 | 未記録と未来を0扱いすると残量が過大 | closed/known/fullを分離、参考量の停止条件 |
| DR06 体重整合 | 最新削除、旧profile outbox、同時保存 | mode/pointer、NULLへの明示遷移、revision/lock順、tombstone |
| DR07 転送履歴 | source変更後に何を転送したか不明 | prepare時の固定payload、手動confirmed、現在hash差 |
| DR08 日付 | 翌日replayで開始日を勝手にずらす恐れ | intent local dateで検証、recorded_at分離、遅延同期表示 |
| DR09 精度 | gを都度丸める/画像で微量が0になる | bps/有理比較、保存値の集計、正値はPNGで0にしない |
| DR10 運用 | PR許可だけではPreview禁止を守れない | 今回local-only、次段階の環境操作ゲート明記 |
| DR11 基準 | Mg/葉酸ULをtotal/supplementの粗い分類に適用 | exact scope不明ならreference-only、旧A/E/B6保留維持 |
| DR12 証拠 | CI成功/READY/実機/OCR成功の混同 | 確認層別の結果表、main baselineと新機能検証を分離 |
| DR13 出力 | DRIの基準なし/比較保留で既知量まで隠す恐れ | 出力定義一致とDRI comparableを別属性にする |
| DR14 削除と精度 | profile FK/目標計算入力、微量の丸め0 | deferred owner FK、削除範囲の説明、underflowを明示0にしない |

残る設計上の選択は採用案として確定した: 1日1体重記録、通常目標の過去日指定なし、5タブ、29画像の自動分割なし、参考調整scaleの表示制限±10%。いずれも実装前にユーザーが変更できる。未解決の重大な設計矛盾を「実装中に考える」として先送りしない。

### 実装前に再確認する外部条件

Hosted migration履歴/ACLの差の由来、実行時点のprovider schema、iOS/カロミル現行版のOCR認識範囲、Productionの実際の承認/自動デプロイ設定。これらは設計文書だけでは検証完了できない条件として、P0/P9のゲートへ残す。

## 9. 今回の完了判定

現状監査、29項目と計算仕様、DB/API/migration、UI構成、転送/export/Body、依存順、受け入れ、リスク、セルフレビュー、次回指示をdocsに作成した。文書参照・コード数・数式例・変更範囲の検査結果をこの文書へ追記して引き渡す。

第1段階の文書検証結果（2026-11-01）:

- 9文書のUTF-8、33件のローカルリンク、34表の列数、Mermaid fenceの対応を検査し、エラー0。
- 標準29/内部30、既存18codeとunitの完全保持、追加12、内部sodiumだけという定義表を現行catalog.tsと照合して成功。
- 31件の受け入れIDと14件のレビューIDの重複/件数検査に成功。
- Fractionによる設計例の再計算に成功（初期PFC/糖質、90/110境界、月間の加重比、週境界/途中目標変更/残量、Na換算、体重平均）。
- 最終確認でもremote mainは7b2bcea。mainのアプリ実装を変更していない。

この第1段階完了時点では機能実装・新機能のテスト成功・Preview受け入れ・実iPhone確認・カロミルOCR再確認は全て未実施だった。その後、ユーザーが実装開始を承認している。現在の結果と残る制約は09/10を正本とし、この旧停止条件から作業を巻き戻さない。
