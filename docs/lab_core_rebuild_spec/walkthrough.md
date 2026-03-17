# 修正内容の確認 (Walkthrough)

## 1. 変更ファイル概要
- `.env`: サーバーIP、ドメイン、ポート、ネットワーク名に加えて `DNS_HOST_PORT` / `DNS_BIND_IP` を追加
- `compose.yml`: Dnsmasq / NPM / Lab-Wire / Dockge のサービス定義を追加（Dnsmasq公開ポートを環境変数化）
- `setup.sh`: 初期構築自動化に加え、DNS公開ポートの入力検証と53番競合チェックを実装
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
2. 初期状態は `DNS_HOST_PORT=5353`（暫定）で運用
3. `bash setup.sh` を実行
4. DNS確認は `dig @SERVER_IP -p 5353 test.LAB_DOMAIN` で実施
5. NPM 管理画面（既定: `http://SERVER_IP:81`）でドメインとコンテナを紐付け
6. Dockge（既定: `http://SERVER_IP:5001`）から各アプリを追加・起動

## 4. 53番ポートでの本番運用
1. `.env` の `DNS_HOST_PORT=53` に変更
2. `setup.sh` 実行前にホストの53番競合（例: systemd-resolved 等）を解消
3. `bash setup.sh` を再実行

## 5. 補足
- Dnsmasq 設定は `setup.sh` 実行時に `dnsmasq/lab.conf` を自動生成
- compose の `lab-bridge` は external 指定のため、事前作成（`setup.sh` 実施）が前提
- `setup.sh` は `DNS_HOST_PORT=53` で競合を検知した場合、対処メッセージを表示して停止
