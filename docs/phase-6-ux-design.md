# Phase 6 UX Design

Status: DRAFT — SEMANTICS SUBJECT TO ASTRA REVIEW  
Updated: 2026-09-22

## Goal

Keep the app simple in normal daily use while making exceptional states explicit:
- offline/pending;
- failed sync;
- conflict;
- external product identity without nutrition;
- insufficient nutrition evidence;
- destructive account lifecycle.

Do not make advanced reliability state dominate the normal UI.

## Global sync state

### Normal

No global banner.

Server-confirmed writes behave as today.

### Offline

Show a small persistent but non-blocking banner:

`オフラインです。対応する変更は端末に保存し、接続後に同期します。`

Do not imply server save.

### Pending

For queued supported writes:
- item-level `未同期` pill;
- optional small global count in Settings/Today header;
- optimistic visual state remains visible.

Wording:
- `未同期`
- not `保存済み`.

### Failed

Retryable but currently stopped:
- `同期できませんでした`
- explicit `再試行`.

### Conflict

Do not silently overwrite.

Conflict card/dialog:

```
変更が競合しています

別の端末でこの項目が更新されました。

現在の内容
[server value]

この端末の変更
[queued intended value]

[サーバー側を採用]
[自分の変更を反映]
```

“自分の変更を反映” creates a new operation against the latest revision.

### Expired pending operation

For operations older than the approved automatic replay horizon:

```
この未同期変更は時間が経っているため、自動送信を停止しました。
現在の内容を確認して、もう一度反映してください。
```

Actions:
- `破棄`
- `現在の内容と比較`

Never automatically replay expired intent.

## Today

Normal daily use remains fast.

### MealEntry pending

Immediately show the entry in the meal slot with:
- same optimistic nutrition feedback currently used;
- `未同期` badge.

Once server-confirmed:
- badge disappears;
- authoritative nutrition reconciliation runs.

If permanently failed:
- keep the intended entry visible but mark `同期失敗`;
- do not silently remove it without explanation.

If user explicitly discards failed local intent:
- rollback optimistic entry and nutrition contribution.

### Skip/unskip

Pending skipped state uses a subtle pending indicator.

Do not show a fixed slot as authoritatively skipped until server confirmation.

## Nutrition Management

Default remains 30 days.

### New top-level hierarchy

1. record/evidence status;
2. excess alert when applicable;
3. improvement priorities;
4. moderate / watch / insufficient-evidence groups;
5. full nutrient list / existing detail drilldown.

### Improvement priority card

Example:

```
改善優先

カルシウム
充足度 61 / 100
EAR未満 · 増やす
評価 21/30日 · 確認済み中心
[詳しく見る]

食物繊維
目標範囲より低い · 増やす
評価 19/30日
[詳しく見る]
```

Do not render a generic red number without the DRI semantic label.

### UL alert

Separate card above ordinary improvement ranking:

```
過剰注意

○○
ULを上回っています
評価 18/30日
[内訳を見る]
```

Only for comparable UL.

### AI below

Place under `参考・判定保留`:

```
ビタミンD
AI未満
不足とは判定できません
評価 18/30日
```

No 0–100 shortage score.

### Insufficient evidence

```
データ不足

カルシウム
評価 2/30日
もう少し記録がたまると傾向を表示できます
```

Missing data must not look like poor nutrition.

### Existing drilldown

Priority item tap reuses:
nutrient → day → meal → item.

Do not create a separate disconnected evidence UI.

## Product ingestion

### State 1 — local hit

Current behavior retained:
- product found in Library;
- use immediately;
- optional explicit edit/update path.

### State 2 — Open Food Facts identity + nutrition

Show:
- product identity;
- external/unverified nutrition;
- provider label.

Actions:
- `この候補を確認`
- `現物ラベルを読み取る`

Saving external nutrition without physical label confirmation keeps nutrient quality unverified.

### State 3 — external identity only

Yahoo or identity-only OFF:

```
商品を見つけました

○○株式会社
○○パン

商品名は外部DBから取得しました。
栄養値は現物ラベルから読み取ります。

[栄養成分表示を撮影]
[商品名を修正]
```

Provider attribution shown according to current terms.

### State 4 — no identity

```
商品DBでは見つかりませんでした

商品名を入力して、栄養成分表示を撮影してください。
```

Barcode remains attached to the draft.

### OCR confirmation

Show identity and nutrient provenance independently.

Example:
- 商品名: Yahoo!候補 → user confirmed
- 栄養値: 現物ラベルOCR → user verified

Never describe Yahoo as nutrient source when nutrients came from OCR.

### Repeat scan

Once saved locally:
- no external lookup required;
- local product opens immediately.

## Library / Settings

Existing page remains combined with internal tabs.

Add a `データとアカウント` section.

### Export

Card:

```
データを書き出す

プロフィール、食事・栄養履歴、睡眠データをJSONで保存します。
認証トークンやパスワードは含まれません。

[データを書き出す]
```

Before download:
- remind that the file contains sensitive health information.

### Account deletion

Separate destructive card at bottom:

```
アカウントとすべてのデータを削除

食事、栄養、睡眠、Library、連携情報を削除します。
この操作は元に戻せません。

[削除手続きを始める]
```

Flow:
1. explain scope;
2. recommend export;
3. current password;
4. typed/explicit final confirmation;
5. execute;
6. terminal deleted state.

Do not place destructive button next to ordinary settings Save.

## Sleep Management

Phase 6 does not redesign Phase 5 Sleep analytics.

Reliability additions:
- offline banner may appear;
- provider actions remain disabled/offline-online-only as appropriate;
- explain `接続が必要です` rather than queueing provider operations.

No local fake sleep state.

## Offline shell

Cold-start offline when authenticated page cannot be loaded:

```
オフラインです

現在、サーバーから栄養・睡眠データを読み込めません。
未同期の変更がある場合は端末に保持されています。

[再試行]
```

Do not render stale authenticated HTML from service-worker cache as if current.

## Update/version recovery

When a new application version is ready and no outbox migration issue exists:
- refresh normally or show subtle update prompt if needed.

If an incompatible queued operation exists:
- do not force update that drops it;
- show blocked operation with review path.

## Accessibility

- pending/conflict states must not rely on color alone;
- `aria-live` for write state changes where appropriate;
- destructive confirmation has clear labels;
- nutrition priority wording remains meaningful with screen reader order;
- buttons maintain touch targets suitable for iPhone.

## iPhone priorities

- top 3–5 nutrition priorities visible without extremely long scrolling;
- pending badge does not crowd meal row;
- conflict UI stacks vertically;
- barcode→identity→OCR path requires minimal back-and-forth;
- account deletion confirmation uses full-width readable controls.

## iPad priorities

- may use wider side-by-side detail layouts;
- semantic order remains identical to iPhone;
- no iPad-only information.

## Design constraints pending Astra

The visual states above are provisional until Astra approves:
- mutation conflict/retry semantics;
- nutrition priority bands/evidence thresholds;
- product identity/nutrition provenance;
- account deletion sequence.

Astra corrections change wording/behavior where required; they do not justify weakening the explicit-state UX.
