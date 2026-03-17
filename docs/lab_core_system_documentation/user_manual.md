# 使い方ガイド

最終更新: 2026-03-18

## 1. 開発環境の初期セットアップ
1. リポジトリルートで `yarn install`
2. 設定ウィザードを実行: `yarn config:init`
3. backend 起動: `yarn dev:backend`
4. dashboard 起動: `yarn dev:dashboard`
5. ブラウザで `http://localhost:5173` を開く

## 2. `.env` を安全に設定する
1. `yarn config:init` を実行
2. プロファイルを選ぶ（通常は `local`）
3. 各項目の説明を確認し、必要な値だけ変更
4. 保存確認で `yes`

補足:
- 設定やり直しは `yarn config:reset`
- 既存 `.env` は自動で `.env.backup.<timestamp>` に退避

## 3. 日常運用の基本フロー
1. ホームで `不安定` と `失敗` 件数を確認
2. アプリ一覧で対象アプリを特定
3. まず「再起動」
4. 改善しなければ「ログ」
5. 必要に応じて「再ビルド」や「更新確認/更新適用」

## 4. アプリを登録する
1. 「アプリ登録」で必須項目を入力
2. 「登録して配備キューに追加」を押す
3. イベント欄で登録完了と deploy 成否を確認

入力の目安:
- 公開サービス名: compose 上の公開対象サービス
- 公開ポート: サービスが listen するポート
- サブドメイン: `{name}.fukaya-sus.lab` または開発用ドメイン
- デバイス要件: 必要時のみ（例 `/dev/bus/usb`）

## 5. テスト値を使った登録
1. 「登録テスト値」でシナリオ選択
2. 「テスト値を入力」
3. 内容を確認して登録

補足:
- 重複登録を避けるため、アプリ名とホスト名にサフィックスが付きます

## 6. 更新運用
1. 「更新確認」で差分有無を確認
2. 更新ありなら「更新適用」
3. 不具合時は「ロールバック」（prev がある場合のみ）

## 7. 削除運用
1. 「削除」を押す
2. 削除モードを選択
3. 確認用アプリ名を正確に入力
4. 「削除ジョブを開始」

モードの意味:
- `config_only`: DB 上の構成削除が中心
- `source_and_config`: 構成 + ソース削除
- `full`: 構成 + ソース + データ削除

## 8. ログ確認
1. 対象アプリの「ログ」
2. サービス選択
3. 表示行数を調整（100/200/500/1000）
4. 必要に応じて自動スクロールを OFF

## 9. DNS/Proxy 手動同期
1. 右上「DNS/Proxy 同期」
2. 同期結果イベントを確認
3. 必要なら生成ファイルを確認
   - `core/backend/data/generated/Caddyfile`
   - `core/backend/data/generated/fukaya-sus.hosts`

## 10. 代表的な確認コマンド
- ビルド確認: `yarn build`
- 登録テスト: `yarn test:register-fixtures`
- 網羅スモークテスト: `yarn test:smoke`

## 11. `execute` モードでの実動作確認
1. `yarn config:reset` で `LAB_CORE_EXECUTION_MODE=execute` を設定
2. Docker が利用可能なことを確認（例: `docker ps`）
3. backend/dashboard を起動
4. アプリ登録し、ジョブが `succeeded` になることを確認
5. 必要に応じて `docker ps` / `docker compose logs` で実体確認

