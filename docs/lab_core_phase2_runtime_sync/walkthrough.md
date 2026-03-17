# Walkthrough: Phase 2 Runtime/Sync 実装結果

## 変更概要
- `application-jobs.ts` を追加し、deploy/rebuild/restart/delete をジョブ実行化
- `command-runner.ts` を追加し、`dry-run`/`execute` の切替を実装
- `infrastructure-sync.ts` を追加し、Caddy/DNS の生成ファイル同期を実装
- `POST /api/infrastructure/sync` を追加
- Dashboard に「DNS/Proxy 同期」ボタンと実行モード表示を追加

## 重要な設計意図
- API はジョブ起動後すぐ返す（`202`）ことで UI の応答を維持
- 初期運用では `dry-run` で手順検証を優先
- 実機連携前に、同期内容をファイルで可視化できるようにした

## 現時点の制約
- 生成した Caddy/DNS ファイルの「実プロセス反映」は未実装
- dashboard からの削除操作 UI は次フェーズ
- docker compose 実処理は `execute` モードでのみ有効

## 併行ドキュメント更新
- `docs/readmes/how_to_use_lab_core.md` に操作手順を追記
- 同ファイルに「ユーザーテスト手順（A〜D）」を追加
