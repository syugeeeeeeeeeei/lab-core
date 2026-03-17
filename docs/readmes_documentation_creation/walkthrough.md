# 修正内容の確認 (Walkthrough)

## 1. 追加した資料
- `docs/readmes/how_to_use_lab_core.md`
- `docs/readmes/lab_core_architecture_spec.md`

## 2. 使い方ガイドの要点
- `.env` 作成と主要パラメータ設定
- `bash setup.sh` による基盤起動
- Dockge と Nginx Proxy Manager を使った配線運用
- DNS 5353 暫定運用の確認コマンド

## 3. アーキテクチャ仕様書の要点
- Infrastructure as a Socket / Zero-Knowledge Apps / GUI-First を明文化
- Dnsmasq / NPM / Lab-Wire / Dockge の責務を分離して整理
- `lab-bridge` による共通接続モデルを明記

## 4. 補足
- 現行実装の既定値（`DNS_HOST_PORT=5353`）に合わせて記述している
