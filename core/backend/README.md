# Lab-Core Backend (MVP)

## 実装済み範囲
- Hono ベースの API サーバー
- 同期生成 hosts を使う内蔵 DNS サーバー（A/AAAA 応答 + upstream 転送）
- SQLite スキーマ初期化
- Application / Deployment / Route / Event / Job モデル
- 再起動・再ビルド・更新確認 API の最小フロー

## 主要 API
- `GET /health`
- `GET /api/system/status`
- `GET /api/applications`
- `POST /api/applications`
- `GET /api/applications/:applicationId`
- `POST /api/applications/:applicationId/restart`
- `POST /api/applications/:applicationId/rebuild`
- `POST /api/applications/:applicationId/update-check`
- `POST /api/applications/:applicationId/update`
- `POST /api/applications/:applicationId/rollback`
- `DELETE /api/applications/:applicationId`
- `GET /api/jobs`
- `GET /api/events`
- `POST /api/infrastructure/sync`
- `GET /api/logs/:applicationId/services`
- `GET /api/logs/:applicationId?service=&tail=`
- `GET /api/testing/registration-fixtures`

## 実行モード
- `LAB_CORE_EXECUTION_MODE=dry-run` (既定): Docker/Git の重い処理は実行せず、ジョブだけ進行
- `LAB_CORE_EXECUTION_MODE=execute`: 実際に clone / docker compose を実行

## 既定パス（未設定時）
- `LAB_CORE_DB_PATH=./core/backend/data/database.sqlite`
- `LAB_CORE_APPS_ROOT=./runtime/apps`
- `LAB_CORE_APPDATA_ROOT=./runtime/appdata`

## 生成ファイル
- `LAB_CORE_PROXY_CONFIG_PATH`: 同期時に生成する Caddy 設定
- `LAB_CORE_DNS_HOSTS_PATH`: 同期時に生成する DNS レコードファイル（hosts 形式、OS の `/etc/hosts` ではない）

## DNS サーバー
- `LAB_CORE_DNS_SERVER_ENABLED=true` で起動
- `LAB_CORE_DNS_BIND_HOST`, `LAB_CORE_DNS_PORT` で待受先を指定
- 未知の名前は `LAB_CORE_DNS_UPSTREAMS` または `/etc/resolv.conf` の upstream に転送
- `53` 番ポートは権限が必要な場合があります
- ローカル開発の既定は `127.0.0.1:1053` です
- ブラウザから `127.0.0.1:53` を使いたい場合は `yarn dev:dns` で Docker の DNS サイドカーを起動してください
- 権限付きで backend 自体を `53` へ bind したい場合は `LAB_CORE_DNS_PORT=53` を明示してください

## 開発
1. `yarn install`
2. ルートで `yarn config:init`（`core/backend/.env` を対話生成）
3. `yarn workspace @lab-core/backend dev`
4. hostname 解決が必要なら `yarn dev:dns`
5. HTTP 受け口が必要なら `yarn dev:proxy`

## 保守
- 全初期化 preview: `yarn maintenance:reset`
- 全初期化実行: `yarn maintenance:reset:yes`
- 先に backend / dashboard のローカル起動を止めるのが推奨
- どうしても止めずに実行する場合は `yarn maintenance:reset --yes --force`
- DB/生成物/runtime/Docker を削除するが、`core/backend/.env` は残す

## .env 読込
- backend 起動時に `core/backend/.env` を自動読込します
- 既存の OS 環境変数がある場合は、そちらを優先します
