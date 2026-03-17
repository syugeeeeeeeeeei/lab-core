# Lab-Core Backend (MVP)

## 実装済み範囲
- Hono ベースの API サーバー
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
- `DELETE /api/applications/:applicationId`
- `GET /api/jobs`
- `GET /api/events`
- `POST /api/infrastructure/sync`
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
- `LAB_CORE_DNS_HOSTS_PATH`: 同期時に生成する DNS hosts

## 開発
1. `yarn install`
2. `yarn workspace @lab-core/backend dev`
