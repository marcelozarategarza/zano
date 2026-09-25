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
  reset_code_hash TEXT,
  reset_code_expires TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Si ya habías corrido este archivo antes (la tabla users ya existía sin estas
-- 2 columnas), estas líneas las agregan sin tocar nada más. Es seguro volver a
-- correr TODO este archivo otra vez, no duplica ni borra nada.
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_code_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_code_expires TIMESTAMPTZ;

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

-- Igual que arriba con reset_code_hash: si ya habías corrido este archivo,
-- estas 2 líneas agregan las columnas nuevas (horario de recogida elegido por
-- día, e institución al momento del pedido) sin tocar nada más.
ALTER TABLE weekly_orders ADD COLUMN IF NOT EXISTS horarios JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE weekly_orders ADD COLUMN IF NOT EXISTS plantel TEXT;

-- Gastos por semana (los metes tú a mano en el panel de administración) para
-- poder calcular ganancia bruta y neta junto con las ventas de weekly_orders.
CREATE TABLE IF NOT EXISTS weekly_costs (
  id SERIAL PRIMARY KEY,
  week_start DATE NOT NULL UNIQUE,
  ingredientes_cents INTEGER NOT NULL DEFAULT 0,
  empaque_cents INTEGER NOT NULL DEFAULT 0,
  otros_gastos_cents INTEGER NOT NULL DEFAULT 0,
  notas TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Estatus de preparación por día dentro de cada pedido semanal (panel de
-- cocina/trabajadores): {"Lunes": "en_proceso", "Martes": "entregado", ...}.
-- Si un día no aparece en el JSON, se trata como "pendiente".
ALTER TABLE weekly_orders ADD COLUMN IF NOT EXISTS day_status JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Croissants vendidos cada día sin pedido previo (walk-ins que llegan sin
-- haber pedido con anticipación) — un contador simple por fecha, para que
-- cocina sepa cuántos preparar en el momento.
CREATE TABLE IF NOT EXISTS croissant_counts (
  day DATE PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Límite de intentos de contraseña (login de clientes, administración y
-- cocina) — ver api/_throttle.js. "scope" distingue cuál login es
-- ('login' | 'admin' | 'staff') e "identifier" es el correo (clientes) o la
-- IP (admin/cocina, que solo tienen una contraseña compartida). Esta tabla
-- también se crea sola desde el código la primera vez que hace falta, así
-- que correr esta parte del archivo es un respaldo, no algo obligatorio.
CREATE TABLE IF NOT EXISTS login_throttle (
  scope TEXT NOT NULL,
  identifier TEXT NOT NULL,
  fail_count INTEGER NOT NULL DEFAULT 0,
  last_fail_at TIMESTAMPTZ,
  locked_until TIMESTAMPTZ,
  PRIMARY KEY (scope, identifier)
);
