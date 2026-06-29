# 🏗️ Evermount Construction AI Task Bot

A Telegram bot that turns plain-language messages into scheduled construction
tasks and keeps the team on top of main-contractor / subcontractor jobs — with
AI-powered date parsing, automatic reminders, and daily status summaries.

> _"this friday pipe installation at 19 hillview, subcon muthu, remind 1 day before"_
> → ✅ parsed, confirmed, scheduled, and reminded — automatically.

---

## ✨ Features

- **Talk normally.** No rigid commands. Claude reads your message and extracts
  **Task · Date · Time · Location · Who**.
- **Understands real dates.** "this friday", "tomorrow", "next monday" → resolved
  to the actual calendar date in Singapore time.
- **Confirms before saving.** A tidy card with ✅ Confirm / ✖️ Discard buttons —
  a wrong date never sneaks in.
- **Asks when unsure.** Missing the location or the subcontractor? The bot asks a
  follow-up instead of saving blanks.
- **Multiple jobs at once.** Two sites in one message become two separate tasks.
- **Reminders to the group.** 7pm the day before each job, posted to your Telegram
  group (copy straight into WhatsApp).
- **Daily summaries.** Morning / afternoon / evening (8am · 1pm · 6pm) status
  digests: today's jobs + anything overdue.
- **Close the loop.** Mark jobs **done / incomplete**, add **remarks**, or
  **reschedule** (e.g. rain) — by chat or by tapping buttons. An end-of-day prompt
  nudges you to settle the day's open jobs.
- **Access control.** Only allowlisted Telegram users can manage tasks. Add your
  MD later with a single SQL row.

---

## 🧩 How it works

```
   You (private chat)                         Telegram group
        │  "this fri pipe @ hillview…"             ▲
        ▼                                          │ reminders + 8am/1pm/6pm summaries
┌──────────────────┐   parse    ┌──────────────┐  │
│ Vercel webhook   │──────────▶ │  Claude API  │  │
│ api/telegram.ts  │ ◀────────── │  (extract)  │  │
└────────┬─────────┘  tasks      └──────────────┘  │
         │ read/write                              │
         ▼                                         │
┌──────────────────┐   every minute   ┌───────────┴────────────┐
│ Supabase Postgres│ ◀─── pg_cron ───▶ │ Edge Function scheduler│
│ tasks · users    │                   │ reminders · summaries  │
└──────────────────┘                   └────────────────────────┘
```

| Piece | Tech | Role |
|------|------|------|
| Chat handling | **Vercel** serverless (`api/telegram.ts`) | Telegram webhook |
| Understanding text | **Claude API** (`lib/anthropic.ts`) | parse + resolve dates |
| Storage | **Supabase Postgres** (`supabase/schema.sql`) | tasks, users, state |
| Clock | **Supabase pg_cron → Edge Function** (`supabase/functions/scheduler`) | reminders & summaries |

Everything runs on **free tiers**; the only usage cost is the Claude API (a few
cents/month at typical volume).

---

## 🚀 Quick start

Full step-by-step (≈45 min, mostly copy-paste) is in **[SETUP.md](SETUP.md)**.

In short:

1. Create the bot with **@BotFather** and a Telegram group.
2. Create a **Supabase** project and run [`supabase/schema.sql`](supabase/schema.sql).
3. Deploy `api/telegram.ts` to **Vercel** with the env vars from
   [`.env.example`](.env.example).
4. Point Telegram's webhook at your Vercel URL.
5. Deploy the **scheduler** Edge Function and turn on **pg_cron**.

---

## 🗂️ Project layout

```
api/telegram.ts                  Webhook: create/update/confirm, buttons, follow-ups
lib/anthropic.ts                 Claude parsing (new tasks, updates, date resolve)
lib/supabase.ts                  DB client + queries + conversation state
lib/telegram.ts                  Telegram API helpers
lib/time.ts                      Singapore time + reminder math
lib/format.ts                    Message formatting
supabase/schema.sql              Tables + pg_cron setup
supabase/functions/scheduler/    Edge Function: reminders, summaries, EOD prompts
.env.example                     All required secrets
SETUP.md                         Step-by-step deployment guide
```

---

## ⚙️ Configuration

All secrets are documented in [`.env.example`](.env.example): Telegram bot token &
webhook secret, group chat ID, Anthropic API key & model, and Supabase URL &
service-role key. Timezone is fixed to **Asia/Singapore (UTC+8)**.

---

## 🗺️ Roadmap

**Shipped in V1:** natural-language create (multi-task by location),
confirm-before-save, follow-up questions, single reminder (7pm day before),
3× daily summaries, done/incomplete/remark, reschedule, end-of-day prompts,
access allowlist.

**Next up:** 📷 photo + caption capture · ❓ "what's on today?" query ·
🔁 recurring jobs · 📊 weekly report · 📑 Excel sync.

---

## 📝 License

Private project for Evermount Construction.
