# Lab-Core 使い方ガイド

## 1. 概要
`lab-core` は、研究室内サービスをまとめて運用するための基盤です。  
以下 4 サービスを `setup.sh` で起動します。

- Dnsmasq（ワイルドカードDNS）
- Nginx Proxy Manager（リバースプロキシ管理UI）
- Lab-Wire Manager（起動コンテナの自動ネットワーク接続）
- Dockge（compose 管理UI）

## 2. 初回セットアップ
1. `.env.dev` をコピーして `.env` を作成
2. `.env` の `SERVER_IP` と `LAB_DOMAIN` を環境に合わせて編集
3. `bash setup.sh` を実行

`setup.sh` は以下を自動実行します。

- Docker 未導入時のインストール
- `lab-bridge` ネットワーク作成
- `dnsmasq/lab.conf` 生成
- 基盤コンテナのビルド/起動

## 3. アクセス先
- Nginx Proxy Manager: `http://<SERVER_IP>:81`
- Dockge: `http://<SERVER_IP>:5001`

## 4. DNS 動作確認
現在は 53 番競合回避のため、既定で `DNS_HOST_PORT=5353` です。  
以下で確認できます。

```bash
dig @<SERVER_IP> -p 5353 test.<LAB_DOMAIN>
```

## 5. アプリ追加手順（運用）
1. Dockge でアプリ用リポジトリを `git clone`
2. Dockge で `up` 実行
3. Lab-Wire がコンテナを `lab-bridge` に自動接続
4. Nginx Proxy Manager で `ドメイン -> コンテナ名:ポート` を手動設定

## 6. 本番で 53 番を使う場合
1. `.env` の `DNS_HOST_PORT=53` に変更
2. ホストの 53 番競合（例: `systemd-resolved`）を解消
3. `bash setup.sh` を再実行

`setup.sh` は 53 番が使用中ならエラーを表示して停止します。
