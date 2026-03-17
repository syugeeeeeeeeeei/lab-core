# Implementation Plan: Phase 3 登録テスト導線整備

## 方針
- 「まず試せる」を優先し、登録テスト値を UI と API の両方から提供する
- テスト値適用時に一意サフィックスを付与し、重複登録で詰まりにくくする
- 破壊的操作（削除）は確認文入力を必須化して誤操作を減らす

## 実装ステップ
1. テスト値データ定義（backend / dashboard）
2. `GET /api/testing/registration-fixtures` 追加
3. Dashboard に fixture 選択と入力ボタン追加
4. fixture 適用時の時刻サフィックス付与
5. Dashboard に削除確認パネル追加
6. 一括登録スクリプト追加（3件連続登録）
7. 説明書・検証手順更新

## テスト観点
- build 成功
- fixture API が 3 件返す
- UI から fixture 適用後に登録できる
- `yarn test:register-fixtures` で3件登録ジョブが作成される
- 削除時に確認文字列不一致なら実行されない
