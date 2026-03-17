# Lab-Core v3

研究室向け統合 Web アプリ配信・運用基盤の再構築リポジトリです。

## 構成
- `core/backend`: Hono + TypeScript + SQLite の API サーバー
- `core/dashboard`: React + Vite の運用ダッシュボード
- `infra/compose`: 開発用 compose 定義

## 開発開始
1. `yarn install`
2. 初回設定ウィザード: `yarn config:init`
3. `yarn dev:backend`
4. 別ターミナルで `yarn dev:dashboard`

## 検証コマンド
- ビルド確認: `yarn build`
- 登録テスト値投入: `yarn test:register-fixtures`
- 網羅スモークテスト: `yarn test:smoke`

## 設定コマンド
- 設定を対話形式で作成: `yarn config:init`
- 設定を安全に再作成: `yarn config:reset`

## ドキュメント
- 総合ドキュメント入口: `docs/lab_core_system_documentation/index.md`
- 既存の操作説明書: `docs/readmes/how_to_use_lab_core.md`
