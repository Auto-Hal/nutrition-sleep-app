# ChatGPT登録後の表示更新と入口の修正

2026-11-03。所有者から「ChatGPTでは登録完了だがアプリに表示されない」と報告を受けた。入口について認証不要の登録、または閲覧/本人用ログインの分離が許可されたため、後者を採用する。

## 確認した事実と原因

- 本番DBには11月3日分の記録があり、新規読込みした公開Todayの表示が同じ記録と一致した。照合は名称のhashだけを使い、実食事の名称・栄養値・本人IDを成果物へ転記していない。
- 公開TodayはRSCによる一回の読取りで、公開shellにはfocus/visibilitychange時の再取得がなかった。認証済みTodayの更新処理を経由しないため、別アプリのChatGPTから戻っても、既に開いている画面が古いままになり得た。
- ChatGPTのinboxリンクから未ログインで開くと、`/nutrition-import?draft=...`が`/login`へ変わり、ログイン後の復帰先にdraft IDが残らなかった。従来のnext検証はOAuth consent専用だった。
- ログイン直後のSPA移動は、事前読込みされた公開RSCの影響を避けるため新規document読込みへ変更する。これは認証境界の回帰防止であり、今回の全入力がこの問題だったと断定するものではない。
- 調査時点でPreview側に直近の新規登録はなく、本番/Preview双方のprimary targetは有効だった。実ChatGPTの会話や登録request IDと個々のDB行の対応付けまでは取得していない。MCPへの直近呼出しは確認できず、MCP OAuthを通ったと推測しない。
- 本番Vercelの直近50分のerror/fatalログ該当なし。24時間の照会はHobbyの保存期間制限で取得できず、50分へ修正した。これは過去の全障害を否定する証拠ではない。

## 修正内容

1. `/`とPWA起動先で、未ログインなら「ログインして記録・編集」「ログインせず閲覧」を示す。本人セッションがあれば従来どおりTodayへ進む。`/today`等の直接公開閲覧も継続する。
2. 公開headerへ「記録・編集に切替」と「最新の記録を表示」を追加。focus/visible/online/BFCache復帰で現在のRSCを再取得し、近接した重複イベントだけを1秒間まとめる。書き込み・outbox読込み/送信を起動しない。
3. ログイン後は新規documentを取得し、公開画面のRouter Cacheを引き継がない。OAuth consent、inboxのdraft ID、ブラウザーfragmentの下書きを、それぞれ適切な復帰先へ保持する。
4. nextはOAuth consentとnutrition-importだけを許可する。任意URL、外部origin、未知query、重複draft、非UUID、queryへ埋め込んだfragmentを許可しない。栄養payloadは引き続きfragment内に置く。
5. [ChatGPT用のコピー指示](11-chat-v2-instructions.md)に残っていた移行前のPreview専用指定を、本番反映後の通常運用先へ更新。既存の外部ChatGPT Projectの指示を自動変更したという意味ではない。

## 検証方針と運用

- 単体回帰: 安全な復帰先、inbox/fragment/OAuth引継ぎ、認証後の新規document、focusとvisibilityの重複抑制、短時間の再登録、online/BFCache復帰、手動再取得。
- 使い捨てDBの公開閲覧E2E: 画面を開いた後に外部登録を模したfixtureを追加し、focus/手動更新で新しい記録が表示されること、別ownerは表示されず匿名書込み/出力は拒否されることを3環境で確認する。
- 実Auth→Next→API→DBのE2E: 公開閲覧を先に開いた後、inboxリンク→ログイン→元下書き、fragmentリンク→ログイン→元下書きを3環境で確認する。試験データはloopbackの使い捨てDBだけで作る。
- lint/typecheck/unit/production buildと既存CIを実行し、確定SHA/Preview/本番URLの結果は修正PRへ記録する。物理iPhoneでの復帰や実ChatGPTからの新規入力成功は別の確認である。

DB migration、栄養snapshotの再計算、既存食事の移動/削除、認証情報の変更、匿名への更新権限追加は行わない。本番反映は検証したProduction環境のartifactを切り替える。障害時は30コード/outbox 1/2を保持した既存81519dbの本番artifactへ戻せる。
