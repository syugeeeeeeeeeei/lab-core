# 本番環境セットアップ（192.168.11.224）

最終更新: 2026-03-19

## 1. この手順の対象

この手順は、`192.168.11.224` を Lab-Core の到達先として使う研究室運用向け手順です。

この手順で想定する値:

- 本体ホスト: `192.168.11.224`
- SSH 用別 IP: `192.168.11.225`
- ルートドメイン: `fukaya-sus.lab`
- ダッシュボード URL: `http://dashboard.fukaya-sus.lab/`
- API 確認 URL: `http://api.fukaya-sus.lab/api`

## 2. 先に理解しておくこと

現在の実装では、backend / dashboard は更新されやすい control-plane、DNS / proxy / 起動導線は kernel 的な土台として扱います。

このリポジトリでの第一段の現実的な構成:

- `yarn dev` で control-plane と kernel 補助コンテナをまとめて起動
- `dashboard.<rootDomain>` と `api.<rootDomain>` は proxy 経由で配信
- アプリ公開用の DNS / proxy 設定は backend が生成

注意:

- これは「現在の実装で運用できる手順」です
- systemd や専用 production compose に完全分離された最終形ではありません

## 3. 前提条件

本番ホストに以下が必要です。

- Linux ホスト
- `git`
- `node`
- `yarn@1.22.22`
- `docker`
- `docker compose`
- `/var/run/docker.sock`

開放または利用する主なポート:

- `80/tcp`
- `53/tcp`
- `53/udp`
- `7300/tcp`
- `5173/tcp`

補足:

- 利用者向け公開は通常 `80` と `53` が中心です
- `7300` と `5173` は保守確認用として扱うのが安全です

## 4. 配置場所

本番ホスト上で、以下のように配置する前提で説明します。

```text
/opt/lab-core
```

例:

```bash
sudo mkdir -p /opt/lab-core
sudo chown "$USER":"$USER" /opt/lab-core
cd /opt/lab-core
git clone <this-repository-url> .
```

## 5. 初回セットアップ

### 5.1 依存を入れる

```bash
cd /opt/lab-core
yarn install
```

### 5.2 `.env` を作る

```bash
yarn config:init
```

対話画面では次のように進めます。

1. プロファイルで `lab` を選ぶ
2. 基本は Enter で推奨値を採用する
3. 保存確認で `yes` を入力する

`lab` プロファイルの主な値:

- `LAB_CORE_EXECUTION_MODE=execute`
- `LAB_CORE_MAIN_SERVICE_IP=192.168.11.224`
- `LAB_CORE_SSH_SERVICE_IP=192.168.11.225`
- `LAB_CORE_ROOT_DOMAIN=fukaya-sus.lab`
- `LAB_CORE_DNS_BIND_HOST=0.0.0.0`
- `LAB_CORE_DNS_PORT=53`
- アプリ配置先や生成物は現在の実装に合わせてリポジトリ直下の `runtime/` と `core/backend/data/generated/` を使う

確認ファイル:

- `core/backend/.env`

## 6. 起動

### 6.1 研究室向け起動

`proxy` と `dns` は既定だと loopback bind なので、本番では `0.0.0.0` bind を付けたラッパーコマンドを使います。

```bash
cd /opt/lab-core
yarn lab:up
```

注意:

- `sudo yarn lab:up` は使わず、通常ユーザーで実行します
- もし過去の実行で権限が崩れている場合は、先に `yarn permissions:repair` を 1 回実行します

このコマンドで起動するもの:

- backend
- dashboard
- proxy
- DNS

補足:

- 旧名の `yarn dev:lab` / `yarn dev:lab:down` / `yarn dev:lab:logs` も互換用に残しています
- 既存の `.env` が旧 wizard 由来で `/opt/lab-core/apps` や `/opt/lab-core/core/proxy/Caddyfile.generated` を指していても、現在は backend 側で互換変換されます

### 6.2 停止

```bash
cd /opt/lab-core
yarn lab:down
```

### 6.3 ログ確認

```bash
cd /opt/lab-core
yarn lab:logs
```

このコマンドは次をまとめて表示します。

- backend
- dashboard
- proxy
- DNS

## 7. 初期確認

### 7.1 ローカルホスト上での確認

本番ホスト自身でまず確認します。

```bash
curl http://127.0.0.1:7300/health
curl http://api.fukaya-sus.lab/api
curl http://dashboard.fukaya-sus.lab/
```

### 7.2 別端末からの確認

クライアント側の DNS 参照先を `192.168.11.224` に向けたうえで確認します。

開く URL:

- `http://dashboard.fukaya-sus.lab/`
- `http://api.fukaya-sus.lab/api`

### 7.3 生成物の確認

以下が更新されることを確認します。

- `core/backend/data/generated/Caddyfile`
- `core/backend/data/generated/Caddyfile.dev`
- `core/backend/data/generated/fukaya-sus.hosts`

## 8. 研究室ネットワークで必要なこと

### 8.1 DNS

`fukaya-sus.lab` を使うクライアントは、`192.168.11.224` を DNS サーバーとして参照できる必要があります。

確認例:

```bash
nslookup dashboard.fukaya-sus.lab 192.168.11.224
nslookup api.fukaya-sus.lab 192.168.11.224
```

### 8.2 HTTP

クライアントは `192.168.11.224:80` に到達できる必要があります。

### 8.3 SSH 用別名

`ssh.fukaya-sus.lab` は `LAB_CORE_SSH_SERVICE_IP` に従って生成されます。

## 9. 初回運用でやる確認

### 9.1 ダッシュボード

以下を確認します。

- ホーム画面が開く
- 実行モードが `execute`
- DNS カードに待受情報が出る

### 9.2 テストアプリ登録

1. ダッシュボードへ入る
2. `アプリ登録` タブを開く
3. `シンプルWeb` 相当の軽いアプリから登録する
4. ジョブ進行とイベントを確認する

### 9.3 Docker 側

```bash
docker ps
docker compose -f infra/compose/docker-compose.dev.yml ps
```

## 10. 本番でよく触るファイル

- 設定: `core/backend/.env`
- DB: `core/backend/data/database.sqlite`
- 生成物: `core/backend/data/generated`
- アプリソース: `runtime/apps`
- 永続データ: `runtime/appdata`

## 11. 本番向けの運用メモ

### 11.1 再起動

```bash
cd /opt/lab-core
yarn lab:down

yarn lab:up
```

### 11.2 更新前バックアップ

最低限退避したいもの:

- `core/backend/.env`
- `core/backend/data/database.sqlite`
- `runtime/appdata`
- `runtime/apps`

### 11.3 リポジトリ更新

```bash
cd /opt/lab-core
git pull
yarn install
```

更新後は kernel 一式を再起動します。

## 12. 本番で詰まりやすい点

### 12.1 別端末から `dashboard.fukaya-sus.lab` が開けない

確認:

- `yarn lab:up` で起動したか
- クライアントの DNS が `192.168.11.224` を見ているか
- `80/tcp` が閉じていないか

### 12.2 DNS は引けるがアプリが開けない

確認:

- proxy が起動しているか
- backend が生成物を更新できているか
- 対象アプリが `Running` か

### 12.3 `execute` でアプリ配備が失敗する

確認:

- ホストで `docker ps` が成功するか
- backend コンテナが Docker socket を読めるか
- 対象 GitHub リポジトリへアクセスできるか

## 13. 現時点の制約

現在の本番手順には次の制約があります。

- control-plane 専用の immutable イメージ運用にはなっていません
- systemd や専用 production compose に分離された最終形ではありません

ただし、`192.168.11.224` での実運用確認、ダッシュボードのドメイン配信、アプリ追加運用の土台としてはこの手順で揃えられます。
