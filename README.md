# Lab-Core v3

研究室向け統合 Web アプリ配信・運用基盤の再構築リポジトリです。

## 構成
- `core/backend`: Hono + TypeScript + SQLite の API サーバー
- `core/dashboard`: React + Vite の運用ダッシュボード
- `infra/compose`: 開発用 compose 定義

## 開発開始
1. `yarn install`
2. `yarn dev:backend`
3. 別ターミナルで `yarn dev:dashboard`

## 検証コマンド
- ビルド確認: `yarn build`
- 登録テスト値投入: `yarn test:register-fixtures`
- 網羅スモークテスト: `yarn test:smoke`
