# 機能カタログ

最終更新: 2026-03-18

## 1. アプリ登録
- UI:
「アプリ登録」フォームから入力
- API:
`POST /api/applications`
- 挙動:
`applications/deployments/routes` を作成し deploy ジョブを開始
- 補助:
登録テスト値（OruCa想定/シンプルWeb/Headless API）を UI から入力可能

## 2. アプリ一覧と状態表示
- UI:
状態バッジ、公開 URL、更新有無、current/prev commit を表示
- API:
`GET /api/applications`
- 表示:
`Running`, `Failed` などの状態を色付きで判別

## 3. 再起動
- UI:
一覧の「再起動」
- API:
`POST /api/applications/:id/restart`
- 挙動:
`docker compose restart`（`execute`）
`dry-run` では擬似成功で導線確認

## 4. 再ビルド
- UI:
一覧の「再ビルド」（現在 UI はデータ保持実行）
- API:
`POST /api/applications/:id/rebuild` with `keepData`
- 挙動:
`docker compose down` + `up --build`
`keepData=false` の場合は `down -v`

## 5. 更新検知・更新適用・ロールバック
- 更新確認:
`POST /api/applications/:id/update-check`
- 更新適用:
`POST /api/applications/:id/update`
- ロールバック:
`POST /api/applications/:id/rollback`（1世代のみ）
- 状態管理:
`current_commit` と `previous_commit` を更新し `update_info` に反映

## 6. ログ閲覧
- UI:
「ログ」からサービス切替、表示行数、オートスクロール
- API:
`GET /api/logs/:id/services`
`GET /api/logs/:id`
- `dry-run`:
イベント由来の疑似ログを表示
- `execute`:
`docker compose logs` の実ログを表示

## 7. 削除
- UI:
削除モード選択 + 確認用アプリ名入力
- API:
`DELETE /api/applications/:id`
- モード:
`config_only`
`source_and_config`
`full`（データ含む）

## 8. DNS/Proxy 同期
- UI:
右上「DNS/Proxy 同期」
- API:
`POST /api/infrastructure/sync`
- 出力:
生成 Caddyfile / hosts を更新しイベントに記録

## 9. イベント/ジョブ観測
- イベント:
`GET /api/events`
- ジョブ:
`GET /api/jobs`
- UI:
最近のイベントを常時表示し、操作成否を追跡

## 10. テスト支援
- fixture API:
`GET /api/testing/registration-fixtures`
- CLI:
`yarn test:register-fixtures`
`yarn test:smoke`

## 11. 設定安全化
- 対話型コマンド:
`yarn config:init`, `yarn config:reset`
- 特徴:
用途説明付き入力、バリデーション、保存前プレビュー、上書き時バックアップ

