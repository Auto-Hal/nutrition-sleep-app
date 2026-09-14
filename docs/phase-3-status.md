# Phase 3 status

## 現在の状態

- **Phase 2 COMPLETE**
- **Phase 3 STARTED / DESIGN COMPLETE / IMPLEMENTATION READY**
- branch: `phase/3-product-ingestion`
- main baseline: Phase 2 completion docsを含むmain
- ProductionはPhase 2 deploymentを維持
- Preview/Production SupabaseへPhase 3 migrationは未適用

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
- barcode scannerは `@zxing/browser` を第一候補とする。
- OCRはclient-side Tesseract.js adapterを第一候補とし、画像は永続保存しない。
- external DBはOpen Food Facts API v3。
- resolution orderはlocal → external → OCR。
- external dataはunverified、user-confirmed labelはuser_verified。
- lower-priority sourceによるverified labelのsilent overwriteを禁止する。
- Product更新後も過去MealEntry snapshotは不変。

## Stop condition

iPhone実機でclient-side OCRが安定しない場合、外部OCR provider追加を勝手に行わず、privacy/cost/securityを含む設計判断として再評価する。

## Next

1. Phase 3 schema/RPC migration
2. Product repository/API client
3. barcode scanner UI
4. Open Food Facts normalization
5. OCR adapter/parser/confirmation UI
6. tests/CI
7. Preview DB rollout
8. iPhone camera E2E
9. Supervisor acceptance
10. main merge / Production rollout
