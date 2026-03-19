# Lab-Core v3 システムドキュメント（実装準拠）

最終更新: 2026-03-19

このフォルダは、現在の Lab-Core v3 実装を前提にした運用ドキュメントです。  
「理想仕様」ではなく「いま実際に動く挙動」を基準に整理しています。

## 読み方（推奨順）
1. [ローカル開発セットアップ](./setup_localhost.md)
2. [本番セットアップ（192.168.11.224）](./setup_production_192.168.11.224.md)
3. [要件とスコープ](./requirements_and_scope.md)
4. [システム仕様](./system_specification.md)
5. [機能カタログ](./feature_catalog.md)
6. [使い方ガイド](./user_manual.md)
7. [トラブルシューティング](./troubleshooting.md)

## どの資料を見ればよいか
- 全体像を知りたい: `requirements_and_scope.md`
- 初期設定したい:
  - ローカル開発は `setup_localhost.md`
  - 本番は `setup_production_192.168.11.224.md`
- API やデータ構造を知りたい: `system_specification.md`
- 何が実装済みかを確認したい: `feature_catalog.md`
- 実際に操作したい: `user_manual.md`
  - ダッシュボードの画面構成、登録フロー、進捗確認、ログ確認、削除まで含みます
- 困りごとを解決したい: `troubleshooting.md`

## 関連資料
- 適合アプリの作り方: `../lab_core_app_repository_guide/app_repository_creation_guide.md`
