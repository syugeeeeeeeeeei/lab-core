# Kernel Architecture Draft

## 目的

`backend` と `dashboard` を直接の基盤として扱うのではなく、その下に滅多に更新しない `kernel` を置きます。

この `kernel` は以下だけを担います。

- DNS
- reverse proxy
- 起動監督
- 永続データ配置
- 生成設定の保持
- control-plane 配布先ドメインの予約

`backend` と `dashboard` は `kernel` の上で動く更新可能な control-plane とします。

## 役割分担

### Kernel

- `infra/compose/docker-compose.proxy.yml`
- `infra/compose/docker-compose.dns.yml`
- `infra/compose/docker-compose.dev.yml`
- `core/backend/data/generated/*`
- `runtime/apps`
- `runtime/appdata`

責務:

- `dashboard.<rootDomain>` と `api.<rootDomain>` を名前解決可能にする
- HTTP の入口を固定する
- control-plane をまとめて起動停止する
- アプリ公開用の DNS/Proxy 生成物を保持する

### Control-Plane

- `core/backend`
- `core/dashboard`

責務:

- アプリ登録、配備、更新、監視
- UI 提供
- 生成設定の更新

## 現段階の実装方針

第一段として、以下を採用します。

- `yarn dev` は `kernel` 起動に寄せる
- `backend` と `dashboard` は compose で同時起動する
- `dashboard.<rootDomain>` から dashboard にアクセスできる
- `api.<rootDomain>` から backend にアクセスできる
- `dashboard.<rootDomain>/api` も backend に到達できる

これにより、開発時のアクセス入口を `localhost:5173` 依存から外します。

## 次段でやること

- `kernel` 専用 compose の分離
- `backend` / `dashboard` のバージョン切替手順の明文化
- control-plane 自身の更新ジョブ
- control-plane 障害時でも DNS/Proxy が残る構成への固定
