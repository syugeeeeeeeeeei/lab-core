# Lab-Core v3 適合アプリリポジトリ作成ガイド

最終更新: 2026-03-18  
対象: Lab-Core v3（現行実装）に新規アプリを載せる開発者

## 1. このガイドの目的
この文書は、Lab-Core v3 に安全に載せられるアプリリポジトリを、最短で作るための指南書です。  
「登録は通ったが起動しない」「再ビルドで壊れる」「ログが見えない」を防ぐことを目的にしています。

## 2. 先に押さえる適合条件（必須）
Lab-Core が登録・起動できるために、最低限次を満たしてください。

1. Git で clone 可能なリポジトリである
2. `docker compose -f <composePath> up -d --build` が成功する
3. 公開対象サービス名（`publicServiceName`）が compose 上に存在する
4. 公開対象ポート（`publicPort`）で HTTP を listen する
5. `docker compose ... restart`, `down`, `logs` が通る
6. 標準出力/標準エラーにログが出る

## 3. 推奨リポジトリ構成
```text
my-app/
├── docker-compose.yml
├── Dockerfile
├── .dockerignore
├── .env.example
├── README.md
└── src/...
```

## 4. `docker-compose.yml` の作り方（最重要）
Lab-Core は compose を直接実行します。  
次の 5 点を意識してください。

1. 公開対象サービス名を固定する（例: `web`, `api`, `oruca-web`）
2. アプリ内部の listen ポートを明示する（例: `3000`）
3. 必要なら `healthcheck` を付ける
4. 再ビルド/再起動で壊れないよう依存サービスを同じ compose に含める
5. 永続データはコンテナ外へ切り出す

### 4.1 Standard Web の例
```yaml
services:
  web:
    build:
      context: .
      dockerfile: Dockerfile
    restart: unless-stopped
    environment:
      NODE_ENV: production
      PORT: "3000"
    expose:
      - "3000"
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:3000/health"]
      interval: 30s
      timeout: 5s
      retries: 3
```

登録時の対応値:
- `publicServiceName`: `web`
- `publicPort`: `3000`
- `mode`: `standard`

### 4.2 Headless API の例
```yaml
services:
  api:
    build: .
    restart: unless-stopped
    environment:
      PORT: "8080"
    expose:
      - "8080"
```

登録時の対応値:
- `publicServiceName`: `api`
- `publicPort`: `8080`
- `mode`: `headless`

### 4.3 データ永続化の例（appdata 分離）
`LAB_CORE_APPS_ROOT=./runtime/apps` と `LAB_CORE_APPDATA_ROOT=./runtime/appdata` のとき、  
clone 先（`runtime/apps/<app>`）から見て `../../appdata/<app>` を使うと、データをソース外に置けます。

```yaml
services:
  web:
    volumes:
      - ${APPDATA_ROOT:-../../appdata/my-app}:/var/lib/my-app
```

## 5. デバイス要件（NFC/USB が必要な場合）
ホストデバイスが必要なアプリは、compose と登録値を両方そろえます。

compose 例:
```yaml
services:
  oruca-web:
    devices:
      - "/dev/bus/usb:/dev/bus/usb"
```

登録時の `deviceRequirements` 例:
- `/dev/bus/usb`

## 6. Dockerfile の基本方針
1. 本番起動コマンドを固定する
2. コンテナ起動時に build しない（依存は build 時に入れる）
3. ログは stdout/stderr に出す
4. 起動に必要な環境変数だけを必須にする

Node.js 例:
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production=false
COPY . .
RUN yarn build
CMD ["node", "dist/index.js"]
```

## 7. リポジトリ README に必ず書く項目
1. 公開対象サービス名と公開ポート
2. `docker compose up -d --build` の実行方法
3. 必須環境変数と例
4. 永続データの保存先
5. デバイス要件の有無
6. 障害時の確認コマンド（logs, restart, down/up）

## 8. 登録前の自己チェック（コピペ用）
```bash
# 1) サービス名が拾えるか
docker compose -f docker-compose.yml config --services

# 2) 起動できるか
docker compose -f docker-compose.yml up -d --build

# 3) ログが標準出力に出るか
docker compose -f docker-compose.yml logs --no-color --tail 200

# 4) 再起動できるか
docker compose -f docker-compose.yml restart

# 5) 停止できるか（データ保持）
docker compose -f docker-compose.yml down
```

## 9. Lab-Core への登録値テンプレート
```json
{
  "name": "my-app",
  "description": "Lab-Core 適合アプリ",
  "repositoryUrl": "https://github.com/<org>/<repo>",
  "defaultBranch": "main",
  "composePath": "docker-compose.yml",
  "publicServiceName": "web",
  "publicPort": 3000,
  "hostname": "my-app.fukaya-sus.lab",
  "mode": "standard",
  "keepVolumesOnRebuild": true,
  "deviceRequirements": []
}
```

## 10. よくある失敗パターン
1. `publicServiceName` と compose のサービス名が不一致
2. `publicPort` がアプリの listen ポートと不一致
3. ログをファイルにしか出しておらず、UI で見えない
4. compose がローカル専用（本番で使わない profile 前提）
5. 再ビルド時に消えて困るデータをコンテナ内だけに保持

## 11. 受け入れ判定チェックリスト
以下をすべて満たせば、Lab-Core 適合リポジトリとして受け入れ可能です。

1. 登録が成功し deploy ジョブが `succeeded`
2. 再起動ジョブが `succeeded`
3. 再ビルド（keepData=true）が `succeeded`
4. 更新確認が成功する
5. ログ画面でサービス一覧とログ本文が取得できる
6. 削除（config_only）が成功する

## 12. OruCa 系アプリ向け追記事項
1. NFC デバイスマウントを compose で宣言する
2. `deviceRequirements` に同じパスを入力する
3. Slack トークン等の永続設定は appdata 側に逃がす
4. 再起動後に学生証読み取り機能が維持されることを確認する

