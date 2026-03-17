# トラブルシューティング

最終更新: 2026-03-18

## 1. backend が起動しない
症状:
`listen EPERM` やポート競合エラーで `yarn dev:backend` が失敗する

確認:
- 他プロセスが同じポートを使っていないか
- `LAB_CORE_PORT` が利用可能な値か

対処:
1. `yarn config:reset` でポートを変更
2. 再起動して `GET /health` を確認

## 2. Dashboard から API に接続できない
症状:
画面に読み込み失敗が出る

確認:
- backend が起動しているか
- Dashboard の API 接続先（`VITE_API_BASE_URL`）が正しいか

対処:
1. `yarn dev:backend` を起動
2. `http://localhost:7300/health` が成功することを確認
3. 必要なら `VITE_API_BASE_URL` を修正して dashboard を再起動

## 3. 登録時に「同じアプリ名またはホスト名が既に登録」
原因:
`applications.name` または `deployments.hostname` の一意制約

対処:
1. 別名/別ホスト名で登録
2. 既存不要アプリを削除して再登録
3. テスト時は「登録テスト値」機能を利用

## 4. `execute` なのにコンテナが動かない
症状:
ジョブ失敗、またはコンテナが見えない

確認:
- Docker が起動しているか
- `LAB_CORE_DOCKER_SOCKET` が正しいか
- 対象リポジトリに compose ファイルがあるか

対処:
1. `docker ps` が実行できることを確認
2. `.env` のソケットパスを見直す
3. イベント欄の失敗メッセージを確認

## 5. 再起動/再ビルドが失敗する
原因候補:
- アプリソースが `LAB_CORE_APPS_ROOT/<appName>` にない
- compose パスが誤っている

対処:
1. 一度アプリ削除（構成のみ）して再登録
2. `composePath` が正しいか確認
3. 失敗イベントの詳細を確認

## 6. ロールバックできない
症状:
「ロールバック可能な1つ前のコミットがありません。」

原因:
`previous_commit` が未設定（更新適用前など）

対処:
1. 先に更新適用を実行
2. その後ロールバックを再実行

## 7. ログが空、または期待したログでない
確認:
- `dry-run` では実ログでなく疑似ログ（イベント由来）
- `execute` では compose ログを取得

対処:
1. 実ログ確認が必要なら `execute` に切替
2. サービス選択と表示行数を調整

## 8. DNS/Proxy 同期しても反映されない
確認:
- アプリ/route が `enabled=1` か
- 生成先パスが `.env` で正しいか

対処:
1. 「DNS/Proxy 同期」を再実行
2. 生成ファイルを確認
   - `core/backend/data/generated/Caddyfile`
   - `core/backend/data/generated/fukaya-sus.hosts`
3. 必要なら `.env` の生成先設定を修正

## 9. `.env` 編集が怖い
推奨:
手編集せず対話型コマンドを使う

対処:
1. `yarn config:init` で新規作成
2. `yarn config:reset` で再作成
3. 保存前プレビューで内容確認

## 10. スモークテストが失敗する
確認:
- backend 起動可否
- `yarn test:smoke` 実行時のログ
- `core/backend/data/generated` への書き込み可否

対処:
1. `yarn build` を先に通す
2. `yarn test:smoke` を再実行
3. `/tmp/lab_core_backend_full_smoke.log` を確認

## 11. DB を初期化したい
方法:
1. backend 停止
2. `core/backend/data/database.sqlite` を退避または削除
3. backend 再起動でスキーマ再作成

注意:
DB 初期化は登録情報と履歴が失われるため、必要に応じてバックアップしてから実施

