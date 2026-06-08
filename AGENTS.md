# AGENTS.md

このリポジトリは Cloudflare Workers の Scheduled Worker プロジェクトです。Cron Trigger テンプレートをベースにしており、定期実行処理は `src/index.ts` の `scheduled` ハンドラで実装します。

## プロジェクト構成

- `src/index.ts`: Worker のエントリーポイント。`fetch` はローカルで scheduled handler を試すための補助、`scheduled` が cron 実行本体です。
- `wrangler.jsonc`: Worker 名、互換日、observability、cron trigger、binding などの Wrangler 設定を管理します。
- `package.json`: 開発、デプロイ、型生成コマンドを定義します。
- `tsconfig.json`: TypeScript のコンパイル設定です。

## コマンド

このプロジェクトでは `pnpm` を使います。

- 開発サーバー: `pnpm run dev`
- scheduled handler のローカル実行: `curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"`
- Cloudflare Workers 型生成: `pnpm run cf-typegen`
- デプロイ: `pnpm run deploy`

## 実装方針

- cron で実行される主処理は `scheduled(event, env, ctx)` に置いてください。
- HTTP リクエスト用の `fetch` は、原則としてローカル確認やヘルスチェックなど補助用途に留めます。
- binding を追加、変更した場合は `wrangler.jsonc` を更新し、`pnpm run cf-typegen` で `Env` 型を再生成してください。
- `Env` 型は手書きしないでください。Wrangler が生成する型を使います。
- secret は `wrangler.jsonc` やソースコードに書かず、`wrangler secret put` で設定してください。
- バックグラウンドで継続してよい処理は `ctx.waitUntil()` を使ってください。`ctx` は分割代入しないでください。
- request や scheduled event ごとの状態をモジュールスコープの mutable 変数に保存しないでください。
- Promise は必ず `await`、`return`、`void`、または `ctx.waitUntil()` のいずれかで扱ってください。
- 外部 API を呼ぶ処理では、失敗時のログとエラー処理を明示してください。

## Wrangler 設定

- `wrangler.jsonc` の `name` と `compatibility_date` はテンプレート値のままにしないでください。
- cron のスケジュールは `triggers.crons` で管理します。
- 本番で利用する KV、D1、R2、Queues などは Cloudflare REST API ではなく Worker binding として設定してください。
- observability は有効にしたままにし、必要に応じてログを構造化してください。

## 品質確認

変更後は少なくとも次を確認してください。

1. `pnpm run cf-typegen`
2. `pnpm exec tsc --noEmit`
3. `pnpm run dev` で起動し、`curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"` で scheduled handler を確認

デプロイ前には `wrangler.jsonc` の Worker 名、互換日、cron スケジュール、binding、secret 設定が意図どおりか確認してください。
