# Setup Guide — Evermount Construction AI Task Bot

Follow these once, top to bottom. Budget ~45 min. Everything here is free tier
except the Claude API (a few cents/month at your volume).

You'll fill in secret values as you go. Keep a scratch note open to paste them.

---

## 1. Create the Telegram bot (@BotFather)

1. In Telegram, search **@BotFather** → `/newbot`.
2. Name it `Evermount Task Bot`, username e.g. `evermount_task_bot`.
3. BotFather gives you a **token** like `123456:ABC...`. → this is `TELEGRAM_BOT_TOKEN`.

## 2. Create the group + add the bot

1. Make a Telegram **group** (this is where summaries/reminders post).
2. Add your bot to the group.
3. In BotFather: `/setprivacy` → select your bot → **Disable** (so the bot can
   read group messages if ever needed). Optional but recommended.

## 3. Get the group chat ID

1. Send any message in the group.
2. Open in a browser (paste your token):
   `https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getUpdates`
3. Find `"chat":{"id":-100xxxxxxxxxx,...}`. The negative number is
   `TELEGRAM_GROUP_CHAT_ID`.

## 4. Get YOUR Telegram user ID

1. Message **@userinfobot** in Telegram → it replies with your numeric **Id**.
2. That number is what you put in the `authorized_users` table (step 6).

## 5. Anthropic (Claude) API key

1. Go to **console.anthropic.com** → API Keys → create key. → `ANTHROPIC_API_KEY`.

## 6. Supabase — database

1. Create a project at **supabase.com** (free). Note the project's:
   - **Project URL** (`https://xxxx.supabase.co`) → `SUPABASE_URL`
   - **service_role** key (Settings → API) → `SUPABASE_SERVICE_ROLE_KEY`
   - **Project ref** = the `xxxx` part of the URL.
2. Open **SQL Editor** → paste the whole of `supabase/schema.sql` → **Run**.
3. In that SQL, before running (or run again after editing), un-comment the
   **seed** block and put your Telegram user ID from step 4:
   ```sql
   insert into authorized_users (telegram_user_id, name)
   values (YOUR_ID_HERE, 'You') on conflict do nothing;
   ```

## 7. Deploy the webhook to Vercel

1. Push this folder to a GitHub repo (or use `vercel` CLI).
2. On **vercel.com** → New Project → import the repo.
3. Add **Environment Variables** (Settings → Environment Variables) — copy from
   `.env.example`:
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_WEBHOOK_SECRET`  ← invent a long random string
   - `TELEGRAM_GROUP_CHAT_ID`
   - `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
4. Deploy. Your function URL will be:
   `https://<your-project>.vercel.app/api/telegram`

## 8. Point Telegram at your webhook

Paste in a browser (fill in token, URL, and the same secret you set above):

```
https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=https://<your-project>.vercel.app/api/telegram&secret_token=<TELEGRAM_WEBHOOK_SECRET>
```

You should see `{"ok":true,...}`. Now DM your bot `/start` — it should reply.

## 9. Deploy the scheduler (Supabase Edge Function)

Install the Supabase CLI, then from this folder:

```bash
supabase login
supabase link --project-ref <YOUR-PROJECT-REF>
supabase functions deploy scheduler --no-verify-jwt
supabase secrets set \
  TELEGRAM_BOT_TOKEN=<...> \
  TELEGRAM_GROUP_CHAT_ID=<...> \
  SCHEDULER_SECRET=<invent-a-long-random-string>
```

## 10. Turn on the clock (pg_cron)

In Supabase **SQL Editor**, un-comment and run the `cron.schedule(...)` block at
the bottom of `schema.sql`, filling in:
- `YOUR-PROJECT-REF`
- `YOUR-SCHEDULER-SECRET` (must equal the `SCHEDULER_SECRET` from step 9)

Done. The bot now runs 24/7.

---

## Test it

1. DM the bot: *"this friday pipe installation at 19 hillview, subcon muthu, remind 1 day before"*
2. It shows a confirm card → tap **Confirm & save**.
3. Check the `tasks` table in Supabase — your row is there with `reminder_at` set.
4. The group will get the reminder at 7pm the day before, and summaries at 8am/1pm/6pm.

### Quick checks
- Nothing happening on schedule? In SQL Editor: `select * from cron.job;` and
  `select * from scheduler_log order by ran_at desc;`
- Webhook issues? `https://api.telegram.org/bot<TOKEN>/getWebhookInfo`

## Adding your MD later
```sql
insert into authorized_users (telegram_user_id, name) values (123, 'MD');
```
They must DM the bot once first (Telegram requirement) before it can message them.
