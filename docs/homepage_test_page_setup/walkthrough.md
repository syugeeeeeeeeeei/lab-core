# 修正内容の確認 (Walkthrough)

## 1. 追加物
- `examples/homepage_test` 一式（Vite + React + TS）
- Docker build + Nginx 配信用設定
- Dockge投入を想定した compose 定義

## 2. 配信仕様
- コンテナ名: `homepage-test`
- 配信ポート: `8080`（コンテナ内部）
- Compose は `expose: 8080` のみ（ホスト直バインドなし）

## 3. 想定運用
- Dockge 起動後に Lab-Wire が `lab-bridge` へ自動接続
- Nginx Proxy Manager で `homepage_test.xxx.lab -> homepage-test:8080`
