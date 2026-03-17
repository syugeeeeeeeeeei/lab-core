# Implementation Plan: Phase 4 ログ監視導線

## 方針
- まずは「確実に見える」ことを優先し、1アプリ単位のログ閲覧を実装する
- `dry-run` では擬似ログ、`execute` では Docker 実ログを返す
- UI は一覧画面から離脱せずにログ確認できる構成にする

## 実装ステップ
1. `application-logs` サービス追加
2. `GET /api/logs/:applicationId/services` 追加
3. `GET /api/logs/:applicationId` 追加（service/tail 対応）
4. Dashboard API クライアント追加
5. ログビューア UI 追加（切替・更新・自動スクロール）
6. 強調表示（warning/error）
7. 説明書更新

## テスト観点
- build 成功
- services API がサービス名配列を返す
- logs API が `tail` 件数でログを返す
- UI からログ取得・サービス切替ができる
- dry-run で疑似ログが表示される
