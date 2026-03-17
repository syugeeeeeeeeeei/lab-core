# Lab-Core アーキテクチャ仕様書

## 1. 目的
研究室内の各アプリを、インフラ依存設定なしで追加・運用できる基盤を提供する。  
アプリは「通常の Docker Compose アプリ」として動かし、配線は基盤側で吸収する。

## 2. 設計原則
- Infrastructure as a Socket: アプリは基盤内部実装を意識しない
- Zero-Knowledge Apps: アプリ compose に基盤固有の `networks` / `labels` を持ち込まない
- GUI-First Management: 主な運用を UI 中心で行う

## 3. 構成要素
### 3.1 DNS レイヤー（Dnsmasq）
- 役割: `*.LAB_DOMAIN` を `SERVER_IP` に解決
- 実装: `dnsmasq/lab.conf` を `setup.sh` が生成
- 現行既定: `DNS_HOST_PORT=5353`（53 番競合回避の暫定運用）

### 3.2 プロキシレイヤー（Nginx Proxy Manager）
- 役割: ドメイン単位ルーティング・SSL終端
- 特徴: ラベル自動配線は使わず、UI で手動設定

### 3.3 自動配線レイヤー（Lab-Wire Manager）
- 役割: 新規起動コンテナを `lab-bridge` に自動接続
- 動作:
  1. Docker Socket 監視
  2. `container start` イベント検知
  3. 対象コンテナを `lab-bridge` へ接続

### 3.4 管理レイヤー（Dockge）
- 役割: アプリごとの compose 管理
- 特徴: マルチレポ構成との親和性が高い

## 4. ネットワーク方針
- 基盤共通ネットワーク: `LAB_BRIDGE_NAME`（既定 `lab-bridge`）
- `compose.yml` では `lab-bridge` を external network として扱う
- アプリ側 compose は原則 `networks` 記述不要（Lab-Wire で接続）

## 5. 運用フロー
1. 管理者が `setup.sh` を実行して基盤を構築
2. 利用者が Dockge でアプリを起動
3. Lab-Wire が自動で `lab-bridge` に接続
4. 管理者が Nginx Proxy Manager で公開ドメインを設定

## 6. 設定パラメータ（主要）
- `SERVER_IP`: DNS 応答先 IP
- `LAB_DOMAIN`: 研究室ドメイン
- `LAB_BRIDGE_NAME`: 共通 Docker ネットワーク名
- `DNS_HOST_PORT`: Dnsmasq 公開ポート（既定 `5353`）
- `DNS_BIND_IP`: Dnsmasq バインド IP（既定 `0.0.0.0`)

## 7. 制約と拡張
- 制約: 標準 DNS として使うには最終的に 53 番運用が必要
- 拡張候補:
  - 認証基盤（Authelia 等）連携
  - ボリュームバックアップ自動化
