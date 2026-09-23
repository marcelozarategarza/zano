-- ZANO — esquema de base de datos (Postgres / Neon)
-- Corre este archivo UNA VEZ, completo, en el "SQL Editor" de tu base de datos
-- (ver README, sección "Base de datos") antes de usar el backend.

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  plantel TEXT,
  last_reminder_week DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS weekly_orders (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  items JSONB NOT NULL DEFAULT '{}'::jsonb,
  total_cents INTEGER,
  status TEXT NOT NULL DEFAULT 'draft', -- 'draft' | 'paid'
  payment_id TEXT,
  abandoned_reminder_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at TIMESTAMPTZ,
  UNIQUE (user_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_weekly_orders_user ON weekly_orders (user_id);
CREATE INDEX IF NOT EXISTS idx_weekly_orders_status ON weekly_orders (status);
