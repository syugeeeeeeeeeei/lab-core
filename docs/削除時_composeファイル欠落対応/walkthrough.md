# 修正内容の確認

## 発生していた問題

- 削除ジョブは `repoPath` の存在のみを確認し、`composeFilePath` の存在確認なしで `docker compose -f <compose> down` を実行していた。
- そのため、`docker-compose.yml` が欠けていると `no such file or directory` で削除が失敗していた。

## 変更内容

- `runComposeDownByProject` を追加し、`docker compose -p <project> down --remove-orphans` を実行できるようにした。
- `executeDeleteJob` で以下を分岐:
  - `repoPath` と `composeFilePath` がある: 従来どおり `-f` 指定で停止。
  - `composeFilePath` がない: project 名ベース停止へフォールバック。
  - `repoPath` 自体がない: project 名ベース停止へフォールバック。
- フォールバック時は Job progress と warning Event を残すようにした。

## 検証

- `yarn workspace @lab-core/backend exec tsc -p tsconfig.json --noEmit` を実行し、型エラーなしを確認。
- 通常 build は既存の `dist/` 権限問題（`EACCES`）で失敗するため、今回の検証は noEmit で実施。
