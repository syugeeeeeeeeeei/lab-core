# 機能カタログ

最終更新: 2026-03-19

## 1. MPA風ダッシュボードナビゲーション

- UI:
  `ホーム / アプリ一覧 / アプリ登録 / アプリ詳細` の4画面をタブで切り替え
- 特徴:
  SPA だが、1画面詰め込みではなく画面単位で役割を分離
- 補足:
  `アプリ詳細` タブは対象アプリ選択後に有効化

## 2. ホームダッシュボード

- UI:
  ステータスカード、クイックメニュー、注意アプリ一覧、最近のイベント
- データ:
  `GET /api/system/status`
  `GET /api/applications`
  `GET /api/events`
- 特徴:
  全体状況の俯瞰に特化
- 補足:
  `注意が必要なアプリ` と `最近のイベント` は内部スクロール対応

## 3. アプリ一覧

- UI:
  テーブル表示
- データ:
  `GET /api/applications`
- 表示項目:
  状態、公開先、更新有無、commit、最新エラー、最新ジョブ進捗
- 特徴:
  失敗要約だけでなく、現在進行中ジョブのメッセージも見える

## 4. GitHub インポートウィザード

- UI:
  ステップ型ウィザード
- API:
  `POST /api/applications/import/resolve`
- 対応 URL:
  `https://github.com/<owner>/<repo>`
  `https://github.com/<owner>/<repo>.git`
  `https://github.com/<owner>/<repo>/tree/<branch>`
- 特徴:
  前段入力が終わるまで後段ステップを表示しない

## 5. ブランチ解決

- 入力:
  GitHub URL
- 挙動:
  `/tree/<branch>` はブランチ候補を取得して最長一致解決
  `/repo` と `.git` は `main` 固定
- API:
  `POST /api/applications/import/resolve`
- 返却:
  正規化 URL、解決 branch、候補 branch、compose 候補など

## 6. リポジトリファイル一覧と composeファイル候補抽出

- データソース:
  GitHub API から取得した repository tree
- API:
  `POST /api/applications/import/resolve`
- 返却:
  `repositoryFiles`
  `yamlFiles`
  `composeCandidates`
  `recommendedComposePath`
- 特徴:
  compose 名を含む YAML を優先スコアで候補化

## 7. composeファイル解析

- API:
  `POST /api/applications/import/compose-inspect`
- 対象:
  GitHub 上の compose ファイル本文
- 解析内容:
  `services`
  `ports`
  `expose`
- 返却:
  サービス候補、候補ポート、公開候補判定、推定理由
- 特徴:
  `ports` と `expose` の両方から公開ポート候補を推定

## 8. アプリ登録

- UI:
  ウィザード最終ステップの登録フォーム
- API:
  `POST /api/applications`
- 挙動:
  `applications`
  `deployments`
  `routes`
  を作成し deploy ジョブを発行
- 返却:
  `applicationId`
  `deploymentId`
  `routeId`
  `jobId`
- 特徴:
  登録後はアプリ詳細へ自動遷移

## 9. アプリ詳細

- UI:
  概要、進行状況、最新エラー、最近の進行イベント、ログ、削除
- データ:
  `GET /api/applications`
  `GET /api/events`
- 特徴:
  運用操作を1画面に集約

## 10. 配備進捗表示

- データソース:
  `jobs` テーブルの最新ジョブ情報
  `system_events` テーブルの対象アプリイベント
- 表示箇所:
  アプリ一覧
  アプリ詳細の進行状況カード
  アプリ詳細の最近の進行イベント
- 進捗例:
  リポジトリ取得中
  commit 取得完了
  `docker compose up -d --build` 実行中
  DNS/Proxy 同期中

## 11. ログ閲覧

- UI:
  サービス選択、表示行数切替、自動スクロール、手動更新
- API:
  `GET /api/logs/:applicationId/services`
  `GET /api/logs/:applicationId`
- 特徴:
  ログパネルを開いている間は `5秒ごと` に自動更新
- 実行モード差:
  `dry-run` は擬似ログ
  `execute` は `docker compose logs`

## 12. 再起動

- UI:
  アプリ詳細の `再起動`
- API:
  `POST /api/applications/:id/restart`
- 挙動:
  `docker compose restart`

## 13. 再ビルド

- UI:
  アプリ詳細の `再ビルド`
- API:
  `POST /api/applications/:id/rebuild`
- 現在の UI 挙動:
  `keepData=true` で実行
- 挙動:
  `docker compose down` 後に `up --build`

## 14. 更新確認・更新適用・ロールバック

- 更新確認:
  `POST /api/applications/:id/update-check`
- 更新適用:
  `POST /api/applications/:id/update`
- ロールバック:
  `POST /api/applications/:id/rollback`
- 特徴:
  `current_commit` と `previous_commit` を用いた1世代ロールバック

## 15. 削除

- UI:
  アプリ詳細の削除パネル
- API:
  `DELETE /api/applications/:id`
- モード:
  `config_only`
  `source_and_config`
  `full`
- 安全策:
  確認用アプリ名の一致が必須

## 16. DNS/Proxy 同期

- UI:
  画面右上の `DNS/Proxy 同期`
- API:
  `POST /api/infrastructure/sync`
- 出力:
  `core/backend/data/generated/Caddyfile`
  `core/backend/data/generated/fukaya-sus.hosts`

## 17. 自動更新と通知

- 自動更新:
  全体状態は `15秒ごと`
  ログは `5秒ごと`
- フォーカス復帰:
  自動再取得
- 通知:
  成功・失敗はトースト表示

## 18. イベント観測

- API:
  `GET /api/events`
- 特徴:
  `application_id` と `application_name` を返す
- 用途:
  deploy、update、delete、infrastructure sync の時系列確認

## 19. ジョブ観測

- API:
  `GET /api/jobs`
- 内部用途:
  一覧・詳細の最新ジョブ状態表示
- 状態:
  `queued`
  `running`
  `succeeded`
  `failed`

## 20. 現在の主な制約

- GitHub 以外のリポジトリには未対応
- UI の画面遷移は URL ではなく内部状態管理
- compose 解析はヒューリスティック方式
- すべての Docker Compose 記法を完全に網羅するものではない
