# Implementation Plan: Phase 5 更新 / ロールバック

## 方針
- 既存ジョブ基盤を活かし、更新とロールバックを非同期ジョブとして追加する
- `dry-run` でも導線が止まらないよう、疑似コミットで挙動を再現する
- UI では commit 状態を見せて、押してよい操作を判断しやすくする

## 実装ステップ
1. `application-jobs.ts` に update / rollback 実装
2. commit 更新共通処理（current/previous/update_info）を整理
3. `applications.ts` に update / rollback API を追加
4. `update-check` dry-run 補強
5. Dashboard API クライアント追加
6. Dashboard 一覧に commit 表示とボタン追加
7. 説明書更新

## テスト観点
- build 成功
- update-check が dry-run で失敗しない
- update API で update ジョブが成功する
- rollback API で previous commit がある場合に成功する
- previous commit がない場合は rollback が拒否される
