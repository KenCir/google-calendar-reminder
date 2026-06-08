# SPEC.md

## 概要

このプロジェクトは、Google Apps Script で動かしていた「当日の Google カレンダー予定を Discord Webhook に投稿する日次リマインダー」を Cloudflare Workers の Scheduled Worker に移行する。

Cloudflare Workers では GAS の `CalendarApp`、`PropertiesService`、`UrlFetchApp` は使えないため、以下に置き換える。

- Google カレンダー取得: Google Calendar API
- Discord 送信・削除: Worker 標準の `fetch`
- 前回投稿メッセージ ID の保存: Cloudflare KV などの Worker binding
- 定期実行: Cloudflare Workers Cron Trigger

## 元 GAS の動作

`onDayRemind()` は次の処理を行っていた。

1. 現在日時を取得する。
2. script property の `MSG_ID` から前回投稿した Discord メッセージ ID を取得する。
3. 前回メッセージがあれば Discord Webhook の `/messages/{id}` に DELETE して削除する。
4. `CalendarApp.getAllCalendars()` で全カレンダーを取得する。
5. カレンダー名が `日本の祝日` のものを除外する。
6. 各カレンダーから当日の予定を取得する。
7. Discord 投稿文を生成する。
   - 先頭は `本日の予定`
   - 各予定は `- {タイトル}`
   - 終日予定でない場合は `  HH:mm～HH:mm` を追記する。
8. Discord Webhook に `?wait=true` 付きで POST する。
9. レスポンス JSON の `id` を次回削除用に保存する。

## Cloudflare Workers 版の仕様

### 実行タイミング

- `wrangler.jsonc` の `triggers.crons` で日次実行する。
- cron は毎日 07:00 JST 相当の `0 22 * * *` とする。
- Worker の cron は UTC 基準として扱う。日本時間で実行したい場合は UTC への変換を明示する。

### タイムゾーン

- 予定の対象日は Asia/Tokyo の「当日」とする。
- 予定時刻の表示も Asia/Tokyo で `HH:mm` に整形する。
- Calendar API の `timeMin` / `timeMax` は Asia/Tokyo の日付境界から生成する。

### Google Calendar API

- Cloudflare Workers から Google Calendar API を呼び出して、対象カレンダーの当日予定を取得する。
- GAS の `CalendarApp.getAllCalendars()` 相当を完全に再現するには、Google Calendar API の CalendarList と Events を使う。
- 認証方式は OAuth 2.0 refresh token 方式とする。
- refresh token、client ID、client secret は Worker secrets として保存する。
- Worker 実行時は Google OAuth token endpoint に refresh token grant を送信し、短命の access token を取得して Calendar API に使う。
- access token は永続保存しない。scheduled handler の実行ごとに取得することを基本とする。
- 必要な scope は `https://www.googleapis.com/auth/calendar.readonly` を想定する。
- access token 取得リクエストは `POST https://oauth2.googleapis.com/token` に `application/x-www-form-urlencoded` で送る。
- access token 取得リクエストには `client_id`、`client_secret`、`refresh_token`、`grant_type=refresh_token` を含める。
- `日本の祝日` カレンダーは除外する。
- 除外判定は当面、カレンダーの `summary` が `日本の祝日` と一致する場合とする。
- 対象カレンダーは `CALENDAR_IDS` で絞り込める。空文字の場合は CalendarList API でアクセス可能な全カレンダーを対象にする。
- `CALENDAR_IDS` を指定した場合は、指定順に Events API を呼び出す。CalendarList に存在しない ID でも、指定された ID として取得を試みる。
- 予定は各カレンダーの `events.list` で取得する。
- 終日予定は `event.start.date` がある予定として扱い、時刻を表示しない。
- 時刻付き予定は `event.start.dateTime` と `event.end.dateTime` を Asia/Tokyo の `HH:mm` で表示する。

### Discord Webhook

- Discord Webhook URL は secret として保存し、ソースコードや `wrangler.jsonc` に直接書かない。
- 投稿は `POST {DISCORD_WEBHOOK_URL}?wait=true` に JSON `{ "content": "..." }` を送る。
- 前回投稿メッセージ ID が保存されている場合は、投稿前に `DELETE {DISCORD_WEBHOOK_URL}/messages/{messageId}` を実行する。
- DELETE が失敗しても、元 GAS と同じくリマインダー投稿自体は継続する。
- POST が失敗した場合は、新しいメッセージ ID を保存しない。

### メッセージ ID の保存

- GAS の `PropertiesService.getScriptProperties()` は Cloudflare Workers では使えない。
- 前回投稿メッセージ ID は Worker binding の永続ストレージに保存する。
- 推奨は Cloudflare KV。
- KV key は `discord:last-message-id` とする。

### メッセージ形式

投稿本文は元 GAS の形式を維持する。

```text
本日の予定

- 予定タイトル
- 時刻付き予定  09:00～10:00
```

- 予定がない場合は、予定なしメッセージを明示する。

```text
本日の予定

予定はありません
```

- Discord の content 上限を超えるケースは初期実装では考慮しない。

## 必要な設定

### Secrets

以下は `wrangler secret put` で設定する。

- `DISCORD_WEBHOOK_URL`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REFRESH_TOKEN`
- `CALENDAR_IDS`

`CALENDAR_IDS` はカレンダー ID のカンマ区切り文字列とする。カレンダー ID は厳密な secret ではないが、メールアドレスや用途が含まれる可能性があるため、公開リポジトリでは `wrangler.jsonc` に書かず、secret またはローカルの `.dev.vars` で管理する。

ローカル開発では `.dev.vars` に `CALENDAR_IDS=primary,calendar-id-1,calendar-id-2` の形式で書く。本番では `wrangler secret put CALENDAR_IDS` で設定する。

Google OAuth refresh token の取得は、実装前または初回セットアップ時に手動で行う。

1. Google Cloud で OAuth client を作成する。
2. Calendar API を有効にする。
3. scope に `https://www.googleapis.com/auth/calendar.readonly` を指定する。
4. `access_type=offline` と、必要に応じて `prompt=consent` を付けて認可 URL を開く。
5. 取得した authorization code を `https://oauth2.googleapis.com/token` に交換して refresh token を得る。
6. refresh token を `wrangler secret put GOOGLE_REFRESH_TOKEN` で保存する。

refresh token 取得用の一時スクリプトや URL 生成処理を作る場合でも、client secret や refresh token をリポジトリに保存しない。

### Bindings

前回投稿メッセージ ID 保存用に KV namespace を追加する。

想定 binding 名:

- `REMINDER_STATE`

## 確定した判断

- 予定がない日は `本日の予定\n\n予定はありません` を投稿する。
- Discord content 上限超過時の分割・省略は初期実装では行わない。
- Google Calendar API の認証方式は OAuth 2.0 refresh token 方式とする。
- 対象カレンダーは `CALENDAR_IDS` が未設定または空なら全取得、値があれば明示リストに絞って指定順に扱う。
- メッセージの並び順は、全カレンダーの予定を統合して開始時刻順にする。
- 終日予定は時刻付き予定より前に並べる。終日予定同士の順序は Calendar API から取得した順序を維持する。
- 祝日カレンダーの除外条件は、当面 `summary === "日本の祝日"` の固定文字列とする。

## 非目標

- Discord bot token を使った Bot 実装は行わない。
- Google Apps Script の実行環境は使わない。
- Web UI は作らない。
- 複数 Discord チャンネルへの配信は初期移行の対象外とする。
