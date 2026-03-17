# homepage_test (Vite + React + TypeScript)

## 使い方

```bash
cd examples/homepage_test
docker compose up -d --build
```

- コンテナ名: `homepage-test`
- アプリ内部ポート: `8080`

## Lab-Core への接続フロー

1. Dockge でこの `docker-compose.yml` を起動
2. Lab-Wire が `homepage-test` を `lab-bridge` に自動接続
3. Nginx Proxy Manager で `homepage_test.xxx.lab -> homepage-test:8080` を作成
4. DNS は `dig @<SERVER_IP> -p <DNS_HOST_PORT> homepage_test.xxx.lab` で確認

この compose には `networks` / `labels` を書かない方針です。
