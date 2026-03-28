# タスク

- ダッシュボードからアプリ削除時に `docker-compose.yml` 不在で失敗する問題を調査する。
- `runtime/apps/<app>/docker-compose.yml` が存在しない状態でも削除を完了できるようにする。
- 影響範囲を最小限にして削除ジョブの堅牢性を上げる。
