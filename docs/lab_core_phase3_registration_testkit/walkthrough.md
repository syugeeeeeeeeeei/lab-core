# Walkthrough: Phase 3 登録テスト導線整備 実装結果

## 変更概要
- バックエンドに `GET /api/testing/registration-fixtures` を追加
- テスト値3種類（OruCa想定 / シンプルWeb / Headless API）を追加
- Dashboard に「登録テスト値」選択と「テスト値を入力」を追加
- テスト値適用時にアプリ名・サブドメインへ時刻サフィックスを自動付与
- Dashboard に削除確認パネル（削除モード + 確認用アプリ名）を追加
- `scripts/testing/register_app_fixtures.sh` を追加
- root script `yarn test:register-fixtures` を追加
- 説明書に Phase 3 手順を追記

## 重要な設計意図
- テスト値を固定せずサフィックス付与することで、繰り返し試験に強くした
- fixture API 失敗時は dashboard 側のローカル fixture にフォールバックし、テスト導線を止めない
- 削除は二重確認を前提にし、誤操作を減らす

## 現時点の制約
- fixture の Git URL はダミー値（`example/*`）
- `dry-run` モードでは Docker/Git 実処理は行わない
- 削除モードに応じたファイル実削除の本格連携は execute 運用で確認が必要

## 併行ドキュメント更新
- `docs/readmes/how_to_use_lab_core.md` に
  - テスト値入力手順
  - 一括登録スクリプト手順
  - 削除確認手順
  - ユーザーテスト（A〜F）
  を追加
