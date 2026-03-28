# 修正内容の確認

## 原因

- `yarn dev` は内部で `docker compose` の `deps` / `backend` / `dashboard` サービスを起動する。
- これらのサービスは `node:20-alpine` の既定 `yarn`（`1.22.22`）を直接呼んでいたため、ホスト側と異なる Yarn が使われていた。

## 変更点

- `package.json`
  - `packageManager` を `yarn@4.13.0` に設定。
- `infra/compose/docker-compose.dev.yml`
  - `yarn ...` を `corepack yarn ...` に変更。
  - `deps` の install オプションを `--frozen-lockfile --non-interactive` から `--immutable` に変更。

## 確認結果

- `docker run --rm node:20-alpine sh -lc 'yarn --version'` は `1.22.22`（既定値）。
- `docker run --rm -v /home/multics/work/lab-core:/workspace -w /workspace node:20-alpine sh -lc 'corepack yarn --version'` は `4.13.0`。
- これにより、`yarn dev` 経路のコンテナ実行でも Yarn 4.13.0 を利用できる状態になった。
