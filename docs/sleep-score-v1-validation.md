# 睡眠スコア v1 検証・リリース記録

2026-10-26。作業ブランチ `codex/sleep-score-v1`。開始時main/Productionは `126a2fa587a5f44af11c61fd56ae3944d991e300`。既存の未マージstacked PRは取り込まず、このmainから分岐した。

## 実装と自動検証

- Vitest: 68ファイル・652件成功。既存473件に、純粋スコア81件、期間/認証付き取得33件、提案40件、実コンポーネント表示16件、実SSRページ統合9件を追加。
- lint: エラーなし。既存 `product-ingestion.tsx` のimg警告1件。
- typecheck: 成功。
- Next.js build: 成功。E2E用の開発サーバーと同時に生成キャッシュへ書き込まないよう、停止後にビルドを実行した。
- Playwright: Chromium、iPhone 13相当WebKit、iPad Mini相当WebKitの36件を実行。35件成功、mobileの横はみ出し1件を修正して該当ケースを再検証し成功。最新headの全36件は新CIでも検証する。
- iPhone幅で詳細をすべて開いた際、WebKitのgrid最小内容幅が親へ伝播する問題を発見。`.sleep-stack { min-width: 0; }` で内容を隠さず解決し、4種類の人工HTMLで再検証。
- スコアと既存詳細で同長セッションの選択が異なる問題をレビューで発見。両方を経過時間降順→ID順へそろえ、同長・異なる開始時刻の統合回帰を追加。
- Playwrightは、正本を模した架空セッション→実際の計算→実コンポーネントSSR→ブラウザの流れを検証する。認証後の本人データ、実Google Health同期、実機Safariを検証したと扱わない。
- 認証殻は実Nextアプリをダミー接続設定で検証。睡眠/TodayのSSR統合では、本人トークンが取得処理へ渡ること、未認証なら取得前にredirectすること、睡眠読取障害でもTodayの栄養登録が残ることを確認。

最終ビルド、GitHub CI、Preview deploymentの確定SHA・URL・結果はPR本文に記録する。実機受け入れが終わるまでProduction GOは未承認とする。

## DBとセキュリティ

睡眠スコアは派生値で、新しいmigration・テーブル・保存スコア・AI/API依存はない。現在期間、前期間、基準専用14日のセッションをuser JWTと既存RLSで取得する。基準用の夜は表示期間の分母に含めず、stage/離床詳細は表示期間だけを100セッションずつ取得する。

Preview project `pprsfxpfljdjlwdfbtqo` は停止していたため既存環境を再開し、既存 `20261010090000_sleep_details.sql` が未適用だったので同ファイルを適用した。睡眠履歴を削除せず、nullable short_awakenings等の既存追加列とowner-scoped exportをそろえた。これは新スコア用のDB変更ではない。適用後のスキーマ照会で、2列の存在、sleepのRLS/FORCE RLS有効、anon SELECT不可を確認。本番DBの変更は行っていない。

PreviewのSupabase Security Advisorには既存のSECURITY DEFINER RPC公開に関する31件、漏洩パスワード保護設定1件の警告がある。今回の読取処理は新たなSECURITY DEFINER、権限、公開APIを追加しない。RPCのowner認証・所有者分離は既存SQL回帰で確認し、既存警告を「全て解消」と報告しない。private領域のRLS policyなし情報6件も、ブラウザ向け許可を追加して解消しない。

参考: [SECURITY DEFINER advisor](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)、[パスワード保護](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)。

## 未完了の受け入れゲート

1. Previewへ本人がログインした状態で、本人の睡眠記録とTodayを確認。
2. iPhone Safari / iPad Safari実機で、7/30/90日、内訳、日別詳細、グラフと栄養登録を確認。
3. Google Health接続・同期・必要時の再認証/エラー表示、PWA再表示と更新を実機で確認。
4. これらの結果と最新CI/Previewをそろえて、今回の変更に対する明示的なProduction GOを得る。

承認前はmainマージ・Productionデプロイ・Production DB変更を行わない。実機確認はエミュレーションの成功で置き換えない。本人の値や資格情報を公開PR・fixture・テスト成果物へ記録しない。

## GO後の手順とロールバック

検証したPR headを指定してmainへマージし、確定SHAを既存Vercel projectのProductionへ反映する。本番のapp-version、本人のスコアと内訳、提案、期間切替、Today、同期、栄養登録を確認する。スコアモデル単体に必要な本番migrationはない。

問題時は直前の既知正常deploymentへ戻す。開始時の正常deploymentは `dpl_C6ovQuE573cbGouEW6bWuev5SqyK`。GO直前に最新の本番を再確認し、他の正当な変更を上書きしない。必要に応じてPRをrevertするが、睡眠の正本データを削除・巻き戻さない。
