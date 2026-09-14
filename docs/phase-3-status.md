# Phase 3 status

## 現在の状態

- **Phase 2 COMPLETE**
- **Phase 3 IMPLEMENTED / PREVIEW DB ACCEPTED / DEVICE ACCEPTANCE PASS / SUPERVISOR ACCEPTANCE PASS**
- branch: `phase/3-product-ingestion`
- main baseline: Phase 2 completion docsを含むmain
- ProductionはPhase 2 deploymentを維持
- Preview Supabase: `pprsfxpfljdjlwdfbtqo`
- Production Supabase: `vyvnicyupcrsmtgdyypv`（Phase 3未適用）

## Scope

Product:
- barcode scanner
- own DB resolution
- Open Food Facts API v3
- OCR fallback
- Product Library
- Supplement
- source priority / quality / provenance
- iPhone camera E2E

## Design decisions

- native `BarcodeDetector` 単独依存は採用しない。
- barcode scannerは `@zxing/browser`。
- client-side Tesseract.jsは実機精度不足のため標準経路から撤回。
- Phase 3 MVP OCRはGoogle Cloud Vision同期 `DOCUMENT_TEXT_DETECTION`。
- 画像はiPhone側で縮小/JPEG再エンコードし、3MB未満にして認証済みserver routeへ送る。
- Cloud Vision responseはprovider-neutral OCR documentへ正規化し、座標からvisual rowを再構成して栄養表示専用parserへ渡す。
- 画像はアプリDB/Storageへ永続保存しない。
- external DBはOpen Food Facts API v3。
- resolution orderはlocal → external → OCR。
- external dataはunverified、user-confirmed labelはuser_verified。
- lower-priority sourceによるverified labelのsilent overwriteを禁止する。
- Product更新後も過去MealEntry snapshotは不変。

## Preview DB acceptance

Source migration:
- `supabase/migrations/20260914100000_phase3_products.sql`

Preview migration ledger:
- `20260914012116 phase3_products`

Preview checks:
- migration apply PASS
- `supabase/smoke/phase3_products.sql` PASS
- smoke synthetic writes rollback confirmed: Product/Catalog/MealEntry remaining = 0
- Product RLS enabled
- authenticated: Product SELECT + commercial RPC execute allowed
- authenticated direct Product INSERT denied
- anon Product SELECT/INSERT denied
- anon commercial RPC execute denied
- GTIN valid/invalid contract PASS
- source priority guard PASS
- external DB = unverified / approved_external_db PASS
- confirmed label = user_verified / ocr PASS
- historical MealEntry snapshot immutability PASS
- cross-owner RLS roundtrip PASS

Supabase Advisor review:
- authenticated-callable SECURITY DEFINER warnings are expected for the owner-checking RPC architecture.
- private.app_sessions / private.login_rate_limits intentionally have RLS without client policies.
- leaked-password-protection warning is existing Auth configuration and is not introduced by Phase 3.
- unused-index notices are expected on the low-traffic Preview DB and are not grounds for removal before usage evidence exists.

## Preview application

- Preview `APP_ORIGIN` updated to:
  `https://nutrition-sleep-app-git-phase-3-product-ingestion-tsuno2.vercel.app`
- latest verified Preview deployment before this docs-only update: `dpl_Gjn7Df1atdgNS62NVzg33UwKkXPX`
- implementation CI: lint/typecheck/unit/build/fresh DB replay/pgTAP PASS
- Production remains untouched.
- `GOOGLE_CLOUD_VISION_API_KEY` は正しいVercel projectのPreview scopeへ再登録済み。Preview runtimeで `configured:true` を確認済み。

## Stop condition

iPhone実機でclient-side OCRが安定しない場合、外部OCR provider追加を勝手に行わず、privacy/cost/securityを含む設計判断として再評価する。

## Device acceptance checkpoint（2026-09-14）

iPhone/iPad実機でログインおよび主要フローの起動を確認した。

確認できたこと:
- Preview login PASS
- barcode camera起動 / 読み取り PASS
- barcode反応速度は実用上良好
- barcodeは反対向きからも読み取り可能
- barcode photo fallbackあり
- OCR撮影 / 解析フロー PASS
- iPad layout / regression PASS

Cloud OCR corrective acceptance:
- Google Cloud Vision + geometry-aware parserへ移行後、Pasco実画像で基準量 `1 枚` を正しく抽出。
- energy 180 kcal / protein 5.2 g / fat 2.6 g / carbohydrate 34.0 g / salt_equivalent 0.6 g をユーザー実機確認でPASS。
- 途中で確認されたcross-row誤代入（proteinへfat 2.6を誤代入）は、row-band geometry制約により解消。
- 読めない値は隣接行から借用せずunknownのまま残すfail-safe behaviorを確認。
- `kcaI` / `kca1` / `kca|` 等の既知単位OCR揺れ、および長い栄養ラベルの1文字以内のOCR揺れのみ限定正規化。
- 数値そのものは推測・補完しない。

OCR gate / barcode usability / iPad regressionはすべてPASS。Phase 3 Preview device acceptance COMPLETE。

改善・設計判断:
- barcodeは高解像度camera constraints + alignment guide + 静止画decode fallbackを追加済み。
- bounded Tesseract改善後も、実画像で主要項目を十分抽出できなかった。
- Astra比較の結果、Phase 3 MVPはGoogle Cloud Vision同期OCR + 栄養表示専用parser + ユーザー確認へ移行する。
- Pasco実画像のacceptance ground truth:
  - 表示基準: 1枚当たり
  - energy 180 kcal
  - protein 5.2 g
  - fat 2.6 g
  - carbohydrate 34.0 g
  - salt_equivalent 0.6 g
- 画像自体はGitへ保存せず、正解値とsynthetic OCR layout fixtureだけをtestへ持つ。
- Cloud Visionでも実用精度に達しない場合のみ、Azure Document Intelligence Layout / Multimodal Vision APIを次候補として再評価する。

## Post-Phase 3 external product coverage backlog

Open Food Factsだけでは日本の市販商品のcoverageが不足するため、Phase 3完了を阻害しない改善項目として外部商品source拡張をbacklog化する。

候補:
- GS1 Japan 産業横断レジストリー Web API
- その他、利用規約・料金・栄養項目coverage・commercial use条件を満たすapproved provider

原則:
- local DB → approved external providers → Cloud Vision OCR の順序を維持
- providerを増やしてもunknownを0補完しない
- 外部DB値はunverifiedのまま
- 現物ラベルuser_verifiedをlower-priority sourceで上書きしない
- provider追加はadapter追加として実装し、Product/MealEntry schemaへ直接結合しない

## Remaining gate

1. Cloud Vision OCR adapter / parser / confirmation UI CI COMPLETE
2. Preview Cloud Vision secret設定・runtime注入確認 COMPLETE
3. Pasco実画像でCloud Vision acceptance COMPLETE
4. iPhone barcode corrective acceptance COMPLETE
5. iPad regression確認 COMPLETE
6. Supervisor acceptance COMPLETE
7. PR ready / main merge
8. Production secret設定 + Production migration/deploy/verification
