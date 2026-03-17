# Walkthrough: Phase 5 更新適用 / 1世代ロールバック 実装結果

## 変更概要
- `application-jobs.ts` に `executeUpdateJob` と `executeRollbackJob` を追加
- commit 更新処理を整理（current/previous/update_info）
- `POST /api/applications/:id/update` を追加
- `POST /api/applications/:id/rollback` を追加
- `update-check` を dry-run で疑似比較できるように変更
- Dashboard に「更新適用」「ロールバック」ボタンを追加
- Dashboard 一覧に `current` / `prev` commit 表示を追加
- 説明書に Phase 5 の操作とユーザーテストを追記

## 重要な設計意図
- 失敗時の影響を抑えるため、更新とロールバックをジョブで直列実行する
- dry-run でも commit 差分を擬似生成し、導線テストの再現性を上げる
- previous commit がない場合は UI/API の両方でロールバックを拒否する

## 現時点の制約
- execute モードでの厳密なロールバック検証は実リポジトリが必要
- rollback は 1 世代のみ（current と previous のみ保持）
- rollback 後に default branch から外れた状態になるため、次回 update で branch 復帰する設計

## 併行ドキュメント更新
- `docs/readmes/how_to_use_lab_core.md` に
  - 更新適用（Phase 5）
  - 1世代ロールバック（Phase 5）
  - ユーザーテストE（更新適用とロールバック）
  を追加
