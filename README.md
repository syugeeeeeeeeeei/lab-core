# Lab-Core v3

研究室向け統合 Web アプリ配信・運用基盤の再構築リポジトリです。

## 構成
- `core/backend`: Hono + TypeScript + SQLite の API サーバー
- `core/dashboard`: React + Vite の運用ダッシュボード
- `infra/compose`: 開発用 compose 定義

## 開発開始
1. `yarn install`
2. 初回設定ウィザード: `yarn config:init`
3. ローカル開発なら `yarn dev`

## インストレーション要約

### ローカル開発（localhost / `lab.localhost`）

1. `yarn install`
2. `yarn config:init`
3. プロファイルで `local` を選ぶ
4. `yarn dev`
5. `http://dashboard.lab.localhost/` を開く

詳細手順:
- `docs/lab_core_system_documentation/setup_localhost.md`

### 本番環境（`192.168.11.224` / `fukaya-sus.lab`）

1. 本番ホストへリポジトリを配置
2. `yarn install`
3. `yarn config:init`
4. プロファイルで `lab` を選ぶ
5. `yarn lab:up`

6. `http://dashboard.fukaya-sus.lab/` を開く

詳細手順:
- `docs/lab_core_system_documentation/setup_production_192.168.11.224.md`

## 補足

- `yarn dev` は kernel 相当の起動を行い、backend / dashboard / proxy / DNS をまとめて立ち上げます。
- 本番向けの起動は `yarn lab:up` / `yarn lab:down` を使います。
- `.env` を残して runtime / DB / generated / 管理下 Docker 資産を初期化したい時は `yarn lab:down-clean` を使います。
- 本番のログ確認は `yarn lab:logs` を使うと backend / dashboard / proxy / DNS をまとめて追えます。
- API の主確認先は `http://api.<LAB_CORE_ROOT_DOMAIN>/api` です。
- 旧来の個別起動も必要なら利用できます。
  - `yarn dev:backend`
  - `yarn dev:dashboard`

## 検証コマンド
- ビルド確認: `yarn build`
- 登録テスト値投入: `yarn test:register-fixtures`
- 網羅スモークテスト: `yarn test:smoke`

## 設定コマンド
- 設定を対話形式で作成: `yarn config:init`
- 設定を安全に再作成: `yarn config:reset`

## ドキュメント
- 総合ドキュメント入口: `docs/lab_core_system_documentation/index.md`
- ローカル開発セットアップ: `docs/lab_core_system_documentation/setup_localhost.md`
- 本番セットアップ: `docs/lab_core_system_documentation/setup_production_192.168.11.224.md`
- kernel 構成案: `docs/lab_core_system_documentation/kernel_architecture.md`
- ダッシュボード詳細マニュアル: `docs/lab_core_system_documentation/user_manual.md`
- 既存の操作説明書: `docs/readmes/how_to_use_lab_core.md`
- 適合アプリ作成ガイド: `docs/lab_core_app_repository_guide/app_repository_creation_guide.md`
