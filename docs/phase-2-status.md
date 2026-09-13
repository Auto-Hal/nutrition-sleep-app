# Phase 2 status

## 現在の状態

- **Phase 2 COMPLETE**
- PR: [#2](https://github.com/Auto-Hal/nutrition-sleep-app/pull/2) はmainへmerge済み
- merge commit: `259f7962574d747514fbbd9051e448d051131ad5`
- Supervisor corrective acceptance head: `42f310ee109cdf5be24b7c00dee5c3f81f78e2bf`
- Production Supabase `vyvnicyupcrsmtgdyypv` へPhase 2 migration 6本を適用済み
- Production Vercel deployment: `dpl_4RVzBWNRXHVUKVZ3Te1CjBBc2bmE`
- Production alias: `https://nutrition-sleep-app.vercel.app`
- Production verification完了
- **Phase 3 READY TO START**

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
6. `20260914010000_phase2_integrity_hardening.sql`

Preview project `pprsfxpfljdjlwdfbtqo` のmigration ledgerには以下が記録されている。

- `20260913035508 cr002_login_rate_limits`（既存Phase 1）
- `20260913101714 phase2_meal_catalog`
- `20260913101749 phase2_privilege_hardening`
- `20260913101902 phase2_owner_trigger_fix`
- `20260913102637 phase2_fk_indexes`
- `20260913104249 phase2_batch_unit_validation`
- `20260914010000 phase2_integrity_hardening`

`20260914010000_phase2_integrity_hardening.sql` はSupervisorがPR #2へ追加したcorrective migrationで、固定枠の状態遷移、Batch専用RPC境界、Batch再計算時の品質伝播、snapshot provenance/quality保存を強化する。Preview SQL Editorで適用し、ledgerへの記録を確認した。Production projectにもPhase 2 rollout時に適用済み。

CIのdatabase jobでは空DBにPhase 1からPhase 2までをfresh replayし、pgTAPは全assertion成功。Production projectにも同じmigration sourceを順序どおり適用済み。

## RLS、権限、RPC

Phase 2の全user-owned tableでRLSを有効化し、所有者判定は`auth.uid()`に限定した。SnapshotはMealEntryの所有者経由でのみ参照できる。Preview実DB確認でuser Aは自分のCatalog/Mealのみ、user Bは0件、anonは拒否となった。

Data APIのtable権限はauthenticatedへSELECTのみを付与し、anon/publicの不要な権限、snapshotへの直接書込み権限を付与していない。書込みRPCはowner check、固定`search_path`、最小権限で実装し、snapshot atomicityのためにcontrolled `SECURITY DEFINER`を使用している。Security advisorに出るdefiner警告はこの境界の意図的なものとして記録する。

## CI、Preview、ローカル検証

- GitHub Actions CI run `34754339558`: success（checks job `103716065397`、database job `103716065251`）
- 最新Preview deployment: `dpl_EeZhK5G5fz5CF8n3CKdaTF3w1nXw`
- 最新Preview deployment URL: `https://nutrition-sleep-b6tf0p9xp-tsuno2.vercel.app`
- 最新Preview deploymentはSupervisor corrective headを含むREADY状態
- 固定branch alias: [nutrition-sleep-app-git-phase-2-nutrition-entry-f-9522f4-tsuno2.vercel.app](https://nutrition-sleep-app-git-phase-2-nutrition-entry-f-9522f4-tsuno2.vercel.app)
- Preview deploymentのsource commitは`42f310ee109cdf5be24b7c00dee5c3f81f78e2bf`（Supervisor corrective acceptance head）
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

## Corrective Preview smoke

`20260914010000_phase2_integrity_hardening.sql` 適用後、Preview実DBで14項目のfocused smokeをトランザクション内で実施し、全項目PASS。固定枠のactive entry保護、空枠skip、Batch専用RPC境界、nested Batch拒否、snapshotのamount/quality/provenance/source不変性、unknown保持、依存Batch再計算、品質伝播、使用中componentの単位変更拒否、user A/B/anon RLSを確認した。smokeはrollbackで終了し、実データは残していない。

SupervisorによるPRレビュー、Preview上の認証済みUI操作、iPhone/iPad実機確認、main merge、Production migration、Production deploy、Production verificationまで完了。Phase 2は正式にCOMPLETE。


## Preview device acceptance（2026-09-14）

- Preview DATABASE_URLの認証不一致を修復し、固定branch aliasからの実認証を再確認。
- Vercel runtimeで誤passwordの `POST /api/auth/login 401`、正しいpasswordの `POST /api/auth/login 200` を確認。
- 認証後の `/today`、`/nutrition`、`/sleep`、`/settings` は200。
- 実機操作で `POST /api/catalog 201`、`POST /api/meals 201`、`POST /api/meals/state 200` を確認。
- iPhone実機: PASS。
- iPad実機: PASS。
- Phase 2 Preview acceptance COMPLETE。
- Production rollout READY。Phase 3はProduction verification完了まで開始しない。


## Production rollout acceptance（2026-09-14）

- PR #2をmainへmerge。merge commit: `259f7962574d747514fbbd9051e448d051131ad5`。
- Production Supabase `vyvnicyupcrsmtgdyypv` のledgerでPhase 1 3本 + Phase 2 6本、計9本を確認。
- Phase 2必須8テーブル、RLS、RPC EXECUTE境界、snapshot write protection、`quality` / `source_uri` / `source_observed_at` を確認。
- Phase 1 Profile/session/rate-limitオブジェクトを維持し、既存データへの破壊的影響なし。
- Production deployment `dpl_4RVzBWNRXHVUKVZ3Te1CjBBc2bmE` は commit `259f7962574d747514fbbd9051e448d051131ad5`、`READY`、`target=production`。
- Production alias `https://nutrition-sleep-app.vercel.app` が同deploymentを指すことを確認。
- Vercel runtimeで誤passwordの `POST /api/auth/login 401`、正しいpasswordの `POST /api/auth/login 200` を確認。
- 認証後の `/today`、`/settings`、`/api/catalog`、`/api/batches`、`/api/meals` は200。
- Production runtime確認範囲で5xxなし。
- Catalog→MealEntryおよびskipped処理のDB write-path smokeはrollback transaction内でPASSし、テストデータ残存なし。
- **Phase 2 COMPLETE / Phase 3 READY TO START**。
