# Current vs Lab-Core v3 Gap Analysis

## 1. 対象
- 現行: `fukaya-lab-server-main.zip` 展開内容
- 期待: Lab-Core v3 仕様書 (v3.0.0 Draft)

## 2. 現行構成の実態サマリ
現行は「複数アプリの Docker Compose 群 + justfile による手動運用」で構成される。

主要構成:
- ルート compose が各サブディレクトリ compose を include
- Entry に Caddy + CoreDNS + AdGuard Home
- 各アプリは Caddy label で公開先を自己申告
- 運用は `just up-prod`, `just restart`, `just logs` などの CLI 主体

## 3. v3 Must 要件に対する差分

### 3.1 満たしている/土台がある
- Reverse Proxy の土台は存在
  - Caddy + docker-proxy でホスト名ベース公開が可能
- DNS の土台は存在
  - CoreDNS + AdGuard Home で内部解決構成を持つ
- OruCa の運用資産は存在
  - API / MySQL / NFC / Web を compose で分離
  - NFC デバイスマウント、Slack 環境変数入力口がある

### 3.2 部分充足（v3基準では不足）
- 再起動・ログ確認
  - CLI 操作としては可能だが、Dashboard UI での安全導線は未実装
- 削除/再ビルド
  - CLI で実行可能だが、データ保持有無の明示選択や UI 二重確認がない
- DNS/Proxy 再同期
  - Caddy ラベル反映はあるが、基盤側の状態管理と再同期 API がない

### 3.3 未実装（v3 Must に対する主要ギャップ）
- Dashboard (日本語 UI) が存在しない
- API 駆動の Application/Deployment/Runtime/Logs/Route/DNS/Update API 群がない
- State Store (SQLite) と標準データモデルがない
- 長時間処理の Job 管理 (`job_id`, 状態遷移) がない
- Git URL からの「UI 主導アプリ追加」がない
- 更新検知（日次 fetch 比較）と UI 反映がない
- 1世代ロールバック機能がない
- イベント管理（info/warning/error）と一覧可視化がない
- Degraded 判定・再起動回数表示・不安定通知がない

## 4. 仕様観点での具体的差分

### 4.1 配備モデル
- 現行:
  - 同一リポジトリ内にアプリを同居させ、compose include で束ねる運用
  - 新規アプリ追加はファイル編集前提
- v3:
  - Git URL 登録から基盤が clone/build/deploy/route まで自動化

### 4.2 責務分離
- 現行:
  - ルーティング情報（caddy labels）が各アプリ compose に散在
  - インフラ定義の統制点がなく、運用が属人化しやすい
- v3:
  - Dashboard/API から route を一元管理し、重複/不整合を制御

### 4.3 DNS 要件
- 現行:
  - `ssh.fukaya-sus.lab` と `dns.fukaya-sus.lab` は Corefile 上に明示
  - `*.fukaya-sus.lab -> 192.168.11.224` のワイルドカード設定はリポジトリ上で明示されない
- v3:
  - ワイルドカード解決・例外ホスト定義・確認導線を標準化

### 4.4 運用 UX
- 現行:
  - `just` コマンド中心、CLI 手順理解が必要
  - 破壊操作に対する UI 上の危険表示/確認文入力はない
- v3:
  - 初心者向け日本語 UI と固定復旧導線が必須

### 4.5 ログ観測
- 現行:
  - `docker compose logs -f` で都度確認
  - 横断ログ収集・重要ログ強調・バッジ通知なし
- v3:
  - アプリ詳細からコンテナ単位に切替、重要度表示、一覧バッジが必要

### 4.6 OruCa 特別要件
- 現行で確認できる土台:
  - NFC: USB デバイスマウントあり
  - Slack: API 設定が環境変数で読み込み
  - DB 永続: MySQL ボリューム利用
- v3との差分:
  - OruCa を「基盤の受け入れ対象」として管理するための UI/API/状態管理が未整備

## 5. 優先度付きギャップ

### P0（v1開始前に必須）
- 基盤コア（Backend + SQLite + Job 管理）
- Dashboard MVP（追加/再起動/ログ/削除/再ビルド）
- Runtime/Route/DNS 制御 API
- OruCa を使った受け入れ試験フロー

### P1（v1受け入れ直前まで）
- 更新検知 + 1世代ロールバック
- Degraded 判定と再起動回数表示
- イベント一覧と重要度バッジ

### P2（v1後でも可）
- DNS/Proxy ログ統合ビューの強化
- 運用手順の UI ガイド化

## 6. 結論
現行は「手動 compose 運用としては成立」しているが、Lab-Core v3 が目指す「非専門ユーザーでも怖くない配信基盤」には未到達。

差分の本質は次の3点:
1. 操作面: CLI 主体から UI 主体への転換が未実現
2. 制御面: 状態管理・ジョブ管理・API 駆動の不足
3. 運用面: 更新検知・ロールバック・可視化の不足

したがって、再構築は妥当であり、既存資産は「OruCa 運用知見」「Entry(DNS/Proxy) の実装断片」を再利用する方針が有効。
