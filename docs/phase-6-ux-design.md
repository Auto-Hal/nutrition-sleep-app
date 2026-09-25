# Phase 6 UX Design

Status: ASTRA REVIEW CORRECTIONS APPLIED  
Updated: 2026-09-23

## Goal

Keep normal daily use simple while making exceptional states explicit and truthful.

Phase 6 UX must distinguish:

- local persistence vs server-confirmed success;
- transport failure vs authentication pause;
- revision conflict vs changed nutrition reference;
- expired retry horizon vs known server success;
- recorded Nutrition evidence vs provisional offline intent;
- server account deletion vs this-device cleanup vs provider-side data.

## Stable mutation state vocabulary

| State | User-facing meaning |
|---|---|
| pending / in_flight | 端末に保存・未同期 |
| failed | 同期失敗、入力は保持 |
| paused_auth | ログインが必要、未同期入力は保持 |
| conflict | サーバー状態との確認が必要 |
| expired | 自動再送期限切れ、適用有無の確認が必要 |
| blocked | version・依存条件等により再送不可 |
| synced | サーバー成功を確認済み |

Color is never the only indicator.

## Local persistence language

Only after IndexedDB persistence succeeds:

`端末に保存・未同期`

Never use:
- `保存済み`
- `記録済み`

as an authoritative server claim while pending.

If local persistence fails:
- retain form state if possible;
- show `端末に保存できませんでした`;
- do not show pending badge as if durable.

## Global connectivity

### Normal online

No global banner.

### Offline

Small persistent banner:

`オフラインです。対応する変更は端末に保存し、接続後に同期します。`

Add a note where appropriate:

`端末の保存領域はOS/ブラウザの状況により失われる場合があります。`

Do not imply 30-day storage guarantee.

### paused_auth

Banner:

`ログインが必要です。未同期の入力はこの端末に保持されています。`

Actions:
- `ログインする`
- `未同期項目を確認`

Replay resumes only for the same owner/environment.

## Today

### Pending MealEntry

Immediately render the user's intended entry with:

- `未同期` badge;
- existing provisional nutrition feedback where locally computable.

The provisional entry is visually distinct.

It is **not** included in authoritative 7/30/90 Nutrition analytics or improvement/review priority until server-confirmed.

### Synced MealEntry

After receipt/server success:
- pending badge disappears;
- authoritative data refetch/reconciliation runs.

The original receipt result does not replace newer current screen state by itself.

### Failed

Keep local intent visible:

`同期できませんでした`

Actions:
- `再試行`
- `入力を破棄`

Discard rolls back provisional local display only.

### paused_auth

Keep intended row visible but disabled from replay until login.

### reference_changed

Specific conflict UI:

```
食品の登録内容が変わっています

この食事を入力した後に、食品またはBatchの
1回量・栄養値・出典が変更されました。

入力時に選んだ内容
[summary]

現在の登録内容
[summary]

現在の内容を確認してから、もう一度記録してください。

[現在の食品を見る]
[この未同期入力を破棄]
```

Do not silently use the newer nutrient values.

### revision_conflict

```
別の端末または別の操作で更新されています

現在の内容
[server]

この端末の変更
[local]

[サーバー側を採用]
[内容を確認して再度反映]
```

Reapply creates a new operation using the revision the user actually reviewed.

### operation_content_mismatch

This is not ordinary conflict UX.

```
この未同期操作を安全に再送できません

操作情報が一致しないため、自動再送を停止しました。
現在の画面から新しく操作してください。

[現在の状態を開く]
[未同期項目を破棄]
```

## Expired operation

After the 30-day automatic replay horizon:

```
この未同期操作は自動再送期限を過ぎました。
サーバーに反映済みか確認しています。
```

Possible results:

### Receipt confirms success

`この操作はサーバーに反映済みでした。`

Then refetch current state.

### Server confirms not applied

`この操作は反映されていません。現在の内容を確認して、必要なら新しく操作してください。`

### Outcome unknown

```
この操作が反映されたか確認できません。

重複を防ぐため、自動で再作成しません。
現在の記録を確認してください。
```

Actions:
- `現在の記録を確認`
- `この端末の未同期情報を破棄`

Never auto-create a replacement operation.

## Logout

If unsynchronized intent exists:

```
未同期の変更が3件あります

ログアウトすると、これらは自動送信されません。
この端末に保持するか、破棄してログアウトするか選んでください。

[未同期入力を保持してログアウト]
[未同期入力を破棄してログアウト]
[キャンセル]
```

Preserved items remain bound to the same owner/environment and do not replay until that owner logs in again.

## Nutrition Management

Default remains 30 days.

### Top-level order

1. recording/evidence status;
2. factual comparable-UL section where applicable;
3. `記録から先に見直す項目`;
4. `見直す項目`;
5. `参考・判定保留 / データ不足`;
6. target/reference state met;
7. existing full nutrient list/detail.

### EAR/RDA display

Use:

```
カルシウム
記録平均：RDAの61%
記録平均がEAR未満
評価 21/30日
確認済み中心
```

Do not use:
- `充足度61/100`
- `不足度`
- `健康優先度`.

### DG display

```
食塩相当量
記録平均が目標上限より14%高い
評価 25/30日
[内訳を見る]
```

### AI below

```
ビタミンD
記録平均がAI未満
不足とは判定できません
評価 18/30日
```

No shortage score.

### UL display

When evidence threshold is met:

```
記録上の過剰確認

○○
30日間の評価可能な記録平均がULを上回っています
評価 18/30日
[内訳を見る]
```

When ordinary period evidence threshold is not met but comparable average exceeds UL:

```
参考

評価可能な記録の平均ではULを上回っています
評価 2/30日
データが少ないため、期間全体の傾向とは判定しません
```

### Multiple axes

If one nutrient has conflicting directions:

```
たんぱく質
g基準: RDA以上
エネルギー比: DG範囲外
複数の基準を確認
[内訳を見る]
```

Do not display one simple `増やす` or `減らす` action.

### Insufficient evidence

```
データ不足・参考

カルシウム
評価 6/30日
記録が増えると見直し一覧に表示できます
```

Missing data must not look like poor nutrition.

### Drilldown

Every review item links to the existing:

nutrient → day → meal → item

evidence path.

Pending offline entries are not mixed into this server-confirmed evidence chain.

## Product ingestion

### Local hit

Use local Product immediately.

No external refresh occurs silently.

### OFF identity + nutrition

Show:
- Product identity;
- external/unverified nutrient values;
- provider source.

Actions:
- `この候補を確認`
- `現物ラベルを読み取る`.

### External identity only

Example:

```
商品を見つけました

○○株式会社
○○パン

商品名は外部DBから取得しました。
栄養値・1回量は現物ラベルから確認します。

[栄養成分表示を撮影]
[商品名を修正]
```

Do not infer nutrition serving basis from package size.

### No safe identity

```
商品DBでは安全に特定できませんでした

商品名を入力して、栄養成分表示を撮影してください。
```

Barcode remains attached to the current draft.

### Delayed response

If barcode/draft changed while OFF/Yahoo/OCR response was pending:
- discard/ignore stale response;
- never combine it with the new active draft.

### OCR confirmation

Show identity provenance and nutrient provenance separately.

Example:

- 商品名: Yahoo!候補 → user confirmed
- 栄養値: 現物ラベルOCR → user verified

Do not describe Yahoo as nutrient source.

### Existing verified difference

If incoming OCR/external data differs from verified data:
- show explicit diff;
- user must confirm replacement;
- basis + affected nutrient tuples update together.

## Settings / Library — Data and account

### Export

```
データを書き出す

プロフィール、食事・栄養履歴、保存されている睡眠データを
version付きJSONとして保存します。

認証トークン、パスワード、暗号化credentialは含みません。

このファイルには健康・栄養情報が含まれます。

[データを書き出す]
```

Do not call it a restorable backup while import does not exist.

### Account deletion entry

Separate destructive section:

```
アカウントとサーバー上のデータを削除

食事、栄養、Library、睡眠、連携credentialなど
このアプリのサーバー上のユーザーデータを削除します。

この操作は元に戻せません。

[削除手続きを始める]
```

### Scope explanation

Before password:

```
削除されるもの
・このアプリのサーバー上の栄養・食事データ
・保存されている睡眠データ
・Library / Product / Batch
・Google Health連携credential
・このアプリのsession

別途残る可能性があるもの
・Google側の元の健康データ
・既にダウンロードしたexport
・他のオフライン端末に残っているローカルデータ
・OS/ブラウザのバックアップ

他の端末は次回接続時に削除状態を確認します。
```

Recommend export first.

### Fresh password

Final destructive request includes current password.

Rate-limited server verification; no password persistence.

### Deletion progress

Use explicit states:

- `削除を準備しています`
- `連携解除を確認しています`
- `サーバー上のデータを削除しています`
- `この端末のデータを消去しています`

### Provider revoke unknown

If Google revocation result is unknown but local deletion succeeds:

```
このアプリのサーバー上のデータは削除されました。

Google側の連携解除結果を確認できなかったため、
必要に応じてGoogleアカウントの接続済みアプリも確認してください。
```

Do not say remote revoke succeeded.

### deletion_outcome_unknown

```
削除結果を確認中です

サーバー側で削除が完了したか、まだ確認できません。
重複した削除処理は行わず、状態を再確認します。

[状態を再確認]
```

Do not show ordinary logged-in app state while deletion guard/status is active.

### Confirmed deletion

```
サーバー上のアカウントとデータを削除しました

この端末のアプリデータも消去しました。
他のオフライン端末やダウンロード済みファイルは、
それぞれの端末/保存先で削除してください。

再利用する場合はアカウントの再Provisionが必要です。
```

## Sleep Management

No Phase 6 redesign of Phase 5 analytics.

Provider actions remain online-only.

During account deletion:
- connect/reauth/callback/sync are blocked by the lifecycle guard.

Offline:
- explain `接続が必要です`;
- never queue fake Sleep sync intent.

## Offline shell

Cold-start offline:

```
オフラインです

現在、サーバーから最新の栄養・睡眠データを読み込めません。

この端末に未同期の入力がある場合は確認できます。

[未同期項目を見る]
[再試行]
```

Do not render cached authenticated HTML/RSC/API data as current server truth.

## Version recovery

If queue contract is compatible:
- migrate explicitly;
- continue.

If incompatible:
- state = blocked;
- show why;
- preserve the record;
- do not drop or guess.

Outbox version handling ships with the outbox itself, not later.

## Accessibility

- state meaning never depends on color alone;
- `aria-live` for mutation state transitions where useful;
- conflict sides have explicit labels;
- nutrition screen reader order follows semantic hierarchy;
- destructive action labels clearly describe server deletion;
- touch targets remain iPhone-appropriate.

## iPhone/iPad acceptance

iPhone:
- top review items readable without opening every nutrient;
- pending badges do not crowd meal rows;
- conflict dialogs stack vertically;
- JAN→identity→OCR flow is short;
- deletion scope is readable.

iPad:
- wider layout may use columns;
- same semantic order and information;
- no iPad-only state meaning.

## Approved Astra corrections

The UX now incorporates:
- all stable mutation states;
- truthful local-persistence wording;
- expired/result-lookup semantics;
- conflict subtype distinction;
- RDA-ratio wording;
- evidence thresholds/data-insufficient handling;
- mixed-axis nutrition behavior;
- server deletion vs local-device/provider distinction;
- ambiguous deletion status.
