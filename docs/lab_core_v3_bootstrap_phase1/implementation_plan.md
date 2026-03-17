# Implementation Plan: Bootstrap Phase 1

## 方針
- まずは「運用可能な土台」を最短で作る
- 将来拡張を見据え、v3 データモデルを先に固定する
- CLI 依存を減らし、Dashboard 主導の流れを先に接続する

## 実装ステップ
1. ルート構成とワークスペース設定（yarn workspaces）
2. Backend コア（DB初期化・スキーマ・APIルーティング）
3. Job/Event の内部サービス化
4. Runtime/Git の最小連携（restart/update-check）
5. Dashboard MVP（一覧/登録/操作）
6. 開発用 compose と README を追加

## 次フェーズへの接続
- Deployment Job を実行する Build Engine 実装
- Route/DNS Controller の実プロセス連携
- 削除時の二重確認 UI と危険操作の段階表示
- OruCa 実機受け入れテスト
