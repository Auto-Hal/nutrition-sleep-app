# 次回Codexに渡す実装開始指示

以下は第1段階で作成した引継ぎ。2026-11-01の追加指示で設計が原則承認され、実装・Preview・PR作成が承認された。重点4項目の補足は03と09を併読する。Productionは引き続き未承認。

---

Auto-Hal/nutrition-sleep-appの栄養管理総合アップデートを実装してください。

最初にdocs/nutrition-comprehensive-update/README.mdと01〜07の設計文書、今回より後のAGENTS.md/既存main変更を確認してください。今回の設計基準は7b2bcea83c97d14aa8b11b06a8f2d0377dbbaec5ですが、最新mainをfetchして差分を監査し、無関係な変更を上書きしないでください。

mainを直接編集せず実装ブランチを作成してください。今回の設計ブランチのドキュメントを取り込み、P0→P1→P2の順で基盤から開始してください。小さい安全なPR単位に分け、計画だけで終わらず、許可された実装・検証を継続してください。

## 最初に行うこと

1. git status/remote main/直近mergeを確認し、現行変更と設計のずれを記録する。
2. Hosted Preview/Productionは当初読み取りだけでmigration名・実DDL・grantsを照合する。PreviewにChat直接登録migrationの履歴がなく関数があること、Batch再計算ACLの差を再確認する。無断repairしない。
3. 設計の旧18code/unit/fingerprint/receipt、snapshot、DRI/evidence、outbox1、export v1、Sleepをgolden fixtureにする。実データをfixtureへ転記しない。
4. 旧fingerprint18固定と旧全置換保護の互換bridgeを先に作る。12定義追加を先行させない。
5. 実装用の使い捨てlocal/CI DBを準備し、production接続がないことを確認する。CLIは--helpで実在コマンドを確認する。

## 守る設計契約

- 標準29、内部30。既存18のcode/unitを変更しない。糖質codeはcarbohydrate_excluding_fiberで、sugarsを流用しない。
- 不明はNULL。過去MealEntry snapshotsへ補完/再計算/NULL行追加を行わない。訂正は既存void＋replace。
- measured/official/database/calculated/estimatedとユーザー確認・欠損を区別する。由来不明を公式へ昇格しない。
- OFFのnet/gross C、A RAE、E、folate/Mg scopeの不一致を無条件換算しない。新取り込みから是正し、過去値を一括修正しない。
- PFC個人目標とDRIを別にする。初期1800/25/20/55、112.5/40/247.5、fiber20、salt7.50。gを累積丸めしない。
- goalはappend-only、有効日と遅延同期時刻を保持。初回より前を現在targetで埋めない。
- 月次は同じ日集合のPFCエネルギー合計。週次は日別goal合算と記録合計。未記録0、proteinまとめ摂り、極端な制限提案は禁止。
- Bodyは1日1件、profile_only/latest_measurementの明示mode。旧profile API/outboxも整合させる。架空の測定履歴は作らない。
- カロミルは基本7/全29のPNG、1対象1枚、未知行省略、保存/共有/名前コピー、本人の手動確認。共有成功を外部登録成功にしない。
- JSON v1を維持しv2へ新履歴・品質を追加。CSVは日/食事/食品明細と期間。全てowner-scoped single snapshot、NULL/0を分離。
- 全新tableにRLS、RPCに認証/owner/lifecycle guard、account削除cascade、導入時点からexport対応。
- outbox1と2を併存し、旧pendingを変換/削除/自動rebaseしない。rollback先は新データを守る互換bridge。
- Sleepの同期、scope、score v1、stage、提案を維持。外部体重scopeは追加しない。

## 検証・成果物

P0〜P9とN01〜R02の受け入れ表に実際の結果を追記してください。lint、typecheck、unit、application/DB integration、production build、fresh/upgrade migration replay、pgTAP、認証済みPlaywrightを実行し、失敗を修正してください。

Previewは今回の実装指示で許可された範囲を確認してから変更してください。PRを開くだけでPreview workflowが動く現行構成にも注意してください。最終PRに追加機能/UI、DB/互換性、テスト、未確認、実機、残る制限、Production手順、rollback先と具体手順を記載してください。

iPhone/iPad実機とカロミルOCRは本人の検証結果が必要です。実装と自動テストを先に具体化し、基本7と29の項目別実機確認表を渡してください。未確認を合格にしないでください。

**設計承認や今回の実装開始指示は、本番デプロイ承認ではありません。** 全自動・Preview・実機検証を揃え、このアップデートへの新しい明示承認を得るまでProduction DB migration、mainマージ、Productionデプロイを実行しないでください。

## 完了報告

実装機能、画面操作、29項目の経路別対応、PFC/週間、PNG/OCR、Body、テスト、Preview/Production、制限/未確認、本人の実機確認事項を分けて報告してください。自動テスト成功と実機合格を区別してください。

---

## 第1段階の引継ぎmetadata

- 設計ブランチ: docs/nutrition-comprehensive-design（第1段階ではlocal-only）
- 監査main: 7b2bcea83c97d14aa8b11b06a8f2d0377dbbaec5
- 監査したProduction: dpl_6wWY3x49CEv6s4CotFjdXdAsiD3Z / READY
- 監査したPreview: dpl_G4A2jg6owiQBQ7hjVpJHJFjk9k2Y / READY
- 今回はアプリ実装・migration実行・環境変更・PR作成・merge/deployをしていない
- 数値と表は設計/合成例。実ユーザーの食事/体重/睡眠値は含めていない
