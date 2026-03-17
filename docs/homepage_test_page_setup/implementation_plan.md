# 実装計画 (Implementation Plan)

## 1. 目的
`homepage_test.xxx.lab` 用のテストページを、Lab-Core に載せられる形で作成する。

## 2. 実装方針
- フロントエンドは Vite + React + TypeScript
- コンテナ内で `yarn build` して静的ファイルを生成
- Nginx で `8080` 配信
- アプリ compose に `networks` / `labels` を書かず、Lab-Wire 自動接続を前提とする

## 3. 成果物
- `examples/homepage_test` のアプリ本体
- `examples/homepage_test/Dockerfile`
- `examples/homepage_test/docker-compose.yml`
- `examples/homepage_test/README.md`
