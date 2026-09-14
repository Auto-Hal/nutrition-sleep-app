# Phase 3 実装計画

対象ブランチ: `phase/3-product-ingestion`

## 目的

Phase 3は、市販品・サプリを「バーコード → 自前DB → 承認済み外部商品DB → ラベルOCR」の順で低入力負担に登録できるようにする。Phase 2で確立したCatalog/MealEntry/Snapshotの履歴不変性、RLS、idempotency、revision、Preview/Production分離は変更しない。

完了ゲートは **iPhone実機 camera E2E**。

## 正本要件

- 市販品・サプリの初回登録はバーコードを第一入口とする。
- 解決順序は **自前DB → 承認済み外部商品DB → ラベルOCR fallback**。
- 外部DBの取得元・取得日時を保持し、メーカー公式値と同等の確度として扱わない。
- 外部DBで見つからない場合は栄養成分表示をカメラで読み取り、ユーザー確認後に登録する。栄養値の手入力を通常フローにしない。
- 一度登録した商品はbarcodeと正規化済み栄養値を自前DBに保存して再利用する。
- 現物ラベルまたはメーカー公式値は外部DBより優先できる。
- source priorityは以下を維持する。
  1. manufacturer / official
  2. label OCR + user confirmation
  3. authoritative food composition table（食材）
  4. external database
  5. estimated dish
- LibraryはSettings内に留め、Products / Supplementsを既存Catalogと統合する。
- MealEntry作成時の栄養snapshotは引き続きimmutable。Productの後日更新で過去履歴を変更しない。

## 実装方式

### 1. Barcode scanner

iOS Safariではnative `BarcodeDetector` が安定した前提にできないため、native APIへ依存しない。

Phase 3では `@zxing/browser` を使い、`MediaDevices/getUserMedia` から背面カメラを開いてGTIN系バーコードを読み取る。

対象:
- EAN-8
- EAN-13 / JAN
- UPC-A
- UPC-E
- GTIN-14相当を正規化して扱える経路

読取値は数字列として正規化し、GTIN check digitを検証する。不正値はDB/APIへ送らない。

カメラ権限拒否・読取不能時には「バーコード番号を入力」の回復経路を用意する。ただし通常フローはcamera scan。

### 2. Product resolution pipeline

サーバ側のProduct resolutionは次の順で固定する。

1. ownerの自前DBでbarcode検索
2. 見つからない場合のみOpen Food Facts API v3へ問い合わせ
3. 外部DBに商品がなければOCR fallbackを提示
4. 外部APIの429/5xx/timeoutは「未登録」と混同せず external_unavailable として扱い、OCR fallbackは利用可能にする

Open Food Factsはserver-side API clientから呼ぶ。clientへ外部API実装詳細を露出しない。

外部DB結果は自動確定せず、正規化結果をconfirmation UIに表示してから自前DBへ保存する。

### 3. Product metadata schema

Phase 3 migrationで、Product/Supplementに紐づくcommercial metadataを追加する。

`products`（実テーブル名は実装時に最終確認）:
- `catalog_item_id` PK/FK
- `user_id`
- `barcode`
- `manufacturer`
- `package_amount`
- `package_unit`
- `source_type`
- `source_provider`
- `source_uri`
- `source_observed_at`
- `confirmed_at`
- timestamps

不変条件:
- owner単位でbarcodeは一意。
- 対象Catalog item typeは `product` または `supplement` のみ。
- source metadataとitem nutrient provenance/qualityを矛盾させない。
- lower-priority sourceがuser-confirmed label値を黙って上書きしない。
- hard deleteでMeal historyを破壊しない。

### 4. 外部DB正規化

Open Food Factsのresponseはアプリ内部の18 nutrient vocabularyへ正規化する。

- 可能ならper-100g normalized valuesを基準として保存し、Catalogの`serving_size=100`, `serving_unit=g` と整合させる。
- energyはkcalを優先し、必要な場合のみkJ→kcal変換を明示的に行う。
- 未提供nutrientはunknownのまま保持し0補完しない。
- external DB由来:
  - provenance: `approved_external_db`
  - quality: `unverified`
  - source URI / observed_atを保存
- UI上でユーザーが現物と照合して確定した値は、確認操作を経た値だけ `user_verified` とする。

raw external response全体は永続化せず、必要な正規化metadataのみ保持する。

### 5. OCR fallback

ラベル撮影はiPhoneで安定する `<input type="file" accept="image/*" capture="environment">` を基本入口とする。

実機評価でclient-side Tesseract.jsは日本語の栄養成分表に対して実用精度へ達しなかったため、Phase 3 MVPの標準経路は **Google Cloud Visionの同期 `DOCUMENT_TEXT_DETECTION`** へ変更する。

構成:
1. iPhone側で撮影画像を最大辺2200px程度へ縮小し、JPEGへ再エンコードしてEXIF等を除去。
2. Vercel Functionの4.5MB request上限を超えないよう3MB未満へ圧縮。
3. 認証済みserver routeへmultipart upload。
4. serverからCloud Vision `images:annotate` を同期呼び出し。
5. provider固有responseを、文字・座標・confidenceを含むprovider-neutral OCR documentへ正規化。
6. 座標からvisual rowを再構成し、栄養表示専用parserでlabel/value/unit/basisを抽出。
7. 画像と候補を同一確認画面でユーザー確認し、必要箇所だけ修正。
8. 確認後のみ既存Product RPCで保存。

画像はアプリDB/Storageへ保存しない。同期Cloud Visionへ送るだけで、OCR後はクライアントの確認用object URLも破棄する。

抽出対象:
- エネルギー
- たんぱく質
- 脂質
- 炭水化物
- 食物繊維
- ナトリウム / 食塩相当量
- 対応可能なCa / Fe / Zn / vitamins
- 「1枚当たり」「100g当たり」等の基準量

保存時:
- provenance: `ocr`
- quality: user confirmation後に `user_verified`
- source type: `label_ocr`
- source provider: `google_cloud_vision`
- source image自体は保存しない
- unknownは0に補完しない

### 6. OCR provider boundary / stop condition

OCR provider固有JSONをProduct schemaやUIへ直接結合しない。共通OCR document → nutrition parser → confirmationという境界を維持する。

Cloud Vision導入後も、実画像で以下が満たせない場合はPhase 3を無理に完了扱いにしない。
- 主要5項目＋基準量の大半を安定して確認画面へ渡せない
- 表の行/列対応を頻繁に取り違える
- p95の確認画面表示までの待ち時間が実用上長すぎる
- 誤読をunknownより優先して確定候補に出す

その場合はAzure Document Intelligence LayoutまたはMultimodal Vision APIを補助/代替providerとしてAstra級設計判断で再評価する。

### 7. Atomic write / source precedence

Product保存はCatalog + product metadata + nutrientsを同一transactionで処理するowner-scoped RPCを追加する。

要件:
- createはidempotency key対応
- updateはexpected revision対応
- lower-priority sourceによるsilent overwrite禁止
- user-confirmed labelはexternal DB refreshより優先
- Product後日修正は既存MealEntry snapshotを変更しない
- Batch依存Productを更新した場合、Phase 2ルールどおり現在のBatch nutrientだけ再計算し、過去snapshotは不変

### 8. API

予定route:
- `GET /api/products/resolve?barcode=...`
  - local hit / external candidate / not_found / external_unavailableを明示
- `POST /api/products`
  - confirmed candidateをatomic保存
- `PATCH /api/products/[id]`
  - source precedence + revision conflictを維持
- `POST /api/ocr/nutrition-label`
  - 認証済みmultipart image upload
  - 3MB以下のJPEG/PNG/WebP
  - Google Cloud Vision同期OCR
  - raw imageは永続保存しない

すべて既存server-side session + Origin validationを維持する。

### 9. UI

Settings → Library:
- Libraryの既存IAを維持
- Product / Supplement作成時に「バーコードで追加」を主導線にする
- scanner
- resolving state
- local hit
- external candidate confirmation
- OCR capture
- OCR review/edit confirmation
- save result
- source / data quality表示

Todayから既存Product/SupplementをMealEntryへ追加するPhase 2 flowは変更せず再利用する。

### 10. Observability

機微情報を出さず、最低限以下を分類する。
- barcode_invalid
- camera_permission_denied
- barcode_not_resolved
- external_not_found
- external_rate_limited
- external_unavailable
- ocr_failed
- ocr_parse_partial

barcode値、栄養値、OCR全文をapplication logへ不用意に出力しない。

## Migration

Phase 3 migrationはfresh replay可能なadditive migrationとして追加する。

予定:
1. Product/commercial metadata table
2. owner validation / RLS / indexes
3. atomic create/update RPC
4. privilege hardening

可能なら1 migrationにまとめ、後続corrective migrationを乱造しない。CI fresh resetでPhase 1→2→3を連続replayする。

## Tests

### Unit
- GTIN validation/check digit
- Open Food Facts normalization
- unit conversion
- unknown ≠ 0
- OCR visual-row grouping
- nutrition label parser
- Pasco実画像由来の正解値fixture（画像自体はGitへ保存しない）
- source-priority comparison

### Contract
- synthetic/minimal Open Food Facts v3 fixture
- 200 / not found / malformed / partial nutrients
- API schema driftを検知

### DB / pgTAP
- barcode owner uniqueness
- Product/Supplement type boundary
- RLS user A/B/anon
- idempotency
- revision conflict
- lower-priority overwrite rejection
- user-confirmed label priority
- snapshot immutability
- Batch current recalculation + historical snapshot preservation

### E2E
- scanner UI fallback states
- external candidate confirmation
- OCR confirmation
- Product/Supplement Library reuse

### Real-device gate
iPhone Safari/PWAで:
1. camera permission
2. JAN/EAN barcode scan
3. own DB miss → external DB candidate
4. confirm → save
5. same barcode再scan → own DB hit
6. unknown barcode → label camera
7. OCR → review/edit → Product save
8. saved ProductをTodayへ追加

iPadはlayout/regression確認を行うが、Phase 3の正式camera gateはiPhone。

## Phase boundary

Phase 3で行わない:
- Nutrition 7/30/90集計・DRI評価（Phase 4）
- Fitbit/Google Health/Sleep（Phase 5）
- full offline queue/export/performance hardening（Phase 6）
- runtime LLMによるEstimatedDish
- 外部DBへの商品WRITE

## Acceptance

- P3-01 barcode camera scanがiPhoneで動作
- P3-02 local DB → external DB → OCR fallback順序が守られる
- P3-03 external data source/observed_at/qualityを保持
- P3-04 external DBのunknown nutrientを0にしない
- P3-05 OCR値はユーザー確認なしに確定しない
- P3-06 confirmed labelがexternal DBより優先される
- P3-07 saved barcodeは次回local hit
- P3-08 Product/Supplementが既存Meal/Snapshot不変条件と統合
- P3-09 RLS/privilege/idempotency/revision/fresh replay PASS
- P3-10 CI + Preview + iPhone camera E2E PASS
