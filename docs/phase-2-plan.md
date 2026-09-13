# Phase 2 実装計画

対象ブランチ: `phase/2-nutrition-entry-foundation`

Phase 2では、後続の栄養集計に耐える食事入力の基礎を追加する。Phase 1のAuth、`auth.uid()` RLS、server-side session、Preview/Production分離、Profile revisionは変更しない。Production DBへのmigration適用とProduction deployは行わない。

## 実装方針

- Catalogの現在値（`catalog_items` / `item_nutrients`）と、摂取時点の履歴（`meal_entries` / `meal_entry_nutrient_snapshots`）を分離する。
- MealEntry作成RPCがCatalog値を読込み、18項目のsnapshotを同一transactionで保存する。Catalogのrevision、provenance、captured_atをsnapshotに記録する。
- 栄養値の空欄は行を作らず、snapshotのamountを`NULL`として保持する。明示入力の`0`は0のまま保存する。
- Batchは構成要素、使用量、servingsを正本とし、Batchの現在値をMealEntryへコピーした後はレシピ変更の影響を受けない。
- 固定枠は朝食・昼食・夕食、その他は`meal_type=custom`と`eaten_at`で記録する。`not_recorded`、`recorded`、`skipped`を別状態として保持する。
- idempotency keyとtransaction advisory lockで、再送時の同一MealEntry重複を防ぐ。
- Catalogの削除APIは無効化を促して405を返す。参照中のCatalog itemをhard deleteできないFKも維持する。
- 書込みはownerチェック付きRPCへ限定し、Data APIのauthenticated権限はRLS付きSELECTだけに絞る。RPCを`SECURITY DEFINER`にするのは、直接書込み権限を与えずsnapshot atomicityを保つためで、各RPCが`auth.uid()`を検証し、`search_path`を固定する。

## 変更対象

- `supabase/migrations/20260914000000_phase2_meal_catalog.sql`: Phase 2ドメインschema、RLS、RPC、snapshot、idempotency。
- `supabase/migrations/20260914003000_phase2_privilege_hardening.sql`: authenticatedの暗黙table権限を撤去しSELECTだけを付与。
- `supabase/migrations/20260914004500_phase2_owner_trigger_fix.sql`: tableごとの`NEW`列を別分岐で評価するowner trigger修正。
- `supabase/migrations/20260914006000_phase2_fk_indexes.sql`: FK検査用index。
- `supabase/migrations/20260914008000_phase2_batch_unit_validation.sql`: Batch構成要素の単位検証。
- `supabase/migrations/20260914010000_phase2_integrity_hardening.sql`: 固定枠状態遷移、Batch専用RPC境界、品質伝播、snapshot provenance/qualityのcorrective hardening。
- `app/api/catalog/**`, `app/api/batches/**`, `app/api/meals/**`: owner-scoped CRUDとOrigin検証。
- `components/catalog-library.tsx`, `components/meal-log.tsx`: Library CRUD、Batch編集、Today食事入力。
- `lib/nutrition/catalog.ts`: nutrient vocabulary、型、入力payload helper。

## 受入マトリクス（Phase 2）

| ID | 条件 | 状態 |
|---|---|---|
| P2-01 | 5種類のCatalog item typeと18栄養項目を登録・一覧・編集できる | PASS（unit、pgTAP、Preview smoke、Library実装） |
| P2-02 | Catalog現在値とMealEntry snapshotを分離し、後日修正で過去snapshotが変わらない | PASS（unit、pgTAP、Preview corrective smoke） |
| P2-03 | NULL/unknownと明示0を区別する | PASS（unit、pgTAP、Preview corrective smoke） |
| P2-04 | Batchの構成・量・servingsを保存し、Batch編集後も過去snapshotが不変 | PASS（transaction smoke、pgTAP、単位検証） |
| P2-05 | 朝食・昼食・夕食とcustom/eaten_at、3状態を区別する | PASS（E2E、pgTAP、Preview corrective smoke） |
| P2-06 | idempotencyとrevision conflictで二重登録・上書きを防ぐ | PASS（unit、pgTAP、Preview corrective smoke） |
| P2-07 | Catalog/Meal/Batch/SnapshotのRLSとanon拒否 | PASS（Preview A/B/anon、pgTAP、権限確認） |
| P2-08 | Libraryで無効化でき、履歴をhard deleteで破壊しない | PASS（API/UI、FK、pgTAP） |
| P2-09 | fresh replay、lint、typecheck、unit、build、E2E、CI、Preview | PASS |

Preview project `pprsfxpfljdjlwdfbtqo`へはPhase 2 migrationと5本のcorrective migrationを適用済み。最新の `20260914010000_phase2_integrity_hardening.sql` はPreviewへ適用し、migration ledgerへの記録と14項目のfocused smokeを確認済み。Production project `vyvnicyupcrsmtgdyypv`には適用していない。


## Completion note

Phase 2 rolloutは2026-09-14に完了した。PR #2はmainへmergeされ、Production Supabaseへ6 migrationを同一sourceで適用し、Production Vercel deployment `dpl_4RVzBWNRXHVUKVZ3Te1CjBBc2bmE`（commit `259f7962574d747514fbbd9051e448d051131ad5`）を `target=production` で検証済み。Preview/iPhone/iPad/Production acceptanceはすべてPASS。Phase 2 COMPLETE、Phase 3 READY TO START。
