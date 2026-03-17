# Task List: Lab-Core v3 新規基盤の実装開始

## 目的
Lab-Core v3 再構築を実際に着手し、運用基盤の最小実装をコードとして用意する。

## 実施タスク
- モノレポ構成を作成（backend/dashboard）
- Backend MVP（Hono + SQLite + API）を実装
- Dashboard MVP（日本語 UI）を実装
- 開発起動のための compose/README を整備

## 完了条件
- `yarn` 前提で起動手順が揃っている
- 仕様の主要データモデル（Application, Deployment, Route, Event, Job）が保存できる
- UI から最低限の操作導線（登録、再起動、再ビルド、更新確認）が確認できる
