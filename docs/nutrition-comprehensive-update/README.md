# 栄養管理総合アップデート

- 作成日: 2026-11-01（Asia/Tokyo）
- 対象: Auto-Hal/nutrition-sleep-app
- 監査基準main: **7b2bcea83c97d14aa8b11b06a8f2d0377dbbaec5**
- 設計ブランチ: **docs/nutrition-comprehensive-design**
- 状態: **第1段階設計は原則承認済み / 第2段階の段階的実装中 / Production未承認**

## 今回の範囲と停止条件

第1段階では設計文書だけを作成した。2026-11-01の追加指示により、設計を正本とした実装・自動検証・Preview反映・PR作成が承認された。以降の実施状況は[実装記録](09-implementation-status.md)を参照する。mainマージ、Production migration、Productionデプロイは新しい明示承認まで禁止。

GitHub、Supabase、Vercelの監査は読み取りだけを行った。DB照会はREAD ONLYトランザクションで、スキーマ・制約・関数定義・権限とグローバル栄養素定義に限定した。食事、体重、睡眠、ユーザーID、資格情報の実値を成果物へ転記していない。

PRを開くと現行Preview workflowが起動する。第1段階はlocal-onlyとしたが、追加指示により実装ブランチのpush/Preview/PRは承認済み。設計承認・実装開始・Production反映承認は別のゲートである。

## 文書案内

| 文書 | 内容 |
|---|---|
| [01-current-audit.md](01-current-audit.md) | main、DB、API、UI、テスト、運用の現状と文書との差分 |
| [02-nutrients-and-evidence.md](02-nutrients-and-evidence.md) | 全30コード、標準29項目、単位・由来・換算・DRI 2025 |
| [03-goals-and-calculations.md](03-goals-and-calculations.md) | 目標履歴、PFC日次/月次、週間帳尻合わせ、体重計算 |
| [04-database-api-migration.md](04-database-api-migration.md) | テーブル、RPC/API、outbox互換性、追加migration、セキュリティ |
| [05-ui-ux.md](05-ui-ux.md) | iPhone優先の5タブ、画面状態、操作導線 |
| [06-transfer-export-body.md](06-transfer-export-body.md) | カロミルPNG、JSON/CSV、体重プロフィール整合性 |
| [07-delivery-tests-risks-review.md](07-delivery-tests-risks-review.md) | 実装単位・依存関係・受け入れ・レビュー・リスク・リリース |
| [08-implementation-handoff.md](08-implementation-handoff.md) | 次回Codexへ渡す実装開始指示 |
| [09-implementation-status.md](09-implementation-status.md) | 重点4項目の補足判断、実装単位の検証・環境反映状況 |
| [10-preview-acceptance-and-production-plan.md](10-preview-acceptance-and-production-plan.md) | 操作案内、実機確認表、Production承認後の移行・障害対応 |

## 主要な設計判断

1. 既存18コードを維持して12コードを追加する。標準表示はsodiumを除く29項目、内部・JSON定義は30コードとする。
2. 過去のMealEntry snapshotsを補完・再計算しない。追加栄養素の過去行がないことは「不明」であり、0ではない。
3. 栄養値の由来、ユーザー確認、欠損、化学形態、食事記録完了、同期状態を独立した属性にする。
4. 個人のカロリー/PFC目標とDRIを別の計算・表示として保つ。PFC由来エネルギー比の分母とDRIの総記録エネルギーの分母を共有しない。
5. 目標の有効開始日と保存履歴を保持する。通常操作の開始日は当日以降に限定し、過去へ現在のプリセットを自動適用しない。
6. 日次達成は完全な食事記録・既知の対象栄養値・有効な当時の目標・同期確認を条件にする。未記録/保留/未同期を未達成日数へ加えない。
7. 月次構成比は同じ日集合のPFCエネルギー合計から算出する。週間残量は観察平均から作らず、日ごとの目標と記録合計で計算する。
8. 週間の差分を食事制限やたんぱく質のまとめ摂りの指示にしない。参考調整量には明示条件と製品上の表示制限を置く。
9. カロミル転送はPNG生成と本人の手動登録確認とする。全29項目は1枚を原則とし、画像生成成功と外部OCR成功を別ゲートにする。
10. 体重は1日1件の計測履歴を追加する。プロフィール連動は明示選択し、旧プロフィール値から時系列を生成しない。
11. JSON v1の構造を残し、新機能を含む完全な新形式をv2で提供する。CSVは日/食事/摂取食品明細を選び、不明を空欄と状態列で表す。
12. 新しい参照fingerprint/outbox契約を追加し、旧契約のpendingを再解釈しない。旧クライアントの食品編集で新12項目を消さない。
13. 記録途中の既知量/暫定進捗を常時表示し、正式な達成判定とは分ける。目標開始前の過去日は、明示選択した場合だけ現在の目標との参考比較を提供し、履歴・達成日数・帳尻合わせへ混入させない。

## 監査で見つかった実装前の重要事項

- Previewのmigration履歴には直接Chat登録がないが、関数は存在する。履歴だけで「未実装」と判断しない。
- Preview/ProductionのexportとChat登録関数は、確認した定義では空白を除いて一致する。一方、Batch再計算関数のauthenticated実行権が異なる。
- Open Food Factsのcarbohydratesはfiberを除く定義だが、現行adapterはそのままcarbohydrateへ対応付ける。新規取り込みを是正し、過去値の定義不確実性は隠さない。
- 日次RPCの既知小計0は欠損や未記録でも返り得る。PFC、CSV、PNGがこれを摂取0として利用してはならない。
- 現行Playwrightは認証殻と合成睡眠UIが中心。新機能の認証済みCRUD・同期復旧・実iOS共有・カロミルOCRは新たな検証が必要。

## 推奨する実装順序

環境差分の再確認 → 旧契約保護 → 30コード/由来の基盤 → 目標と体重のDB・信頼性基盤 → PFC日次/月次/週次 → Body → PNG転送 → JSON/CSV → UI統合 → 全自動検証 → Preview・実機検証 → 本変更に対する新たなProduction承認。

詳細なPR単位とゲートは[実装・受け入れ計画](07-delivery-tests-risks-review.md)を正とする。設計レビューは実装者による観点別セルフレビューであり、第三者レビューや栄養専門職による臨床的承認を実施したという意味ではない。
