# Walkthrough: Bootstrap Phase 1 実装結果

## 追加したもの
- `core/backend`: Hono + SQLite の API サーバー
- `core/dashboard`: React + Vite の日本語管理 UI
- `infra/compose/docker-compose.dev.yml`: 開発起動用
- ルート `package.json`: yarn workspace 設定

## Backend の要点
- 起動時に SQLite スキーマを自動作成
- `applications`, `deployments`, `routes`, `system_events`, `jobs`, `update_info` を実装
- API で以下を提供:
  - アプリ登録/一覧/詳細
  - 再起動/再ビルド/更新確認
  - ジョブ一覧/イベント一覧/システム状態

## Dashboard の要点
- 完全日本語 UI
- 登録フォームから API 駆動でアプリ追加
- アプリ一覧から再起動・再ビルド・更新確認
- 最近のイベントを時系列表示

## 現時点の制約
- Build/Deploy の本処理はまだ stub（Job 管理は先行実装）
- Docker コンテナ実体の自動検出は未実装
- DNS/Proxy の実同期処理は次フェーズ
