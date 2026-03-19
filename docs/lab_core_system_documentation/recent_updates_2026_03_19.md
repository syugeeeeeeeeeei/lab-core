# 2026-03-19 更新まとめ

最終更新: 2026-03-19

## 1. 概要

2026-03-19 時点で、Lab-Core の開発・運用導線に対して次の改善を実施しました。

- アプリ詳細画面のスクロール不能とレイアウト崩れを修正
- デプロイ設定の詳細編集機能を追加
- compose ファイル候補 / 公開サービス候補を選択式 UI に統一
- GitHub 取得 compose の raw YAML / parsed JSON / analysis を確認できる inspection dialog を追加
- compose 解析を line-based 実装から厳密な YAML parser ベースへ置き換え
- `ports` / `expose` / env placeholder / long syntax / branch 指定の厳密化
- GitHub API rate limit 時の fallback clone に対応
- ローカル開発用 DNS / proxy / reset 保守導線を追加

## 2. UI と運用導線

### 2.1 アプリ詳細画面

- 「最近の進行イベント」が下のセクションを押し潰していた問題を修正
- イベント欄とログ欄を縦長のアコーディオンに変更
- イベントは 10 秒ごと、ログは表示中 5 秒ごとに自動更新
- YAML / JSON の inspection dialog は body 全体に portal 表示

### 2.2 デプロイ設定編集

- アプリ詳細から `composePath` / `publicServiceName` / `publicPort` / `hostname` / `keepVolumesOnRebuild` を更新可能
- `composePath` と `publicServiceName` は自由入力ではなく、compose 解析結果から選択
- compose 実体と現在設定がずれていた場合は routing 補正を実行

### 2.3 アプリ登録画面

- GitHub URL から branch / YAML / compose 候補を解析
- compose を解析して public service をカード選択
- compose inspection dialog から次を確認可能
  - GitHub から取得した raw YAML
  - parsed JSON
  - parser / analysis warning
  - source metadata
  - detected services / ports / devices

## 3. compose 解析の改善

### 3.1 厳密 YAML parser への置き換え

- `yaml.parseDocument` ベースの shared inspection module を追加
- backend 内の重複 line parser を廃止し、inspection / validation / routing correction を共通化

### 3.2 対応した解析対象

- `services.<name>`
- nested `build`
- `environment`
- `healthcheck`
- `ports`
  - short syntax
  - host IP つき short syntax
  - env placeholder
  - long syntax object
- `expose`
- `devices`
- `/dev/...` を source に持つ bind mount

### 3.3 デバイス自動認識

- compose 全 service を対象に device path を検出
- 公開 service が `web` でも、別 service である `nfc` の `/dev/...` を拾う
- import フォームの `deviceRequirements` は compose inspection 結果で自動補完

## 4. GitHub 取得の改善

### 4.1 branch 指定バグ修正

- `repositoryUrl` が canonical な `.git` URL のとき、`compose-inspect` が誤って `main` を見てしまう不具合を修正
- 明示 branch を保持して `dev/new-arch` のような slash を含む branch もそのまま解決

### 4.2 GitHub API rate limit 対応

- tree / blob 取得で rate limit に当たった場合、一時 shallow clone へ fallback
- `import/resolve` と `import/compose-inspect` の両方で compose 候補と YAML 本文を継続取得

## 5. ローカル DNS / proxy

### 5.1 DNS

- backend 内蔵 DNS は `1053` 待受を基本とし、`yarn dev:dns` で `127.0.0.1:53` を前段公開
- ホーム画面には次を表示
  - backend DNS 待受状態
  - 53 番前段 relay の到達可否
- `DNS Resolution Failed ... ECONNREFUSED` は、多くの場合 `yarn dev:dns` 未起動を示す

### 5.2 proxy

- `yarn dev:proxy` で local reverse proxy を起動
- app network の自動接続と route fallback を追加

## 6. 保守コマンド

- `yarn maintenance:reset`
  - preview
- `yarn maintenance:reset:yes`
  - DB / generated / runtime apps / appdata / 管理下 Docker 資産を初期化

## 7. 既知の前提

- GitHub API の unauthenticated rate limit は残るため、fallback clone が使われる場面がある
- `fukaya-sus.lab` を local で引かせる場合は `yarn dev:dns` が必要
- HTTP 到達確認には `yarn dev:proxy` も必要
