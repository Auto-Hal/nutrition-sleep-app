# 段階的実装・検証記録

2026-11-02追記: 所有者の追加の本番反映承認後、PR #47をmainへマージし、総合更新のDB/app/EdgeをProductionへ反映した。[13のリリース記録](13-production-release-2026-11-02.md)が最新の運用状態であり、以下の禁止・未反映表記は各段階の履歴である。実機・外部接続の未確認は継続する。

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
| P8 CSV・入力/品質・UI整理 | 実装・自動検証完了 | CSV/入力/品質/完全読取り/未同期PFCまで接続。748 Vitest、650 pgTAP、実接続競合・アプリ検査成功。実機は別 |
| P9 統合・受け入れ | 自動統合完了・Hosted認証後/実機待ち | 7b00814 / CI 41326997177で3ブラウザーの実Auth/Next/API/DB、mainからのupgrade replay成功。Hosted構造/公開/匿名拒否/digest確認済み |

新機能の実機・外部OCRは未検証。実装・自動検証の完了と、Hosted認証後/物理端末の受け入れを区別する。最終headのチェックは[PR #47](https://github.com/Auto-Hal/nutrition-sleep-app/pull/47/checks)で確認できる。

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
| 20261101142455_complete_catalog_library_read.sql | 20261101143541 / complete_catalog_library_read | e550993 CI 41316574675：25 files/650 pgTAP/実接続・732 Vitest・全検査成功後apply。3種digest前後一致 |

P1適用後security advisorは既存private server-only表のpolicyなしINFO、意図したowner検証付き公開SECURITY DEFINER RPC、既存のleaked password protection設定を報告。追加したprivate helperはauthenticated/anon実行不可。Productionは変更なし。

P2の新規DB書込はv3/contract_version=2に分離する。v1 outboxと18項目fingerprintは継続する。OFFのcarbohydrates-totalのみ総炭水化物候補に使用し、carbohydrates/sugarsを日本の糖質へ無条件変換しない。定義の参照元: [OFF公式nutrient taxonomy](https://github.com/openfoodfacts/openfoodfacts-server/blob/main/taxonomies/nutrients.txt)。

MCP Edge FunctionはPreviewだけversion 3へ反映。Deno 2.5.6型検査成功、resource metadata GET 200、未認証MCP 401＋WWW-Authenticateを確認。SDK 1.25.3ではtop-level securitySchemesが型定義外のため、[公式仕様の互換メタデータ](https://developers.openai.com/plugins/reference)へ宣言を移した。実ChatGPTからのOAuth接続・確定操作は実機受け入れに残る。ProductionのEdge Functionは変更なし。

P2 security advisorの追加10件は意図したowner検証付き公開write/reference RPCのSECURITY DEFINER警告。private coreの直接実行は取り消し、匿名実行不可をSQLテストで確認。新しいRLS欠落の警告はない。

P3は目標履歴・適用日・split/日別区分・将来予定の置換/取消、Settingsの食事目標、JSON v2を追加。正式履歴前の参考比較とPFC画面はP5以降。将来予定の取消/置換はintent日と実際の保存日の両方で未来のものに限定し、遅延した取消が既に適用済みの過去を消さないようにした。新setの遅延同期は元のintent日を維持する。

実接続テストの初回は補助SQLの予約語aliasで停止したため修正し、再実行成功。Hostedではなくloopback:54322の使い捨てCI DBだけを許可する実行ガードを設けた。認証済み別接続の同時初回保存は1成功/1 revision_conflict、同じoperationの再送は元receiptを回復する。

P4ではBodyの3テーブル、実測のみのCRUD、明示的なプロフィール連携、削除ID管理、v2 export、認証API/outboxを実装。旧プロフィールRPCとの共通ロック順序を維持するため、直接table DMLを取り消す設計補足を04へ追記。JSのBody単体/APIテストは通過。fresh replay/pgTAP/実接続の競合テストをCIで検証してからPreviewへ適用する。

P7のtransfer payloadはsource amount×選択量の分子/分母を文字列で保存し、量換算の循環小数を画像用の有限表示へ丸めても正本へ逆流させない。画像は端末メモリのみでStorage/outbox/SWへ保存しない。手動確認/取り消しだけをIDs/revisionのoutboxで復旧可能にする。Web Shareは事前生成後の別tap、キャンセルはprepared維持（[MDN](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share)、[WebKit](https://webkit.org/blog/13862/the-user-activation-api/)）。新goal参照計算のmeasurement IDが実際のprofile pointerと一致することもM5で検証する。

## P8/P9の統合確認結果

- 完了: 29項目CSV（日/食事/食品、366日、BOM/CRLF/formula escaping、単一DB snapshot）と出力UI。
- 完了: Productの写真なし手動登録・既存値編集、明示的なNa→salt/定義一致C−fiberの算出と由来維持。
- 完了: definition_basis/derivation/source URIの新書込allowlist、単位・化学形態の不一致を新PFC/transferで共通判定。旧DRI互換を維持。
- 完了: Catalog/Product/Meal読取りのページ上限・欠落検出、29項目geometry OCR回帰。
- 完了: PFCのqueue直後の状態更新と端末暫定PFC。確定不明のpending追加分をサーバー合計へ重複加算しない。
- ブラウザー確認済み: Todayの入力導線・重複エネルギーカードの整理、iPhone/iPad幅のoverflow検査と画面画像の目視。物理端末は別。
- 自動統合成功: 使い捨てAuth/DBから実Next/API/ブラウザーまでのPlaywright、オフライン入力/復旧、PNGファイル生成、Body CRUD、CSV/JSON。Hosted Previewは構造/公開/匿名拒否/digest確認の範囲。操作案内・本番計画は10。
- 物理iPhone、iOS共有・写真保存、カロミル基本7/全29 OCR、実ChatGPT OAuth/確定は未検証。自動テスト合格と区別する。

## P8 追加の品質契約

30コードごとの単位・比較できる化学形態を共通JSONで定義し、TS/SQL/MCPの一致をテストする。新規書込みは不明な定義・認証情報付き出典URL・自由形式の計算根拠を拒否する。既存の保存行や旧18 APIの契約を一括変更しない。新PFC/CSV/画像/Batchでは明示的な非互換値と曖昧なOFFのA/E/Cを判定保留にする。

Na→saltは2.54/1000、C−fiberは同じ資料・同じ基準量と定義を明示確認した場合だけの操作とし、既知の転送先値を上書きしない。入力元に推定があれば計算結果にも推定情報を維持する。正の値がnumeric(18,6)で0へ丸められる新しい食品・食事・Batch計算はNULLとbelow_storage_precision理由を保存する。過去の0から値を推測して復元しない。

この単位のローカル検証は731 Vitest、lint（既存img警告1件のみ）、typecheck、Deno check成功。fresh replay/pgTAPとPreview適用はCI確認後に行う。

初回CI 41303982463のアプリ検査は成功。DB検査で新しいhelperの変数名と列名の衝突を検出し、変数名を修正した。旧SQLの文字列を探すテスト1件は、新しい換算helperがNULLを維持する実値検証へ変更した。この初回時点ではPreview未適用で、修正後の適用は次項のとおり。

修正後0ac4cb7で全検査が通過し、上記のPreview台帳へ反映済み。MCPはPreviewだけv4 ACTIVE（b7f5a1e3187bcba25de71c250fb3d70f67cc2c2767a33eb287e206dcb28698d8）。再デプロイの初回は既存の一時import mapパスを参照して失敗したため、今回のdeno.jsonを明示指定して成功した。Productionは未変更。security advisorは既存のprivate表INFO・意図したowner検証付き公開write RPC・既存パスワード設定の3分類で、新しいRLS欠落はない。

## 食品一覧の完全取得

Catalog/Batch/Product解決/Todayの入力候補は、STABLE/invokerの単一JSON RPCへ統合する。30項目×食品数がPostgRESTの1000行上限に達しても切り詰めず、revision・参照fingerprint・栄養の由来・Batch構成を同じsnapshotで返す。件数不一致や重複を検出した応答は編集へ渡さない。SQLで45食品/1350栄養行、0/NULL、owner isolationを確認する。旧「energyだけ先読み」の構造テストはPFC先読みに置き換わるため削除し、全件契約の実値テストを追加した。

## 手動入力・OCRの統合

Productは有効な実物バーコードを入力して「写真なしで入力・編集」から登録/編集できる。Catalog一覧の編集からも同じ経路へ進める。バーコードのない料理は従来のCatalogで管理し、架空の番号を作らない。手動値はユーザー申告が初期値で、変更しないunknown/化学形態/由来/計算根拠を維持する。基準量変更と確認済みProductの置換には、その内容の明示確認を求める。

Catalog/ProductへNa→saltと条件付きC−fiberの明示操作を接続した。計算後の元値・出典の変更では保存を止め、再計算を求める。現物ラベル・共通URL・同じ基準量の確認なしに糖質を埋めない。

表OCRの新29項目合成テストで、従来の曖昧単位判定がugをmgへ誤認する問題を発見し完全一致を先行させた。RAE/DFE/IUの明記を位置情報から保持し、generic A、DFE、IUをRAE/質量へ変換しない。英語Carbohydrateだけでは食物繊維を含むか不明なため、総炭水化物はTotal Carbohydrateの明記を要する。既存の保存値・旧API・過去snapshotは変更しない。物理ラベル撮影の認識率は別途実機確認が必要。

797219b CI 41317556985で全アプリ検査・fresh replay/650 pgTAP/実接続成功、PreviewとSleep E2Eも成功。

## Todayと未同期PFC

queue直後とdrain要求の両方で期間の同期状態を再確認する。オフラインでserver取得に失敗してもIndexedDBの追加記録は表示し、正式判定は保留する。端末の追加記録は、参照fingerprintが一致する食品だけを元に既知PFCを計算し、サーバー既知量とは独立した参考小計にする。応答未確認の操作が既にDBへ保存されている場合でも二重加算しない。旧Todayエネルギーの加算表示も同じ理由で分離し、「記録・同期の詳細」へ折り畳む。日々の入力へ直行する「食事を記録」を上部へ配置する。

ローカル742 Vitest（queue/オフライン/不明/古い食品参照/返答消失の回帰を追加）・lint成功。最終CIと認証済みブラウザで統合確認する。

## P9 実アプリの使い捨て統合環境

新しいPlaywright suiteは実Supabase Authで作成した合成ユーザーだけを使い、loopback API:54321/DB:54322以外ではfixture作成前に停止する。実Nextサーバーへ本人用allowed IDを渡し、サービスキーはブラウザにもアプリにも渡さない。テスト終了時は合成Authユーザーを削除し、新しい履歴テーブルのcascadeを確認する。既存Sleepの公開/合成E2Eとは別に、ログイン、目標、写真なしProduct全30、旧HTTP更新の12項目保護、オフライン食事、PFC、実Canvas PNG/保存、Body CRUD/連携、CSV/JSON、睡眠画面をChromium/iPhone WebKit/iPad WebKitで通す。結果は未確定で、CIの最初の失敗箇所から修正する。

初回840c28c/CI 41318831948はアプリ検査・650 pgTAP・実接続まで成功し、ブラウザのログイン段階で401を検出。Authそのもののfixture検証を追加し、ログインフォームをhydration完了まで無効にして、初期HTMLからのnative GET送信もPOST指定で防止した。次のCIで原因を絞って再検証する。Supabase CLIは検証時の2.122.0へ固定する。mainの18項目DBへ合成fixtureを入れてから追加migrationだけを適用し、旧18snapshot/fingerprint/receiptと履歴未作成を照合するupgrade runnerも追加する。

PreviewのMCPは正規の/mcpで未認証401を確認したが、内部HTTP gatewayのURLをOAuth metadataへ使う問題を発見した。公開SUPABASE_URLを基準に修正し、request hostを信用しないURL構築とloopback以外のHTTP拒否を単体/Deno検査する。実ChatGPT OAuth成功とは区別する。

2a867ae CI 41319767273のアプリ検査（744 Vitest/lint/typecheck/Deno/build）・650 pgTAP・同時更新は成功。ブラウザ開始前の新preflightでemail_provider_disabledを特定した。ローカルconfigの[auth.email].enable_signup=falseがメールproviderを無効化していたため、[auth].enable_signup=false（一般登録禁止）と[auth.email].enable_signup=true（既存ユーザーのメールログイン有効）を分け、一般signupが拒否されることもpreflightへ加えた。Hostedへconfig pushは実行しない。根拠: [公式CLI設定](https://supabase.com/docs/guides/local-development/cli/config)、[Supabase CLI issue #7055](https://github.com/supabase/cli/issues/7055)。

MCP修正はPreviewだけv5 ACTIVE（df868eda2bc7d06e3e0b7d4b69086699e1681c6be797f6e379081a5fb8b8ba15）へ反映。公開metadata 200、resource HTTPS、/mcp未認証401とHTTPSのWWW-Authenticateを確認した。実ChatGPT OAuthの未確認は残る。

## 設計・実装のセルフレビュー

第三者や栄養専門職による臨床承認を実施したという意味ではない。観点別に読み直し、次を修正・検証した。

| 観点 | 指摘と対応 | 証拠 |
|---|---|---|
| 旧クライアント互換 | 全置換で12項目が消える危険、旧fingerprint/receiptの変化 | M1 bridge、旧18契約SQL回帰、upgrade runner |
| 数値と単位 | 微量正値が0へ丸まる、ugとmgの曖昧OCR一致 | M7 NULL/reason、29行位置OCR、単位完全一致優先 |
| 化学形態・由来 | DFE/IU/ALA単独/曖昧OFF C/A/Eの混同、推定情報の消失 | code別JSON契約、API/SQL/MCP検証、Batch/計算の由来伝播 |
| 読取り完全性 | 1000行上限・別HTTP時点の混在 | library/period/CSV単一snapshot、件数/重複検出、1350/2700行回帰 |
| 正式判定と途中経過 | 未記録0、未同期の重複加算、過去目標の誤表示 | 独立known/recorded、端末小計分離、参考比較opt-in、exact演算 |
| 同時更新と履歴 | 旧profileとBodyのlost update/lock逆転 | 共通lock順、2実接続で1成功/1 conflict、receipt回復 |
| セキュリティと運用 | private helper公開、RLS/削除/出力漏れ、環境混在 | revoke/RLS/owner/lifecycle tests、advisor、Preview前後digest、Production読取り監査 |
| 外部連携の証拠 | share成功を登録完了と表示、内部HTTPがOAuth公開URLへ流出 | 手動確認のみ、status回帰、MCP v5実HTTP確認 |

DRI評価には従来からの成人・プロフィール条件と、新しい形態/摂取源の制限がある。特に葉酸EAR/RDAと、通常食品以外だけを対象とするMg/葉酸ULは現在の集計では参考表示に限定する。形態や対象摂取源を確認できない総量へ基準を当てない。これは個人PFC目標の達成判定とは別である。

15aebae CI 41320480365では一般signup拒否・既存Authログイン、目標保存、写真なしProduct30コード、旧HTTP APIで12項目保持まで実ブラウザで通過。オフラインへ切り替えると旧ConnectivityBoundaryが入力画面全体をunmountするため、記録を続けられない問題を検出した。読み込み済み画面はメモリ内に保持し、取得済みの既知分・最新確認不可のbannerを表示する修正を加えた。PFCはofflineイベント直後に正式判定を保留し、未送信小計を別表示する。cold startの静的offline shellと、認証ページ/APIをcacheしない方針は維持する。

1f8f99c CI 41321634231のChromiumでは上記に加え、オフライン入力/復帰でDB1件、PFC完了、29 PNGの実ファイル保存、月/週/詳細、Body編集/連携/削除、全CSV/JSON、Sleep画面まで通過。最終console検査で軽量queuedイベントにpayloadがないことを旧MealLog listenerが想定せず例外を出す問題を検出し、guardと回帰を追加した。全WebKitはこの修正後に実行する。SWを実登録してoffline再読み込み→静的shell→同じoutboxから復帰する検査と、過去日の参考比較で達成日数が変わらないUI検査も追加する。

SW検査ではテスト側がアプリとは別versionのworkerを同scopeへ登録していたため、競合の可能性を除いてアプリ自身のactivated workerとoffline.html cacheを確認するよう変更した。続く7801c26のCIでは、offline指定でもworkerがオンラインの画面を返すことを検出した。Playwright 1.55の[実装](https://github.com/microsoft/playwright/blob/v1.55.0/packages/playwright-core/src/server/chromium/crServiceWorker.ts)ではPW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTSがないとworker側のoffline設定を行わない。実際のsw.js/offline.htmlを使ったloopback再現で、設定なしではOnline page、設定ありでは「オフラインです」が返ることを確認し、使い捨てrunnerの環境変数へ設定した。

SW navigationの自動受け入れはChromium、WebKitは開いている画面からのオフライン入力/復帰を検証する。[PlaywrightのSW対応範囲](https://playwright.dev/docs/service-workers)と[WebKit offline navigationの既知不具合](https://github.com/microsoft/playwright/issues/42775)があるため、Safari/PWAのcold startは実機未確認として残す。

e4c7ca4 / CI 41324573230ではChromiumの全フローが成功。実workerによるoffline shell再読み込み、端末pendingの保持・復帰後1件だけ保存、過去日の参考比較で正式日数不変、PNG/Body/CSV/JSON/Sleepまで通過した。続くWebKitでは共有した合成ownerの保存済み目標1800.000と初期値1800の文字列表記差をテストが拒否したため、末尾の0だけを許容する数値表記の比較へ修正した。全プロジェクト成功までは統合検証完了にしない。

Hosted Preview再確認（2026-11-02）: e4c7ca4のdeployment READY、login 200/no-store、app-versionのSHA一致を確認。app-versionのoutbox_contract_version=1は従来操作の既定値であり、新規操作は明示的なcontract 2を使い、対応集合は1/2である。Vercel接続ツールがアプリ401もprotection失敗と表示するため、同接続の一時共有リンク/cookieで再確認し、栄養period/Catalog/Body/転送の4 APIがアプリJSONのUnauthorized/401を返すことを照合した。保護設定は変更していない。Vercel環境変数はPreview/Productionのtarget/IDが分離していることをmetadataで確認し、値を出力・変更していない。

Previewは内部30、台帳32（既存24＋M1〜M8）、新8表がowner SELECT policy付きRLS/直接DML不可、主要read RPCはSTABLE/invoker/匿名EXECUTE不可、private helper公開0。食品5・栄養21・snapshot322と既存3種digestは継続一致。goal/body/transferは各0で実アカウントへ合成fixtureを投入していない。advisorはprivate server-only表6 INFO、owner検証を要する意図した公開SECURITY DEFINER RPC49 WARN、従来の漏洩パスワード保護1 WARNで、新しいRLS欠落はない。対応背景: [private表policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)、[公開definer関数](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)、[パスワード保護](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)。

Production再監査ではmain/公開aliasのSHAは7b2bcea、deployment dpl_6wWY3x49CEv6s4CotFjdXdAsiD3Z READY、内部18・台帳28、新goal/body/transfer/libraryなしを確認。変更操作は行っていない。接続済みブラウザーでHosted認証後のread-only画面も確認しようとしたが、Computer Useは初期化時のkernel assets pathエラーがreset後も続いた。Hostedのログイン後操作は未確認として残し、使い捨てAuth/DBの実ブラウザー成功と区別する。

04a9fc1 / CI 41325213207でもChromium全フローが成功。WebKitはProductのバーコード入力がhydration前に可能で、React初期化により空欄へ戻り、無効な番号と判定される問題を検出した。Productの初期番号・種類・検索/手動/カメラ操作をhydration完了まで無効化する。テストを待ち時間だけで回避せず、実際の早い入力も保護する。ローカルProduct関連23テストとlintを確認後、全E2Eを再実行する。

0a0cee3 / CI 41325948098ではChromium成功、WebKit mobileも機能操作は最後まで成功したが、最後のpageerror検査が中断されたsame-origin period/SW通信を検出した。最小loopbackサーバーで、画面置換中のcatch済みfetchがWebKit pageerrorを出す一方、window error/unhandledrejectionは0であることを再現。[Playwright #43120](https://github.com/microsoft/playwright/issues/43120)の上流報告とも一致する。E2Eは各documentの実JS例外/未処理Promiseを独立監視し、開発用同一originのperiod/SWという狭いnative診断だけを別artifactへ記録する。最後にブラウザーの同一origin period取得200とworker更新成功も必須にし、実障害を一律除外しない。

PwaRuntimeのonline/visibility時updateにも失敗catchとoffline抑止を追加し、中断後の再試行を実コールバックの単体テストで確認した。転送フォームも初期化前にモード/量/名称を変更できないようにし、E2Eではall29 payload/全29行の既知状態を明示照合する。関連13テスト成功、全suite/3ブラウザー/upgradeを再実行する。

## 自動受け入れの確定結果

機能の通し検証は **7b00814c92065980fe2d5a17a1ca283a426daeb7** で成功。[CI 41326997177](https://github.com/Auto-Hal/nutrition-sleep-app/actions/runs/41326997177)と[Sleep E2E 41326997135](https://github.com/Auto-Hal/nutrition-sleep-app/actions/runs/41326997135)に証拠がある。後続の表示・文書調整もPR最新headの同じ検査対象とする。

| 検査 | 確定結果 |
|---|---|
| lint | エラー0。従来のProduct画像に関するimg警告1件 |
| TypeScript / MCP Deno | 成功 |
| Vitest | 88ファイル・748件成功 |
| 環境契約 / production build | 成功 |
| fresh Supabase migration replay | 使い捨てDBで成功 |
| pgTAP | 25ファイル・650件成功 |
| 実認証・同時更新 | 目標の競合/receipt回復、owner別export、Bodyと旧profileの同時保存が成功 |
| 新Playwright | Chromium、iPhone 13幅WebKit、iPad Mini幅WebKitの3プロジェクト成功 |
| main相当DBからの更新 | 旧18snapshotの全旧列/行数、参照fingerprint、旧receiptが不変。定義30、新しい架空履歴0を確認 |
| 既存Sleep E2E | 既存の公開認証画面・合成睡眠画面を3ブラウザーで継続成功 |

新E2Eは、ログイン、目標保存、全30コードのProduct、旧HTTP編集による12項目保護、オフライン食事→DB1件、PFC完了、全29の固定payload/実Canvas PNG保存、名称コピーと手動確認状態、月/週/29詳細、過去日の参考比較、Body CRUD/プロフィール連動、CSV3粒度/JSON v1・v2、Sleep、Origin拒否まで実行する。ブラウザーwindow error/未処理Promiseは0。前項のWebKit native中断診断は別artifactへ残し、最後のperiod 200/worker更新成功を必須にした。

合成ユーザーは終了時に削除し、新goal/body/transfer履歴のcascadeを照合する。Hosted実アカウントへこのfixtureを投入していない。人工値がブラウザー間で合算されるのは同じ合成ownerを順に使うテスト仕様で、実ユーザー値ではない。

自動生成されたToday/月間/Body/転送/29 PNGをiPhone・iPad幅で目視した。最終表示調整では月選択欄が見出しを圧迫しない折返しを加え、入力フォームの表示単位をµg/µg RAEへ揃える。保存code/unitは変更しない。実iOSの保存/共有やカロミルOCR成功をこの目視から推定しない。

現在残る受け入れは、Hosted Previewの認証後操作、物理Safari/PWA、iOS保存/共有、基本7再OCR/全29認識、実ChatGPT/Google Health接続である。詳細とProduction承認後の手順は[10](10-preview-acceptance-and-production-plan.md)、全経路の実装範囲は[12](12-feature-coverage-and-verification.md)を参照する。今回のProduction反映は未承認・未実施。

## 最終表示と環境接続先の照合

311c38d / [CI 41370211612](https://github.com/Auto-Hal/nutrition-sleep-app/actions/runs/41370211612)でも748 Vitest、650 pgTAP、認証付き3ブラウザー、fresh/upgrade、同時更新が全て成功。[Sleep E2E 41370211582](https://github.com/Auto-Hal/nutrition-sleep-app/actions/runs/41370211582)は36件成功。[Preview 41370211560](https://github.com/Auto-Hal/nutrition-sleep-app/actions/runs/41370211560)も成功し、dpl_Bvoo1sSzXYXhjg99i3pfAi3i28gX / nutrition-sleep-mm4hhhus4-tsuno2.vercel.appでversionの完全SHA一致、公開login、主要4 APIのアプリ401、SW no-storeを確認した。実データの3種digestとProductionの従来版も維持されている。

最後の照合で、Vercelのsensitive設定はAPIから値を取得できず、targetのmetadataだけでは実際のURL/DB参照先を証明できないことを確認した。このため`scripts/verify-hosted-target.mjs`を追加し、Vercelのリモートビルド環境内でSupabase URLとDB URIが同じ専用projectを指すことを照合する。値・資格情報を出力せず、検査自体はネットワーク接続も行わない。`vercel.json`で`vercel-build`を明示し、workflow経由・自動Gitデプロイの両方の入口で同じ照合を必須にする。Productionは将来承認されたbuildで自身の専用projectを照合するだけで、今回Productionへ接続・変更する処理ではない。

許容するDB URIは[Supabase公式のdirect/shared/dedicated pooler形式](https://supabase.com/docs/guides/database/connecting-to-postgres)からprojectを特定できるもの。URLのqueryによるhost/user等の上書きや、projectを特定できない接続先は停止する。ローカル開発・使い捨てCI DBはこのHosted用照合から分離する。17件の追加回帰で正しい直接/プール接続、Preview/Productionの取り違え、URL上書き、秘密の非出力を確認した。全体は89ファイル・765件となり、最終headの全チェックはPRへ記録する。

追加照合の初回b99d812 / Preview 41371903611は、先頭の旧GitHub Preview secret参照が空で停止した。値を出力せずに設定の有無だけを照合し、実際のデプロイがVercel pullの設定を使うことと区別した。使用されないsecretで実行していた重複`pnpm build`を除き、専用Vercel project選択→Preview設定pull→接続先照合→Vercel build→Preview deployの一つの流れへ整理した。新しいsecretの複製・環境設定の変更は行わない。

続くa2b66d2 / Preview 41372126551ではpull後の照合も停止した。一方、b99d812の自動Git build（dpl_5SdWmFugTreEogVxgCdALB9eMku4）はREADYで、実ビルドログに`Dedicated Supabase URL and database project verified for preview.`を確認した。[Secret/sensitive値は保存後は読取り不可で、deployment内で使用するという公式仕様](https://vercel.com/docs/environment-variables/sensitive-environment-variables)に合わせ、Preview workflowもソースからのリモートビルドへ統一する。CIでsecretを取得・複製しない。checkoutと公開metadataはPR headのSHAへ固定し、`--target=preview`だけを使う。pull後にローカルprebuiltを作る中間案は最終手順ではない。

c51bba0 / [CI 41372632983](https://github.com/Auto-Hal/nutrition-sleep-app/actions/runs/41372632983)で89ファイル/765 Vitest、650 pgTAP、実認証3ブラウザー、fresh/upgrade、同時更新が全成功。[Preview 41372633192](https://github.com/Auto-Hal/nutrition-sleep-app/actions/runs/41372633192)も成功。リモートbuildログで実設定のPreview URL/DB project一致を確認し、同じSHAのdpl_Eh5krdL3o5xMD3g7o7kg4n2LGs7zがREADYになった。

本番の既存prebuilt手順も同じSecret制約とbuild guardの影響を受けるため、将来の承認後用workflowをリモートビルド方式へ揃えた。`workflow_dispatch`だけという手動開始と既存tokenのenvironmentは維持し、mainからの実行だけに制限する。Production workflowの実行、main merge、Production DB/app/Edge変更は行っていない。承認後の実環境でのProduction実行結果を自動テストから推定しない。
