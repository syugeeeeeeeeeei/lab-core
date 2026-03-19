# ローカル開発環境セットアップ

最終更新: 2026-03-19

## 1. この手順の対象

この手順は、1 台の開発マシン上で Lab-Core を起動し、ブラウザから確認しながら開発するためのセットアップです。

この手順で想定する値:

- 実行マシン: 自分の開発 PC
- 到達先 IP: `127.0.0.1`
- ルートドメイン: `lab.localhost`
- ダッシュボード URL: `http://dashboard.lab.localhost/`
- API 確認 URL: `http://api.lab.localhost/api`

## 2. 前提条件

以下が入っていることを前提にします。

- `git`
- `node`
- `yarn@1.22.22`
- `docker`
- `docker compose`

確認コマンド:

```bash
node -v
yarn -v
docker -v
docker compose version
```

補足:

- `yarn dev` は Docker を使って backend / dashboard / proxy / DNS をまとめて起動します。
- `execute` モードで実アプリを起動する場合、backend コンテナはホストの `/var/run/docker.sock` を利用します。
- rootless Docker などでソケット場所が異なる場合は、この標準手順ではなく compose の調整が必要です。

## 3. 初回セットアップ

### 3.1 リポジトリを取得

```bash
git clone <this-repository-url>
cd lab-core
```

### 3.2 依存を入れる

```bash
yarn install
```

### 3.3 `.env` を作る

```bash
yarn config:init
```

対話画面では次のように進めます。

1. プロファイルで `local` を選ぶ
2. 基本は Enter 連打で推奨値を採用する
3. 保存確認で `yes` を入力する

`local` プロファイルの主な値:

- `LAB_CORE_EXECUTION_MODE=dry-run`
- `LAB_CORE_MAIN_SERVICE_IP=127.0.0.1`
- `LAB_CORE_SSH_SERVICE_IP=127.0.0.1`
- `LAB_CORE_ROOT_DOMAIN=lab.localhost`
- `LAB_CORE_DNS_BIND_HOST=127.0.0.1`
- `LAB_CORE_DNS_PORT=1053`

確認ファイル:

- `core/backend/.env`

## 4. 起動

### 4.1 標準起動

```bash
yarn dev
```

このコマンドで次が起動します。

- backend
- dashboard
- local proxy
- local DNS

### 4.2 停止

```bash
yarn dev:kernel:down
```

### 4.3 ログ確認

```bash
yarn dev:core:logs
yarn dev:proxy:logs
yarn dev:dns:logs
```

## 5. アクセス確認

起動後、次を確認します。

### 5.1 ダッシュボード

ブラウザで以下を開きます。

```text
http://dashboard.lab.localhost/
```

開いたら確認すること:

- ホーム画面が表示される
- 右上に実行モードが表示される
- DNS カードに待受情報が出る

### 5.2 API

ブラウザまたは curl で以下を確認します。

```bash
curl http://api.lab.localhost/api
curl http://api.lab.localhost/health
```

### 5.3 生成物

次のファイルが作られることを確認します。

- `core/backend/data/generated/Caddyfile`
- `core/backend/data/generated/Caddyfile.dev`
- `core/backend/data/generated/fukaya-sus.hosts`

補足:

- `hosts` ファイル名は `fukaya-sus.hosts` ですが、内容は現在の `LAB_CORE_ROOT_DOMAIN` に従って生成されます。

## 6. 実アプリを動かしたい場合

`local` プロファイルのままだと `dry-run` です。実際に Git clone / docker compose を動かすなら `execute` に切り替えます。

方法:

1. `yarn config:reset`
2. `local` を選ぶ
3. `LAB_CORE_EXECUTION_MODE` だけ `execute` に変更する
4. 保存後に `yarn dev:kernel:down`
5. `yarn dev`

確認:

- ダッシュボード右上が `execute`
- アプリ登録後に Docker コンテナが実際に起動する

## 7. よく使う確認コマンド

```bash
docker ps
docker compose -f infra/compose/docker-compose.dev.yml ps
cat core/backend/.env
```

## 8. 開発時に触ることが多いファイル

- 設定: `core/backend/.env`
- backend: `core/backend/src`
- dashboard: `core/dashboard/src`
- DNS/Proxy 生成物: `core/backend/data/generated`

## 9. ローカル開発で詰まりやすい点

### 9.1 `dashboard.lab.localhost` が開けない

確認:

- `yarn dev` が起動しているか
- `yarn dev:dns` が起動しているか
- `yarn dev:proxy` が起動しているか

補足:

- `yarn dev` は内部でそれらも起動します
- 失敗した場合は個別ログで原因を見ます

### 9.2 53 番ポート競合

症状:

- `yarn dev:dns` が 53 番 bind に失敗する

確認候補:

- ローカル DNS サービス
- 他の開発用 DNS

対処:

1. 競合プロセスを止める
2. `yarn dev:dns`
3. それでも難しければ、ローカルではドメイン検証を後回しにして API / dashboard の個別起動を使う

### 9.3 `execute` でアプリ起動に失敗する

確認:

- `docker ps` がホストで動くか
- `/var/run/docker.sock` が存在するか
- 対象リポジトリに compose があるか

## 10. 個別起動に戻したい場合

次の旧来コマンドも使えます。

```bash
yarn dev:backend
yarn dev:dashboard
```

この場合の確認先:

- dashboard: `http://localhost:5173/`
- backend: `http://localhost:7300/health`

ただし、現在の推奨は `yarn dev` です。
