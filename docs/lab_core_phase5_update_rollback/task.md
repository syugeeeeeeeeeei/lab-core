# Task List: Phase 5 更新適用 / 1世代ロールバック

## 目的
仕様の Must 要件である「更新適用」と「1世代ロールバック」を運用導線として実装する。

## 実施タスク
- バックエンドに update ジョブ実行を追加
- バックエンドに rollback ジョブ実行を追加
- `POST /api/applications/:id/update` 追加
- `POST /api/applications/:id/rollback` 追加
- `update-check` を dry-run でも利用できるよう補強
- Dashboard に更新適用/ロールバックボタンを追加
- current/previous commit を一覧に表示
- 説明書とユーザーテスト手順を更新

## 完了条件
- UI から更新適用ジョブを開始できる
- UI から1世代ロールバックジョブを開始できる
- previous commit がない場合はロールバックを防止できる
- 説明書が Phase 5 の操作を反映している
