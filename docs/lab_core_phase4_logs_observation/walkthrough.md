# Walkthrough: Phase 4 ログ監視導線 実装結果

## 変更概要
- `application-logs.ts` を追加し、アプリ単位ログ取得を実装
- `GET /api/logs/:applicationId/services` と `GET /api/logs/:applicationId` を追加
- Dashboard に「ログ」ボタンを追加
- ログビューアを追加（サービス切替、表示行数、手動更新、自動スクロール）
- ログ行の warning/error を色で強調表示
- 説明書へログ操作手順とユーザーテストを追記

## 重要な設計意図
- 既存の一覧画面から離脱せずに障害確認できることを優先
- `dry-run` では system events を整形して返し、導線テストを止めない
- `execute` では `docker compose logs` を呼び出し実ログを返す

## 現時点の制約
- ログのリアルタイムストリーム（tail -f 相当）は未実装
- コンテナ単位の詳細メタデータ（CPU/メモリ）は対象外
- 実機でのログ量制御は `tail` の範囲（100〜1000行）に限定

## 併行ドキュメント更新
- `docs/readmes/how_to_use_lab_core.md` に
  - ログ確認手順（Phase 4）
  - ユーザーテストE（ログ確認）
  を追加
