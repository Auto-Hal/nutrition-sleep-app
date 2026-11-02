# 個人目標・PFC・月間・週間・体重の計算仕様

設計版1 / 2026-11-01。数値例は全て人工例。医学的な最適値やカロミル内部アルゴリズムの再現を主張しない。

## 1. 初期プリセットと保存条件

初回フォームはcustomモード。下記を未保存のプリセットとして提示し、本人の「この目標を使う」で当日以降を開始日として保存する。DB migrationで既存ユーザー全員へ目標を挿入しない。保存前のTodayは「目標未設定」と表示でき、プリセットを当時の履歴として扱わない。

| 項目 | 初期値 |
|---|---|
| energy | 1800 kcal |
| P / F / C | 25% / 20% / 55% |
| P / F / C g | 112.5 / 40.0 / 247.5 g |
| fiber | 20.0 g（下限目標） |
| 糖質参考 | 227.5 g |
| salt_equivalent | 7.50 g（個人設定の上限・包含） |
| PFC許容範囲 | 各目標の±10%（境界を含む） |
| energy許容範囲 | 初期±10%。カロリー達成日数の定義として別フィールドで保持 |

これはユーザー指定の開始値。P25%とDRIのprotein %E DGは異なる基準であり、どちらかで他方を上書きしない。個人salt上限7.50以下とDRI男性7.5未満も別の境界である。

入力はkcalを小数第3位まで、比率/許容幅を0.01%単位、fiber/saltを0.001g単位まで受ける。許容精度を超える値を黙って丸めて保存しない。energy>0、全数値が有限、P/F/C比率は各0〜100%、合計**100.00%ちょうど**。fiber>=0、salt上限>0、許容幅0%以上100%未満。UIとSQLで同じ検証をする。

比率はbasis points（100%=10000）で保存する。目標gは保存したkcalと比率から導く派生値で、編集可能な重複正本を置かない。

    P_g = E × p_bps / 10000 / 4
    F_g = E × f_bps / 10000 / 9
    C_g = E × c_bps / 10000 / 4
    carbohydrate_excluding_fiber_reference = C_g − fiber_goal

糖質参考値が負ならNULLと「この組合せでは算出不可」を示す。食品含有量への推定には使わない。表示はkcal整数、PFC/fiber/糖質0.1g、salt0.01gが基本だが、保存・集計・判定は表示前の値を使用する。

脂質の除数9などによる循環小数を繰り返し丸めない。権威的な比較はSQL numericの交差乗算、TS純粋関数はdecimal文字列からの固定小数/有理数演算を使う。例えば正の目標の下限判定は次の比較とする。

    A × (10000 × kcal_per_g) × 10000
        < E × macro_bps × (10000 − tolerance_bps)

上限は同様に>で比較する。等号は達成側。APIの新しい精度対象値はdecimal文字列で返し、BigInt自体をJSON化しない。画面用Numberへの変換は表示のみに限定する。既存snapshot numeric(18,6)の保存精度は維持し、保存済み量を再丸めしない。

比率0%を許可する。その栄養素のtarget_g=0、達成率%はNULL、差分gは表示できる。完全に既知の実測登録量0なら設定値内、正なら超過側とする。未記録や不明を「0目標を達成」としない。

## 2. 目標モードと履歴

| mode | 動作 |
|---|---|
| custom | 手動kcal・比率。初期モード |
| profile_reference | 既存estimateProfileEnergyの体格計算を参考候補にする。式・入力・適用範囲・推定日を表示して本人が採用 |
| training_split | training/restそれぞれのkcal、比率、fiber、salt、許容幅を保持 |

profile_referenceは必要な生年月日、性別、身長、体重、身体活動レベルが揃い、既存式の適用範囲にある場合のみ「登録体格からの参考計算」とする。参照体位fallbackを体格計算として採用しない。欠ける場合は理由を示してcustomへ戻れる。既存DRIの参照体位表示は維持する。

自動候補はPFC比率の医学的処方や増量分を勝手に生成しない。初期比率または本人の直前比率を使い、採用時のプロフィールrevision、体重参照、PAL、式版、元の計算値と採用したkcalを保存する。既存の50kcal単位の参考表示は維持し、保存計算に必要な丸め前の値は新しい純粋helperで分離する。以後プロフィールが変わっても過去/現在目標を自動再計算せず、新開始日の候補として再確認する。

### 有効日と編集

- goalはappend-onlyの版で保存する。保存時刻とeffective_fromの両方を持つ。
- 初回・通常変更のeffective_fromは操作時のプロフィールtimezoneの当日以降。過去への遡及適用は今回提供しない。offline intentの後日同期は[DB設計の例外規則](04-database-api-migration.md)に従い、元の選択日と保存時刻を区別する。
- 当日以降の変更は新しい版。過去に有効だった値は更新しない。
- 今日開始の複数変更では最新stream_revisionをその日全体の目標にする。「本日変更」と変更履歴を示し、食事ごとに目標を按分しない。
- 将来予定だけは取消/置換できる。元版を削除せず、supersedes_idで結ぶイベントを保存する。開始日を移動しても古い予定が意図せず残らない。
- 既に過去へ適用した版は編集しない。「複製して新しい開始日で保存」を提供する。
- 初回より前の日はtarget=NULL、reason=no_goal_history。現在の1800kcal等を過去に埋めない。
- 追加承認に基づき、現在有効な目標との参考比較を任意に提供する。これは後述の別出力であり、target履歴を書き換えない。
- 予定の照合はownerごとのstream_revisionで直列化し、同時保存は409。保存前の内容を自動rebaseしない。

### training/restの解決

training_splitではISO weekday 1=月〜7=日のtraining_weekdaysを目標版に保存し、それ以外をrestとする。初期曜日は未選択、全日restであることを保存時に表示する。default版のモードでは全日defaultを使う。

特定日の明示override（training/rest/clear）を別のappend-onlyイベントとして保存できる。clearならその日に有効な曜日予定へ戻る。overrideは通常当日以降のみ。過去のtraining区分を今の曜日設定で再分類しない。custom/profile_referenceモード中のoverrideは保存を拒否し、既存overrideが後の非splitモードと重なれば無効として説明する。

日dのtarget解決:

1. 取消・置換された将来予定を除外したset版のうちeffective_from<=dのものを求める。
2. effective_from降順、同日ならstream_revision降順で1版を選ぶ。なければ未設定。
3. splitならその日の最新override、なければ版の曜日予定でvariantを選ぶ。
4. kcal/PFC/fiber/salt/toleranceを同じ版・variantから返す。複数版を部分合成しない。
5. 結果にはgoal_version_id、day_type_event_id、variant、effective_from、calculation/sourceを付け、export/詳細から追跡可能にする。

## 3. 日付とtimezone

「今日」と週境界はプロフィールのIANA timezoneで決める。meal_date/effective_from/measured_onはcivil dateであり、UTC timestampへ変換して日をずらさない。週/月移動は検証済みISO日付の暦演算とし、ローカル時刻へ24時間足す方法を使わない。

timezone変更で過去meal_date、計測日、目標開始日を再キー化しない。各新規目標/計測には入力時timezoneも保持する。履歴画面には集計timezoneを表示する。eaten_at/measured_atがある場合も保存済みcivil dateを尊重し、当初入力のtimezoneとの不一致は黙って修正しない。

## 4. 日次データと判定状態

PFC・energyの各日各項目に次を返す。

    recorded_amount, known_amount, target_amount, delta_amount,
    attainment_percent, target_composition_percent, actual_composition_percent,
    record_state, sync_state, coverage, value_quality, estimate_status,
    achievement_state, reasons, goal_version_id

deltaは**記録量−目標量**（正が上回り、負が下回り）。残量は別名remaining=目標−記録量。値/符号の意味を画面で表示する。不完全な量のdeltaはknown_deltaとして区別し、完全な不足/残量にはしない。

record_stateはnot_recorded / partial / complete / complete_empty。固定3枠の現行完了規則を継承し、完了かつ食品ありならcomplete、0食品の完了はcomplete_emptyとする。3枠未完了でも食品あり/一部枠を記録・skip済みならpartial、それ以外はnot_recorded。同期はserver_confirmed / pending / requires_review / unavailable。coverageはcomplete / partial / unknown / incompatible。qualityの未確認・推定はcoverageと独立。

| 判定順 | 条件 | achievement_state / 表示 |
|---|---|---|
| 1 | 取得エラー、改訂整合性不明 | hold / 判定保留・再取得 |
| 2 | この端末の対象日に影響するoutboxあり | unsynced / 未同期（競合等の理由併記） |
| 3 | record_state=not_recorded | not_recorded / 未記録 |
| 4 | complete_empty | hold / 食品記録なし・判定保留 |
| 5 | 食事未完了、対象値に欠損/定義不一致 | hold / 判定保留 |
| 6 | 有効な目標なし | hold / 当時の目標なし |
| 7 | 完了＋食品あり＋全対象値既知＋目標あり | 数値判定へ |

完全な数値でも推定値を含む場合、設定目標との**数値比較**は可能だが「推定を含む参考比較」と付ける。栄養学的な確定評価へ昇格しない。未知のamountや互換不能なCから4kcal/g比率を作らない。

### 記録途中の進捗（追加指示の重点3）

正式achievementがhold/unsyncedでも、登録済みの既知小計、対象食品件数、欠損件数、目標比、既知分の差分をprovisional_progressとして返す。全量未確定は「記録途中・既知分」「栄養値未確認あり」、pending追加分は「端末の暫定値・未同期」と表示する。観察値0件ならNULL、明示0があるなら既知0。proteinだけ不明でも他の既知F/C/energyまで隠さない。

既知小計が低くても不足判定にせず、範囲内でも達成badgeを付けない。正式な月間達成日数は変えない。既知量が既に設定上限を超えていても「既知分で設定量を上回る参考事実」とし、健康上の過剰や正式な日次判定へ置き換えない。

### 目標開始前の過去日との参考比較（追加指示の重点4）

既定はoff。「現在の目標で参考比較」を本人が選んだ場合、現在日の有効なgoal/variantを読み取り、reference_comparisonとして別に返す。splitでは今日のvariantを既定とし、現在planのtraining/restを明示選択できる。過去の曜日から当時のtraining区分を捏造しない。

比較にはreference_goal_version_id、reference_as_of_date、variant、「当時の目標ではない」を必須表示する。正式targetはNULL、achievementはhold/no_goal_historyのまま。参考のg/差分/範囲位置は閲覧中だけで、goal履歴を作らず、月間達成日数・週間残量・正式CSV判定へ使わない。不完全記録では参考側も既知小計の暫定進捗だけを示す。

目標T、摂取A、許容幅tなら **T(1−t)<=A<=T(1+t)** が達成、下回れば不足側、上回れば超過側。90%/110%は達成、89.99%/110.01%はそれぞれ不足側/超過側。丸めた達成率で判定しない。

P/F/Cは個別判定。全体は3つとも判定可能なら全達成=achieved、それ以外=out_of_rangeとして「不足側/超過側/混在」の内訳を付ける。いずれか保留なら全体も保留で、他の既知項目の個別比較は残す。未記録/未同期を全体未達成にしない。

serverは他端末の未送信intentを検知できない。「サーバー確定記録」とこの端末のpendingを区別する。この端末のpendingを日付に重ね、月次達成日数から除外する。対象日を解決できない新goal pendingは影響期間を保留にする。bodyだけのpendingで既存栄養判定を無関係に止めない。

### 比率の2種類

PFC構成比は同じ完全なP/F/Cから次で計算する。

    M = 4P + 9F + 4C
    actual_P_percent = 100 × 4P / M （F、Cも同様）

M=0なら比率はNULL。食品記録energyとは一致しなくてもよい。記録kcal、PFC計算由来kcal、その差を詳細へ表示する。PFC目標g達成率=A/Tとは別の欄・ラベルを使う。DRI %Eは記録energyを分母とする既存仕様のまま。

## 5. 月間PFCカレンダー

月はYYYY-MM。プロフィールtimezoneの当日までを評価対象とし、将来日はfutureとして分母へ入れない。過去月は全暦日を表示する。

日別P/F/C摂取g・目標g・個別状態・全体状態を返し、P/F/C/energy達成日数、record_complete日数、項目別evaluable日数、PFC全体evaluable日数を別々に集計する。達成率を示すなら分母を判定可能日数と明記する。完了していても新栄養素が欠ける日は判定可能日と同一ではない。

月間構成比の日集合D_ratioは「食事完了・食品あり・P/F/C全て既知/互換・同期確認済み」の共通集合。目標の有無とは独立する。

    P_month = Σ(d∈D_ratio) P_d
    F_month = Σ(d∈D_ratio) F_d
    C_month = Σ(d∈D_ratio) C_d
    composition_month = 4P_month : 9F_month : 4C_month

日別%の平均は禁止。各栄養素を別々の日集合で足して比率を作ることも禁止。比較対象の目標構成比はD_ratioのうちgoalがある同じ日集合で重み付けし、「比較対象N日」を示す。全月の計画比率を表示する場合は別の「計画」と明記する。

ratio算出可能日とachievement算出可能日は一致しない場合がある。前者は目標不要、後者は目標必要。部分記録の既知量合計は詳細に残すが、それだけの円グラフを全月構成比とは表示しない。

体づくり向けには、設定との数値差、DRIの比較、値の不確実性、次の参考行動を別々に示す。protein 110.01%を自動で有害な過剰と呼ばない。目標自体がDRI範囲と異なることも説明可能にし、減量/制限の助言へ直結させない。

## 6. 週間帳尻合わせ

anchor_dateのISO weekdayを用い、start=直近月曜、end=start+6日。例: 2026-11-01（日）は10/26〜11/01、11/02（月）は11/02〜11/08。年越し・閏日も暦日で処理する。過去週へ移動可能。

項目jの日別目標T(d,j)を、その日に有効なgoalとtraining/restから解決する。

    weekly_target(j) = Σ(all 7 dates) T(d,j)
    recorded_known_sum(j) = Σ(known recorded entries in week)
    closed_target(j) = Σ(closed dates) T(d,j)
    closed_intake(j) = Σ(closed dates) complete registered amount(d,j)

7日分のgoalが揃わなければweekly_target=NULL、known_target_subtotalとgoal_days/7を示す。現在の目標×7で穴埋めしない。週途中の目標変更、予定のtraining日、今週途中の初回設定をそれぞれ反映する。

現在週のclosed datesは過去日＋今日がrecord_completeなら今日。日付が過ぎただけで記録を完了扱いにしない。過去日で未記録ならclosed_intakeは不完全である。未来を0摂取として差分へ確定計上しない。

表示する残り日数はclosed dates以外の今日以降の暦日数。今日の途中は「本日入力中」を併記する。過去週は0日。未来日・記録不完全日・欠損食品数・全不明日を栄養素ごとに区別する。

### 差分と完全性

- complete_record_daysと項目別evaluable_daysを表示。
- closed_intakeが完全ならclosed_intake−closed_targetを「確定記録期間の設定差分」として表示。
- 部分量ならknown_sum−targetは「既知分の比較」で、確定した不足残量にしない。
- weekly_target−known_sumは目標から既知記録を引いた算術値にすぎず、「あとこれだけ食べる」としない。
- 過去週の完全評価は7日全てが記録完了・食品あり・対象栄養値既知・目標あり・同期確認済みの場合に限る。その他は部分評価。
- 既存7/30/90の観察平均は別カード/リンクで残し、週合計の代わりにしない。

### 残り期間の参考量

数値の調整案を出す条件は、全7日の目標あり、closed datesが対象項目について全て判定可能、当日が未入力または記録完了、残り日数>0、未同期なし。今日の途中で既に食事がある場合は二重差引き防止のため調整案を保留し、当日の目標差と将来の通常目標を示す。

条件を満たすenergy/F/Cについて:

    R = weekly_target − closed_intake
    future_plan = Σ(remaining dates) T(d,j)
    scale = R / future_plan
    per_date_reference(d,j) = T(d,j) × scale

各日目標に比例して配分するのでtraining/restを同じg数へ潰さない。平均表示も可能だが日別内訳を持つ。

scaleが0.90〜1.10を外れる、R<=0、future_plan=0の場合は調整値を推奨欄へ出さず、「残りは通常の設定目標を参考に、記録と食生活を確認」とする。負の食事量、断食、埋め合わせの一括大量摂取を提示しない。**この10%は医療基準ではなく極端な提案を抑える製品上の表示制約**で、日次達成許容幅とは別定数・版で持つ。scale範囲内でも最適/安全との保証はしない。

proteinは週不足を再配分した参考摂取量を推奨しない。週間差分は表示するが、残り各日の通常protein目標を示し、「一括で補わず日々の食事で確認」とする。fiber/saltにも不足を一括で埋める指示は作らない。

人工例: 毎日1800kcal、月火水が完了して合計5500kcalなら週12600、残り7100、木〜日平均1775kcal。1日ごとの通常目標も併記。水曜が未完了/不明なら1775を確定した摂取目安にしない。週が終わった不足分を翌週へ自動繰越ししない。

## 7. 体重・体脂肪の計算

bodyは1人1日1件。measured_on必須、weight_kg>0、body_fat_percentはNULLまたは0〜100、measured_atは任意。日付だけの計測へ架空の時刻を付けない。修正はrevision保護、削除は明示操作。プロフィール連動の詳細は[体重設計](06-transfer-export-body.md)。

7日移動平均は[d−6,d]の実計測日だけの算術平均。体重と体脂肪はそれぞれ非NULL件数で計算し、n/7を表示する。n=0はNULL、n=1なら1点の平均という状態を明示する。未計測を0、前日値、補間値で埋めない。30/90日の先頭には計算専用の6日lookbackを取得する。

増減ペースは期間内の実体重日別値への等重み最小二乗直線の傾き×7（kg/週）を観察値として使う。3日以上の実計測、初末の間隔14日以上が表示条件。これは製品上の最低条件であり統計的確実性を意味しない。条件不足なら生の推移だけを残す。

目標体重・本人が指定する任意の目安ペースは設定値として表示する。傾きから食事量を自動変更したり、栄養達成が体重変化を引き起こしたと断定しない。過去の栄養達成日数と同じ期間で並べて振り返れる構成にする。
