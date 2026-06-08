# TASKS.md

## 1. 設定方針を確定する

- [x] Google Calendar API の認証方式を OAuth 2.0 refresh token 方式に決める。
- [x] 対象カレンダーは `CALENDAR_IDS` が未設定または空なら全取得、値があれば明示リストに絞る。
- [x] 予定がない日は `本日の予定\n\n予定はありません` を投稿する。
- [x] 予定の並び順は全カレンダー統合後の開始時刻順にする。
- [x] 終日予定は時刻付き予定より前に並べる。
- [x] 祝日カレンダーの除外条件は `日本の祝日` の固定文字列にする。
- [x] Discord content 上限超過時の分割・省略は初期実装では扱わない。
- [x] 本番 cron スケジュールは毎日 07:00 JST 相当の `0 22 * * *` にする。

## 2. Wrangler 設定を整える

- [x] `wrangler.jsonc` の `name` を実際の Worker 名に変更する。
- [x] `wrangler.jsonc` の `compatibility_date` を実日付に変更する。
- [x] `triggers.crons` を本番用の日次スケジュールに変更する。
- [ ] 前回 Discord メッセージ ID 保存用の KV namespace を作成する。
- [x] `wrangler.jsonc` に KV binding `REMINDER_STATE` を追加する。
- [x] 公開リポジトリ向けに `CALENDAR_IDS` を `wrangler.jsonc` から外す。
- [x] 祝日カレンダー除外は設定値化せず、初期実装では `日本の祝日` の固定文字列で扱う。
- [x] `pnpm run cf-typegen` を実行して `Env` 型を生成する。

## 3. Secret を設定する

- [ ] Discord Webhook URL を `DISCORD_WEBHOOK_URL` として設定する。
- [ ] `GOOGLE_CLIENT_ID`
- [ ] `GOOGLE_CLIENT_SECRET`
- [ ] `GOOGLE_REFRESH_TOKEN`
- [ ] `CALENDAR_IDS`
- [ ] Google Cloud で Calendar API を有効にする。
- [ ] OAuth client を作成する。
- [ ] `https://www.googleapis.com/auth/calendar.readonly` scope で OAuth 同意を行う。
- [ ] `access_type=offline` と、必要に応じて `prompt=consent` を使って refresh token を取得する。
- [ ] refresh token を `wrangler secret put GOOGLE_REFRESH_TOKEN` で設定する。

## 4. Google Calendar API クライアントを実装する

- [x] `https://oauth2.googleapis.com/token` に refresh token grant を送信して access token を取得する処理を実装する。
- [x] token request は `application/x-www-form-urlencoded` で送信する。
- [x] token request には `client_id`、`client_secret`、`refresh_token`、`grant_type=refresh_token` を含める。
- [x] access token は永続保存しない。
- [x] CalendarList API から対象カレンダーを取得する処理を実装する。
- [x] 除外対象カレンダーを取り除く処理を実装する。
- [x] Events API から Asia/Tokyo の当日予定を取得する処理を実装する。
- [x] 終日予定と時刻付き予定を判定する処理を実装する。
- [x] 全カレンダーの予定を統合し、終日予定を先頭、その後に時刻付き予定を開始時刻順で並べる。
- [x] Google API の失敗時に structured log を出す。

## 5. Discord 投稿処理を実装する

- [x] KV から `discord:last-message-id` を取得する。
- [x] 前回 message ID がある場合、Discord Webhook の messages endpoint へ DELETE する。
- [x] DELETE 失敗時はログを出し、投稿処理は継続する。
- [x] 新しい本文を `?wait=true` 付き Webhook に POST する。
- [x] POST 成功時、レスポンス JSON の `id` を KV に保存する。
- [x] POST 失敗時は KV を更新しない。

## 6. メッセージ生成を実装する

- [x] `本日の予定` から始まる本文を生成する。
- [x] 終日予定は `- {title}` 形式で出力する。
- [x] 時刻付き予定は `- {title}  HH:mm～HH:mm` 形式で出力する。
- [x] 日付境界と時刻表示に Asia/Tokyo を使う。
- [x] 予定がない日は `本日の予定\n\n予定はありません` を出力する。

## 7. Worker 本体へ組み込む

- [x] `src/index.ts` のテンプレート API 呼び出しを削除する。
- [x] `scheduled(event, env, ctx)` から日次リマインダー処理を呼び出す。
- [x] `fetch` handler はローカル確認用の scheduled trigger 案内またはヘルスチェックに整理する。
- [x] request/event ごとの状態をモジュールスコープに保存しない。
- [x] Promise は `await`、`return`、`void`、`ctx.waitUntil()` のいずれかで明示的に扱う。

## 8. ローカル確認

- [x] `pnpm run cf-typegen`
- [x] `pnpm exec tsc --noEmit`
- [ ] `pnpm run dev`
- [ ] `curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"` で scheduled handler を実行する。
- [ ] Discord に投稿されることを確認する。
- [ ] 2 回連続実行し、前回メッセージが削除されることを確認する。
- [ ] Google Calendar API の失敗時、Discord Webhook の失敗時のログを確認する。

## 9. デプロイ前確認

- [x] `wrangler.jsonc` の `name` が本番 Worker 名になっている。
- [x] `compatibility_date` がテンプレート値ではない。
- [x] cron schedule が本番用になっている。
- [ ] KV namespace が本番環境のものになっている。
- [ ] Discord Webhook URL が secret として設定済み。
- [ ] Google Calendar API の secret が設定済み。
- [ ] 対象カレンダーと除外条件が意図どおり。
- [ ] `pnpm run deploy` でデプロイする。
