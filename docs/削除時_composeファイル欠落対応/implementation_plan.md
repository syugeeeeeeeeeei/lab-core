# 実装計画

1. 原因特定
- `executeDeleteJob` の削除フローを確認し、compose ファイル不在時の分岐有無を確認する。

2. 改善方針
- compose ファイルが存在する場合は従来どおり `docker compose -f ... down` を使う。
- compose ファイルやリポジトリが存在しない場合は `docker compose -p <project> down` にフォールバックする。

3. 実装
- `application-jobs.ts` に project 名ベースで停止するヘルパーを追加する。
- `executeDeleteJob` に `repoPath` / `composeFilePath` の存在チェックとフォールバック分岐を追加する。
- フォールバックが走ったことを Job/Event に warning として記録する。

4. 検証
- TypeScript の noEmit ビルドで型エラーがないことを確認する。
