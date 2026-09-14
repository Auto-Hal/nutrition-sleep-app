# Phase 3 status

## 現在の状態

- **Phase 2 COMPLETE**
- **Phase 3 IMPLEMENTED / PREVIEW DB ACCEPTED / DEVICE ACCEPTANCE PENDING**
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
- OCRはclient-side Tesseract.js adapterとし、画像は永続保存しない。
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

## Stop condition

iPhone実機でclient-side OCRが安定しない場合、外部OCR provider追加を勝手に行わず、privacy/cost/securityを含む設計判断として再評価する。

## Remaining gate

1. latest docs-only Preview deployment READY確認
2. iPhone/iPad real-device acceptance
   - login
   - barcode camera permission / scanning
   - local DB hit
   - Open Food Facts hit
   - not-found → OCR fallback
   - OCR confirmation/edit
   - Product/Supplement Library persistence
   - Today intake from saved Product
3. Supervisor acceptance
4. PR ready / main merge
5. Production migration + Production deployment + Production verification
