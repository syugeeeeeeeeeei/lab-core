# システム仕様（実装準拠）

最終更新: 2026-03-18

## 1. アーキテクチャ
- Dashboard:
操作 UI（登録、再起動、更新、削除、ログ閲覧）
- Backend API:
業務ロジック、ジョブ管理、イベント記録、DB 永続化
- State Store:
SQLite（`applications`, `deployments`, `routes`, `jobs`, `system_events`, `update_info`）
- Runtime Integration:
`docker compose` と `git` 実行（`execute` モード時）
- Infrastructure Sync:
Route から Caddyfile と hosts ファイルを自動生成

## 2. 実行モード
- `dry-run`:
Docker/Git 実行をスキップし、導線と状態遷移を検証
- `execute`:
Docker/Git を実行し、実コンテナ起動・ログ取得を実施

備考:
`runCommand()` は `dry-run` 時に成功擬似応答を返します。

## 3. データモデル（主要）
- `applications`:
アプリ本体、状態、現在/前回コミット
- `deployments`:
compose パス、公開サービス名、公開ポート、ホスト名、モード
- `routes`:
ホスト名と upstream 定義
- `container_instances`:
コンテナの観測情報（現状は将来拡張前提の保持）
- `jobs`:
長時間処理の進行管理（queued/running/succeeded/failed）
- `system_events`:
UI に表示するイベント
- `update_info`:
更新有無判定用のコミット情報

## 4. アプリ状態
`Draft | Cloning | Build Pending | Deploying | Running | Degraded | Stopped | Failed | Rebuilding | Deleting`

実装で主に使う遷移:
- 登録直後: `Build Pending`
- 配備/再起動中: `Deploying`
- 再ビルド中: `Rebuilding`
- 削除中: `Deleting`
- 正常: `Running`
- 失敗: `Failed`

## 5. API 仕様（主要エンドポイント）
- `GET /health`:
ヘルスチェック
- `GET /api/system/status`:
集計サマリ、実行モード、重要パス、IP/ドメイン設定
- `GET /api/applications`:
アプリ一覧（更新情報含む）
- `POST /api/applications`:
アプリ登録 + deploy ジョブ起動
- `GET /api/applications/:applicationId`:
詳細（deployment/routes/events/updateInfo）
- `POST /api/applications/:applicationId/restart`:
再起動ジョブ
- `POST /api/applications/:applicationId/rebuild`:
再ビルドジョブ（`keepData` 指定可）
- `POST /api/applications/:applicationId/update-check`:
更新検知
- `POST /api/applications/:applicationId/update`:
更新適用ジョブ
- `POST /api/applications/:applicationId/rollback`:
1世代ロールバックジョブ
- `DELETE /api/applications/:applicationId`:
削除ジョブ（`config_only | source_and_config | full`）
- `GET /api/jobs`:
ジョブ一覧
- `GET /api/events`:
イベント一覧
- `POST /api/infrastructure/sync`:
DNS/Proxy 生成ファイル再同期
- `GET /api/logs/:applicationId/services`:
ログ対象サービス一覧
- `GET /api/logs/:applicationId?service=&tail=`:
アプリログ取得
- `GET /api/testing/registration-fixtures`:
登録テスト用 fixture 一覧

## 6. ジョブ仕様
対象:
`deploy | restart | rebuild | update | rollback | delete`

共通:
- 作成時 `queued`
- 開始時 `running`
- 終了時 `succeeded` または `failed`
- 実行結果は `jobs.message` と `system_events` に記録

## 7. DNS/Proxy 同期仕様
- 入力:
有効化された `routes + deployments`
- 出力:
`LAB_CORE_PROXY_CONFIG_PATH` に Caddyfile
`LAB_CORE_DNS_HOSTS_PATH` に DNS レコードファイル（hosts 形式。OS の `/etc/hosts` は変更しない）
- DNS 生成:
`ssh.<rootDomain>` は `LAB_CORE_SSH_SERVICE_IP`
各 route host は `LAB_CORE_MAIN_SERVICE_IP`
- 内蔵 DNS:
`LAB_CORE_DNS_SERVER_ENABLED=true` の場合、backend が `LAB_CORE_DNS_BIND_HOST:LAB_CORE_DNS_PORT` で DNS を待ち受ける
生成済み hosts を権威データとして返し、それ以外は upstream へ転送する

## 8. 設定仕様（.env）
主要値:
- 実行制御: `LAB_CORE_EXECUTION_MODE`
- 経路: `LAB_CORE_APPS_ROOT`, `LAB_CORE_APPDATA_ROOT`
- ネットワーク: `LAB_CORE_MAIN_SERVICE_IP`, `LAB_CORE_SSH_SERVICE_IP`, `LAB_CORE_ROOT_DOMAIN`
- 生成物: `LAB_CORE_PROXY_CONFIG_PATH`, `LAB_CORE_DNS_HOSTS_PATH`, `LAB_CORE_SYNC_DIR`
- DNS サーバー: `LAB_CORE_DNS_SERVER_ENABLED`, `LAB_CORE_DNS_BIND_HOST`, `LAB_CORE_DNS_PORT`, `LAB_CORE_DNS_UPSTREAMS`

運用推奨:
- 手編集ではなく `yarn config:init` / `yarn config:reset` を使用
- backend は `core/backend/.env` を起動時自動読込
