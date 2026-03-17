# Task List: Phase 2 Runtime/Sync 実装

## 目的
Phase 1 の MVP に対して、ジョブ実処理と DNS/Proxy 同期機能を追加する。

## 実施タスク
- deploy/rebuild/delete/restart のジョブ処理サービス化
- dry-run / execute の実行モード導入
- DNS/Proxy 同期サービスと API 追加
- Dashboard に手動同期ボタンを追加
- 利用者向け説明書の追記

## 完了条件
- アプリ登録時に deploy ジョブが起動する
- 再起動/再ビルド/削除がジョブ経由で実行される
- `POST /api/infrastructure/sync` が動作する
- 説明書が最新機能を反映している
