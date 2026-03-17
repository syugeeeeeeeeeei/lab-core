# Walkthrough: 対話型 .env 設定ウィザード 実装結果

## 変更概要
- `scripts/config/env-wizard.mjs` を追加
  - `yarn config:init`
  - `yarn config:reset`
  を実装
- 全設定項目に「何のための設定か」を表示
- 入力値バリデーションを追加（port/mode/ip/domain など）
- 保存前プレビューと最終確認を追加
- 既存 `.env` 上書き時のバックアップ作成を追加
- backend 側で `core/backend/.env` 自動読込を追加

## 実行確認
- `yarn config:init` 実行で `.env` 生成を確認
- `yarn config:reset` 実行で確認ダイアログ表示を確認
- backend 起動後 `GET /api/system/status` で
  - `mainServiceIp=127.0.0.1`
  - `rootDomain=lab.localhost`
  が反映されることを確認

## 期待効果
- `.env` を直接編集しない運用へ移行できる
- 設定意図を読みながら入力できるため、心理的ハードルを下げられる
- 設定変更時の事故（上書きミス）をバックアップで緩和できる
