# 実装計画 (Implementation Plan)

## 1. 目標
研究室インフラを「コンセント化」し、アプリ側 compose からインフラ依存設定（`networks` / `labels`）を排除する。

## 2. 実装方針
- DNS: `Dnsmasq` で `*.xxx.lab` をサーバー IP へワイルドカード解決
- DNS公開はポート競合を避けるため、暫定的に `DNS_HOST_PORT=5353` を既定値とする
- プロキシ: `Nginx Proxy Manager` を GUI 手動配線で運用
- 自動配線: `Lab-Wire Manager` が Docker `start` イベントを監視し `lab-bridge` へ接続
- 管理 UI: `Dockge` でマルチレポ compose を管理

## 3. 作業ステップ
1. `.env` を基盤共通パラメータに対応させる
2. `compose.yml` に4サービスと外部ネットワーク定義を記述
3. `setup.sh` に以下を実装
   - Docker の存在確認と不足時インストール
   - DNS公開ポートの妥当性確認（`DNS_HOST_PORT`）
   - `DNS_HOST_PORT=53` 時の競合検査とガイダンス表示
   - `lab-bridge` 作成
   - Dnsmasq 設定ファイル生成
   - 基盤サービス起動
4. `manager/` に TypeScript 実装を追加
   - 起動時に稼働中コンテナを走査して接続
   - `start` イベント検知時に都度接続
   - 再接続ループで監視継続
5. ドキュメントと `.gitignore` を整備

## 4. 検証観点
- `setup.sh` 実行後に `lab-bridge` が存在する
- 基盤4サービスが起動する
- 任意コンテナ起動時に `lab-bridge` に接続される
- `*.LAB_DOMAIN` が `SERVER_IP` に解決される
- 暫定運用では `dig @SERVER_IP -p 5353 test.LAB_DOMAIN` で名前解決できる
- 本番移行時は `.env` の `DNS_HOST_PORT=53` に変更し、53番ポート競合を解消して運用する
