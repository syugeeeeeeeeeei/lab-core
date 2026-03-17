# Walkthrough: 最終仕上げと網羅テスト実施結果

## 変更概要
- `scripts/testing/full_system_smoke_test.mjs` を追加
  - API を横断し、主要導線を自動検証
- `scripts/testing/run_full_system_smoke_test.sh` を追加
  - バックエンド起動 / 健康確認 / テスト実行を一括化
- root `package.json` に `test:smoke` を追加
- `README.md` と `docs/readmes/how_to_use_lab_core.md` に最終検証手順を追記

## 実行結果
- `yarn build`: 成功
- `yarn test:smoke`: 成功
  - `checkedCount: 17`
  - Health, 登録, 再起動, 再ビルド, 更新, ロールバック, ログ, 同期, 削除, 失敗系を確認

## 追加した運用価値
- 回帰確認が「手順依存」から「コマンド再現可能」に改善
- 後継メンバーが `yarn test:smoke` で現状健全性を短時間確認可能
- 機能追加時に smoke を再実行して破壊的変更を早期検知可能
