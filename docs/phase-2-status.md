# Phase 2 status

## 現在の状態

- ブランチ: `phase/2-nutrition-entry-foundation`
- PR: [#2](https://github.com/Auto-Hal/nutrition-sleep-app/pull/2)
- 実装コミット: `73cf50bd542e2ed8ac8dd4bd528b86f619547506`, `80c450c182d40fd08eeb6f9f5c98a4adea02818b`, `61a1c291c8070b30b1a4b3a0a1769921a31dd56f`
- 現在のPR head: この文書を含む最終push後に `git rev-parse HEAD` で確認する（status文書の更新で変動するため固定値にしない）
- Production Supabase `vyvnicyupcrsmtgdyypv`、Production Vercel、mainは変更していない
- Phase 3は開始していない

## スキーマと履歴不変性

追加した主なテーブルは `catalog_items`、`item_nutrients`、`batches`、`batch_components`、`meals`、`meal_entries`、`meal_entry_nutrient_snapshots`、`nutrient_definitions`。Catalogは現在値、MealEntryは摂取時点の栄養snapshotを保持する。

`create_meal_entry` RPCがCatalogの現在値、revision、provenanceを同一transaction内で読み込み、18栄養項目のsnapshotとMealEntryを保存する。amountの`NULL`はunknown、明示入力の`0`は0として保持する。CatalogまたはBatchの後日更新は既存snapshotを変更しない。Batchは構成要素、使用量、servingsを正本とし、単位不一致は拒否する。

固定枠は breakfast/lunch/dinner、追加摂取は `meal_type=custom` と `eaten_at`。`not_recorded`、`recorded`、`skipped`は別状態で保存する。idempotency keyとtransaction advisory lockで再送による重複を防ぐ。Catalogの削除操作は無効化を使い、参照中の履歴をhard deleteしない。

## Migration

ソースmigrationは次の順で、すべて新規追加した。

1. `20260914000000_phase2_meal_catalog.sql`
2. `20260914003000_phase2_privilege_hardening.sql`
3. `20260914004500_phase2_owner_trigger_fix.sql`
4. `20260914006000_phase2_fk_indexes.sql`
5. `20260914008000_phase2_batch_unit_validation.sql`

Preview project `pprsfxpfljdjlwdfbtqo` のmigration ledgerには以下が記録されている。

- `20260913035508 cr002_login_rate_limits`（既存Phase 1）
- `20260913101714 phase2_meal_catalog`
- `20260913101749 phase2_privilege_hardening`
- `20260913101902 phase2_owner_trigger_fix`
- `20260913102637 phase2_fk_indexes`
- `20260913104249 phase2_batch_unit_validation`

CIのdatabase jobでは空DBにPhase 1からPhase 2までをfresh replayし、Phase 1/2 pgTAP合計65 assertionが成功した。Production projectにはmigrationを適用していない。

## RLS、権限、RPC

Phase 2の全user-owned tableでRLSを有効化し、所有者判定は`auth.uid()`に限定した。SnapshotはMealEntryの所有者経由でのみ参照できる。Preview実DB確認でuser Aは自分のCatalog/Mealのみ、user Bは0件、anonは拒否となった。

Data APIのtable権限はauthenticatedへSELECTのみを付与し、anon/publicの不要な権限、snapshotへの直接書込み権限を付与していない。書込みRPCはowner check、固定`search_path`、最小権限で実装し、snapshot atomicityのためにcontrolled `SECURITY DEFINER`を使用している。Security advisorに出るdefiner警告はこの境界の意図的なものとして記録する。

## CI、Preview、ローカル検証

- GitHub Actions CI run `34753018208`: success（checks job `103712625020`、database job `103712625133`）
- Preview workflow run `34753018209`: success
- 最新Preview deployment: `dpl_DZZWKe8usAiF1zGSa4k3uREkXqtZ`
- 最新Preview deployment URL: `https://nutrition-sleep-owzi1tdlj-tsuno2.vercel.app`
- 最新Preview deploymentはPR #2の現在コードを含むREADY状態
- 固定branch alias: [nutrition-sleep-app-git-phase-2-nutrition-entry-f-9522f4-tsuno2.vercel.app](https://nutrition-sleep-app-git-phase-2-nutrition-entry-f-9522f4-tsuno2.vercel.app)
- Preview deploymentのPR merge SHAはVercel生成の`850097c5c9b78de34afb2c49269b45e7181ef46d`。実装branchのsource headは上記実装コミット列で管理する
- `pnpm install --frozen-lockfile`: PASS
- `pnpm lint`: PASS
- `pnpm typecheck`: PASS
- `pnpm test`: PASS（8 files / 29 tests）
- `pnpm build`: PASS（Next.js 15.5.24）
- `pnpm test:e2e`: PASS（Chromium / WebKit mobile、6 tests）
- `pnpm verify:env`: PASS（安全なplaceholderによる環境契約検証）
- `git diff --check`: PASS

## Phase 2 acceptance matrix

| ID | 受入条件 | 状態 | 根拠 |
|---|---|---|---|
| P2-01 | 5種類のCatalog item typeと18栄養項目を登録・一覧・編集 | PASS | unit、pgTAP、Preview smoke、Library実装 |
| P2-02 | Catalog修正後も過去MealEntry snapshot不変 | PASS | transaction smoke、unit、pgTAP |
| P2-03 | NULL/unknownと明示0を区別 | PASS | unit、Preview smoke、pgTAP |
| P2-04 | Batch構成・量・servings、Batch更新後のsnapshot不変 | PASS | transaction smoke、pgTAP、単位検証 |
| P2-05 | 固定枠、custom/eaten_at、3状態を区別 | PASS | transaction smoke、E2E、pgTAP |
| P2-06 | idempotencyとrevision conflict | PASS | advisory lock smoke、既存revision test、pgTAP |
| P2-07 | Catalog/Meal/Batch/Snapshot RLSとanon拒否 | PASS | Preview user A/B/anon実DB、pgTAP、権限確認 |
| P2-08 | Library無効化と履歴保護 | PASS | API/UI、FK、pgTAP |
| P2-09 | fresh replay、lint/typecheck/unit/build/E2E/CI/Preview | PASS | CI run、ローカル検証、READY deployment |

SupervisorによるPRレビュー、Preview上の認証済みUI操作、iPhone/iPad実機確認はこの実装報告後のゲートとして残る。Production migration、Production deploy、main merge、Phase 3開始はSupervisorの次の承認まで行わない。
