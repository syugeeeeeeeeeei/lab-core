# 修正内容の確認 (Walkthrough)

## 1. 変更ファイル概要
- `.env`: サーバーIP、ドメイン、ポート、ネットワーク名などの共通定義を追加
- `compose.yml`: Dnsmasq / NPM / Lab-Wire / Dockge のサービス定義を追加
- `setup.sh`: 初期構築自動化（Docker導入、設定生成、ネットワーク作成、起動）を実装
- `manager/`: Lab-Wire 本体（TypeScript）を新規実装
- `.gitignore`: 実行時データ・ビルド成果物を除外

## 2. Lab-Wire の挙動
1. 起動時に対象ネットワーク（既定: `lab-bridge`）の存在確認
2. 既に稼働中の全コンテナを確認し、未接続なら `lab-bridge` へ接続
3. Docker の `container start` イベントを監視
4. 新規起動コンテナを検知したら `lab-bridge` に自動接続
5. イベントストリーム断時は待機後に再接続

## 3. 運用手順
1. `.env` の `SERVER_IP` と `LAB_DOMAIN` を環境に合わせて設定
2. `bash setup.sh` を実行
3. NPM 管理画面（既定: `http://SERVER_IP:81`）でドメインとコンテナを紐付け
4. Dockge（既定: `http://SERVER_IP:5001`）から各アプリを追加・起動

## 4. 補足
- Dnsmasq 設定は `setup.sh` 実行時に `dnsmasq/lab.conf` を自動生成
- compose の `lab-bridge` は external 指定のため、事前作成（`setup.sh` 実施）が前提
