# Implementation Plan: Phase 2 Runtime/Sync

## 方針
- 重い処理をジョブに寄せ、API の応答性を維持する
- インフラ同期は「生成ファイル」にまず統一し、実機反映は次段で行う
- 初期運用は dry-run で安全確認し、問題なければ execute へ移行

## 実装ステップ
1. 実行モード拡張（env）
2. コマンド実行ラッパー実装
3. deploy/rebuild/restart/delete ジョブ実行サービス実装
4. routes のジョブ起動化（202 返却）
5. DNS/Proxy 同期サービス + API
6. Dashboard の同期導線追加
7. 説明書追記

## テスト観点
- build 成功
- `/api/system/status` で execution 情報確認
- アプリ登録で deploy job 作成・状態遷移確認
- 同期 API で生成ファイル更新確認
