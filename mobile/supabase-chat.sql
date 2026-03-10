-- ─────────────────────────────────────────────────────────────────────────────
-- Chat System: chat_threads and chat_messages tables
-- Run this in Supabase SQL Editor to enable shared real-time chat
-- ─────────────────────────────────────────────────────────────────────────────

-- ── chat_threads ─────────────────────────────────────────────────────────────
-- One thread per (farmstand, participant pair). Both users see the same thread.
CREATE TABLE IF NOT EXISTS public.chat_threads (
  id                  text PRIMARY KEY,
  farmstand_id        text NOT NULL,
  farmstand_name      text NOT NULL,
  farmstand_photo_url text,
  participant_user_ids text[] NOT NULL,  -- [guestUserId, ownerUserId]
  last_message_text   text NOT NULL DEFAULT '',
  last_message_at     timestamptz NOT NULL DEFAULT now(),
  last_message_sender_id text NOT NULL DEFAULT '',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- ── chat_messages ─────────────────────────────────────────────────────────────
-- Individual messages inside a thread.
CREATE TABLE IF NOT EXISTS public.chat_messages (
  id              text PRIMARY KEY,
  thread_id       text NOT NULL REFERENCES public.chat_threads(id) ON DELETE CASCADE,
  farmstand_id    text NOT NULL,
  sender_user_id  text NOT NULL,
  recipient_id    text,                  -- the other participant (non-sender)
  sender_role     text NOT NULL CHECK (sender_role IN ('guest','farmer','admin')),
  sender_name     text NOT NULL,
  text            text NOT NULL,
  read            boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Migration: add recipient_id and read columns if table already exists
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS recipient_id text;
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS read boolean NOT NULL DEFAULT false;

-- ── chat_thread_states ────────────────────────────────────────────────────────
-- Per-user unread/hidden state for a thread.
CREATE TABLE IF NOT EXISTS public.chat_thread_states (
  thread_id    text NOT NULL REFERENCES public.chat_threads(id) ON DELETE CASCADE,
  user_id      text NOT NULL,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  unread_count integer NOT NULL DEFAULT 0,
  hidden_at    timestamptz,
  PRIMARY KEY (thread_id, user_id)
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS chat_threads_farmstand_id_idx
  ON public.chat_threads (farmstand_id);

CREATE INDEX IF NOT EXISTS chat_threads_participant_idx
  ON public.chat_threads USING GIN (participant_user_ids);

CREATE INDEX IF NOT EXISTS chat_messages_thread_id_idx
  ON public.chat_messages (thread_id, created_at ASC);

CREATE INDEX IF NOT EXISTS chat_thread_states_user_id_idx
  ON public.chat_thread_states (user_id);

-- ── Row Level Security ────────────────────────────────────────────────────────
ALTER TABLE public.chat_threads       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_thread_states ENABLE ROW LEVEL SECURITY;

-- chat_threads: participants can read their own threads
DROP POLICY IF EXISTS "participants can select threads" ON public.chat_threads;
CREATE POLICY "participants can select threads"
  ON public.chat_threads FOR SELECT
  USING (auth.uid()::text = ANY(participant_user_ids));

-- chat_threads: authenticated users can insert
DROP POLICY IF EXISTS "authenticated users can insert threads" ON public.chat_threads;
CREATE POLICY "authenticated users can insert threads"
  ON public.chat_threads FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- chat_threads: participants can update
DROP POLICY IF EXISTS "participants can update threads" ON public.chat_threads;
CREATE POLICY "participants can update threads"
  ON public.chat_threads FOR UPDATE
  USING (auth.uid()::text = ANY(participant_user_ids));

-- chat_messages: participants of the thread can read messages
DROP POLICY IF EXISTS "participants can select messages" ON public.chat_messages;
CREATE POLICY "participants can select messages"
  ON public.chat_messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.chat_threads t
      WHERE t.id = chat_messages.thread_id
        AND auth.uid()::text = ANY(t.participant_user_ids)
    )
  );

-- chat_messages: authenticated users can insert
DROP POLICY IF EXISTS "authenticated users can insert messages" ON public.chat_messages;
CREATE POLICY "authenticated users can insert messages"
  ON public.chat_messages FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL AND auth.uid()::text = sender_user_id);

-- chat_messages: recipients can mark messages as read (update read flag)
DROP POLICY IF EXISTS "recipients can mark messages read" ON public.chat_messages;
CREATE POLICY "recipients can mark messages read"
  ON public.chat_messages FOR UPDATE
  USING (
    auth.uid()::text = recipient_id
    OR EXISTS (
      SELECT 1 FROM public.chat_threads t
      WHERE t.id = chat_messages.thread_id
        AND auth.uid()::text = ANY(t.participant_user_ids)
    )
  );

-- chat_thread_states: users manage their own state
DROP POLICY IF EXISTS "users manage own thread states" ON public.chat_thread_states;
CREATE POLICY "users manage own thread states"
  ON public.chat_thread_states FOR ALL
  USING (auth.uid()::text = user_id)
  WITH CHECK (auth.uid()::text = user_id);
