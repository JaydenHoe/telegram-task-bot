-- ============================================================
-- Evermount Construction AI Task Bot  —  Database schema
-- Run this in the Supabase SQL Editor (one time).
-- ============================================================

-- ---- Extensions (used by the scheduler) ----
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ============================================================
-- 1) Who is allowed to control the bot (the allowlist)
--    Start with just you. Add your MD later with one INSERT.
-- ============================================================
create table if not exists authorized_users (
  telegram_user_id bigint primary key,
  name             text not null,
  can_manage       boolean not null default true,  -- can create/update tasks
  created_at       timestamptz not null default now()
);

-- ============================================================
-- 2) Tasks
-- ============================================================
create table if not exists tasks (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,                 -- e.g. "Pipe installation"
  task_date     date not null,                 -- e.g. 2026-07-03
  task_time     time,                          -- optional, e.g. 09:00
  location      text,                          -- e.g. "19 Hillview"
  who           text,                          -- subcontractor, e.g. "Muthu"
  remind_offset_days int not null default 1,   -- "1 day before"
  reminder_at   timestamptz,                   -- exact UTC instant to fire the reminder
  reminder_sent boolean not null default false,
  status        text not null default 'pending'  -- pending | done | incomplete | cancelled
                check (status in ('pending','done','incomplete','cancelled')),
  remarks       text,
  created_by    bigint references authorized_users(telegram_user_id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists tasks_date_idx     on tasks (task_date);
create index if not exists tasks_status_idx   on tasks (status);
create index if not exists tasks_reminder_idx on tasks (reminder_at) where reminder_sent = false;

-- keep updated_at fresh
create or replace function set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

drop trigger if exists tasks_updated_at on tasks;
create trigger tasks_updated_at before update on tasks
for each row execute function set_updated_at();

-- ============================================================
-- 3) Conversation state (for follow-up questions, confirmations,
--    reschedule prompts, end-of-day completion prompts)
-- ============================================================
create table if not exists pending_actions (
  id               uuid primary key default gen_random_uuid(),
  telegram_user_id bigint not null,
  kind             text not null,   -- 'confirm_new' | 'ask_field' | 'await_reschedule_date' | 'eod_review'
  payload          jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);
create index if not exists pending_user_idx on pending_actions (telegram_user_id);

-- ============================================================
-- 4) Track which summaries / EOD prompts already went out today
--    (so the every-minute cron doesn't double-send)
-- ============================================================
create table if not exists scheduler_log (
  job_key   text not null,   -- e.g. 'summary_morning', 'summary_afternoon', 'summary_evening', 'eod'
  run_date  date not null,   -- Singapore date
  ran_at    timestamptz not null default now(),
  primary key (job_key, run_date)
);

-- ============================================================
-- 5) Seed yourself as the first authorized user
--    >>> REPLACE 123456789 with YOUR Telegram user id (see SETUP.md step 4) <<<
-- ============================================================
-- insert into authorized_users (telegram_user_id, name)
-- values (123456789, 'You') on conflict do nothing;

-- ============================================================
-- 6) Schedule the bot's clock (runs the Edge Function every minute).
--    The function itself decides what (if anything) is due right now.
--    >>> Fill in YOUR-PROJECT-REF and YOUR-SCHEDULER-SECRET below.   <<<
--    YOUR-SCHEDULER-SECRET must match the SCHEDULER_SECRET you set on
--    the Edge Function (see SETUP.md).
-- ============================================================
-- select cron.schedule(
--   'evermount-scheduler',
--   '* * * * *',  -- every minute
--   $$
--   select net.http_post(
--     url     := 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/scheduler',
--     headers := jsonb_build_object(
--                  'Content-Type', 'application/json',
--                  'x-scheduler-secret', 'YOUR-SCHEDULER-SECRET'
--                ),
--     body    := '{}'::jsonb
--   );
--   $$
-- );

-- To remove the schedule later:  select cron.unschedule('evermount-scheduler');
