# トラブルシューティング

最終更新: 2026-03-19

## 1. backend が起動しない
症状:
`listen EPERM` やポート競合エラーで backend が失敗する

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
1. `yarn dev` を起動
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
- 使っている hostname が内蔵 DNS または外部 DNS で名前解決できるか
- backend の DNS サーバーが `.env` のポートで待受できているか
- ローカル開発なら `yarn dev` が起動しているか
- 個別起動しているなら `yarn dev:dns` と `yarn dev:proxy` が起動しているか

対処:
1. 「DNS/Proxy 同期」を再実行
2. 生成ファイルを確認
   - `core/backend/data/generated/Caddyfile`
   - `core/backend/data/generated/fukaya-sus.hosts`（Lab-Core の DNS レコード生成物。OS の `/etc/hosts` ではない）
3. ホーム画面の DNS サーバーカード、または `GET /api/system/status` の `dnsServer` を確認
4. `listen EACCES` の場合は backend を `1053` で動かし、`yarn dev:dns` で `127.0.0.1:53` を公開する
5. `connect ECONNREFUSED 127.0.0.1:80` の場合は `yarn dev:proxy` を起動し、必要なら `yarn dev:proxy:refresh` を実行する
6. 外部 DNS を使う運用なら、生成された DNS レコードファイルをその DNS に反映する

## 8.1 `DNS Resolution Failed ... ECONNREFUSED`
症状:
ブラウザで次のような表示になる

`DNS Resolution Failed for "<host>"`

`Reason: queryA ECONNREFUSED <host>`

原因:
- backend の内蔵 DNS は `1053` で動いているが、`127.0.0.1:53` の前段 relay がいない
- つまり `yarn dev:dns` が未起動、または停止している

確認:
1. ホーム画面の DNS カードを見る
2. `待受中: 127.0.0.1:1053 / 53番は yarn dev:dns` と出ているか確認
3. あわせて `53番前段: 未応答` が出ていないか確認

対処:
1. `yarn dev:dns`
2. 必要なら `yarn dev:dns:logs`
3. 再度ブラウザから hostname を開く

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

## 12. 開発環境を全部初期化したい
方法:
1. preview: `yarn maintenance:reset`
2. 問題なければ実行: `yarn maintenance:reset:yes`
3. backend / dashboard / DNS / proxy を必要に応じて再起動

補足:
- backend / dashboard を止めた状態で実行するのが推奨
- どうしても止めずに実行する場合は `yarn maintenance:reset --yes --force`

内容:
- SQLite DB と `-wal` / `-shm`
- `core/backend/data/generated`
- `runtime/apps`
- `runtime/appdata`
- Lab-Core 管理下の Docker コンテナ / network / volume

保持:
- `core/backend/.env`
- git 管理下のソースコード

## 13. compose inspection の YAML が期待と違う
症状:
- branch は合っているように見えるが、inspection dialog の raw YAML が GitHub 上の内容と一致しない

確認:
1. `source.kind`, `source.repositoryUrl`, `source.branch`, `selectedComposePath` を dialog で確認
2. tree URL の branch が `dev/new-arch` など slash を含む場合、branch が潰れていないか確認

対処:
1. backend を再起動して最新コードを反映
2. 再起動後に inspection dialog を再度開く
3. GitHub API の rate limit に当たる場合は、Lab-Core は fallback clone に切り替える
