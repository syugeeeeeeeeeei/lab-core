# Implementation Plan: 対話型 .env 設定

## 方針
- 設定値を「意味の分かる質問」に変換して入力させる
- 初心者が Enter だけで安全値を選べるようにする
- 既存環境はバックアップを作ってから更新する

## 実装ステップ
1. `scripts/config/env-wizard.mjs` を追加
2. `init/reset` サブコマンドを実装
3. プロファイル（local/lab/vm）とバリデーションを実装
4. `.env` 保存前プレビューと確認を実装
5. `.env` バックアップ生成を実装
6. backend `env.ts` に `.env` 自動読込を追加
7. package scripts / ドキュメント更新

## テスト観点
- `yarn config:init` で `.env` が作成される
- `yarn config:reset` で安全に中断・再作成できる
- `.env` 設定値が `GET /api/system/status` に反映される
