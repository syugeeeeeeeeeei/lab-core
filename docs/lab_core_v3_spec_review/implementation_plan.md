# Implementation Plan: Lab-Core v3

## 実装方針
- 初期版は「怖くない・壊しにくい・戻しやすい・引き継げる」を最優先とする
- Must 要件を先に固定し、Should は段階導入する
- OruCa を受け入れ可能にすることを最初の品質ゲートにする

## フェーズ 0: 現行資産調査
- `fukaya-lab-server-main.zip` を展開し、現行構成を棚卸し
- OruCa の依存（NFC / Slack / 永続データ）を抽出
- 既存の DNS / Proxy / Docker 運用の課題を列挙

## フェーズ 1: コア基盤骨格の実装
- Backend（Node.js + TypeScript + Hono）を作成
- SQLite スキーマを定義（Application / Deployment / ContainerInstance / Route / SystemEvent / UpdateInfo / Job）
- Docker Runtime Controller と Git/Build Engine の最小 API を実装

## フェーズ 2: 配信経路の確立
- Caddy 連携によるホスト名ルーティング同期を実装
- DNS（dnsmasq 等）で `*.fukaya-sus.lab -> 192.168.11.224` を構成
- `ssh.fukaya-sus.lab -> 192.168.11.225` の例外ルートを追加

## フェーズ 3: Dashboard MVP
- 日本語 UI で以下を提供
  - アプリ登録（Git URL / 公開サービス / ポート / サブドメイン / Headless）
  - 状態一覧・詳細
  - 再起動 / ログ / 更新検知 / 削除 / 再ビルド
- 破壊的操作に二重確認と危険表示を実装

## フェーズ 4: OruCa 受け入れ
- OruCa を実際に配備し、以下を確認
  - 安定起動
  - NFC リーダー利用
  - Slack 通知
  - データ保持状態で再ビルド
- 失敗時の復旧導線（Restart → Log Review → Rebuild）を UI で検証

## フェーズ 5: 運用固め
- 自動起動（ホスト再起動後の再同期）
- 更新検知（日次）と 1 世代ロールバック
- 最低限の手順書（通常運用 / 障害時 / 移行時）を整備

## 初期版の完了判定
- Must 要件を UI 主導で再現できる
- OruCa 受け入れ基準を満たす
- 初見利用者が「追加・再起動・ログ確認・削除」を実施できる
