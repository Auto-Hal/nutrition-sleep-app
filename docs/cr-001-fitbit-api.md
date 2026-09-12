# CR-001 — Fitbit Web API指定のRequired Change

作成日: 2026-09-12 / 状態: REQUIRED CHANGE・SUPERSEDED・審議中

## 事実と影響

Fitbit公式は旧Fitbit Web APIを2026年9月に非推奨化し、Google Health APIへの移行を案内している。今回の資料だけから正確な停止日やアカウントごとの利用可能性を断定しない。[Fitbit Sleep公式ページ](https://dev.fitbit.com/build/reference/web-api/sleep/)

Google Health APIはOAuth、schema、ID、レスポンス形式が変わる。旧tokenの移行はできず、利用者の再同意が必要。新規利用者を新APIへ接続する方針も公式移行ガイドに示されている。[Google公式移行資料](https://developers.google.com/health/migration)

v1.1の「Fitbit Sleep API v1.2を使用」はCR-001解決までsuperseded / do not implementとする。Phase 1にFitbit/Google Healthの実装は含めない。provider-neutralな境界を維持し、旧指定を前提としたschema・token・接続テーブルを作成しない。

## 要件差分候補

| 対象 | v1.1 | Required Change（審議対象） |
|---|---|---|
| 10 Sleep | Fitbit Sleep API v1.2を使用 | Fitbit由来睡眠を取得できる現行公式APIを使用。Google Health APIを第一候補とし、取得項目・精度・権限を実証後に確定 |
| 14 外部連携 | Fitbit OAuth 2.0 / Sleep v1.2等 | 採用APIのOAuthと指標対応表、token保管、refresh、再同意、fallbackを別ADRで確定 |
| 12 論理モデル | FitbitConnection | 論理名は保留。物理接続情報にはproviderとprovider account IDを識別できる設計を検討 |
| 17 禁止事項 | deprecated Sleep v1を使わない | 既存禁止を維持し、終了済みAPIへの新規依存を追加しない |

維持する受入条件は、朝の起動時の直近3日非同期再取得、冪等upsert、start/end、total sleep、time in bed、awake/light/deep/REM、日別hypnogram、7/30/90日、欠損を正常や0にしないこと。追加指標はv1.1の「可能なら」の扱いを維持する。

必須項目が新APIで同等に取得できない場合は、取得できる値へ黙って要件を縮小せず、差異と代替案をユーザーに提示する。

## 採用判断に必要な証拠

1. 新規開発者/アプリ登録の可否、利用者アカウント条件、必要scope、審査とテスト利用条件。
2. 睡眠sessionとstage intervalの対応、欠損・classic形式等の扱い、time in bedの定義、timezone、ID、訂正・削除・遅延到着の意味。
3. 直近3日再取得に必要な検索・ページング・quota、7/30/90日の履歴取得可否。
4. iPhone Safari/PWAでの同意→callback→復帰、拒否・取消・期限切れ・再同意。
5. サーバー側token保管、refresh競合、provider切替時の重複と履歴保護。

## Phase 1への扱い

Auth、Profile、RLS、4タブ、CI、環境分離の設計/実装は独立して進める。Phase 1ではFitbitConnection、睡眠schema、provider固有OAuth・token形式を作成しない。実プロバイダー連携はPhase 1の受入条件に含めず、別トラックの審議結果をPhase 5の開始条件として扱う。

本Required Changeの記録はGoogle Health API採用の確定を意味しない。Phase 1基盤の承認と、外部連携の要件変更承認は別に記録する。
