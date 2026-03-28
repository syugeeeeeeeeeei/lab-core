# 実装計画

1. 現状調査
- `.yarnrc.yml`、`package.json`、`infra/compose/docker-compose.dev.yml` を確認し、Yarn 実行主体を特定する。
- `node:20-alpine` コンテナ内の既定 `yarn` バージョンを確認する。

2. 修正方針
- 開発コンテナ内で `yarn` を直接呼ばず、`corepack yarn` を使用する。
- ルート `package.json` に `packageManager: "yarn@4.13.0"` を設定し、Corepack の解決先を固定する。

3. 実装
- `infra/compose/docker-compose.dev.yml` の `deps` / `backend` / `dashboard` コマンドを `corepack yarn` に変更する。
- `deps` の install オプションを Yarn 4 に合わせて `--immutable` に変更する。

4. 検証
- 修正後の差分を確認する。
- コンテナ内で `corepack yarn --version` を実行し、`4.13.0` になることを確認する。
