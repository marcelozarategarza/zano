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

-- Verificación de correo al crear cuenta: un código de 6 dígitos que se
-- manda por correo (igual que el de "olvidé mi contraseña", pero para
-- confirmar que el correo es real). "DEFAULT true" es a propósito: así,
-- las cuentas que YA EXISTÍAN antes de este cambio quedan marcadas como
-- verificadas automáticamente (nunca se les pide un código que no tenían
-- forma de conocer) — solo las cuentas NUEVAS nacen con email_verified en
-- false (eso lo pone a mano api/register.js al crearlas).
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS verify_code_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS verify_code_expires TIMESTAMPTZ;

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

-- Dos gastos nuevos que también se restan en Ganancia bruta: lo que se le
-- paga a la institución (comisión) y el salario del personal, además de
-- Ingredientes/Empaque/Otros gastos que ya existían.
ALTER TABLE weekly_costs ADD COLUMN IF NOT EXISTS comision_instituto_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE weekly_costs ADD COLUMN IF NOT EXISTS salario_staff_cents INTEGER NOT NULL DEFAULT 0;

-- Un solo valor fijo (no por semana) que tú capturas una sola vez: el "valor
-- de referencia" que se usa para calcular Ganancia neta (Ganancia neta =
-- este valor − $20 por cada pedido pagado de la semana). Es una tabla de una
-- sola fila (id siempre 1) que se crea vacía en $0 y tú la editas desde el
-- panel de administración, pestaña "Gastos".
CREATE TABLE IF NOT EXISTS business_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  meta_recuperacion_cents BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO business_settings (id, meta_recuperacion_cents) VALUES (1, 0)
ON CONFLICT (id) DO NOTHING;

-- Precio de un croissant (los únicos que se venden en el momento, sin pedido
-- previo — todo lo demás del menú se paga con anticipación en la app). Se
-- captura una sola vez, igual que el valor de referencia de arriba, y se
-- edita desde el panel de administración, pestaña "Gastos".
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS croissant_price_cents INTEGER NOT NULL DEFAULT 0;

-- Estatus de preparación por día dentro de cada pedido semanal (panel de
-- cocina/trabajadores): {"Lunes": "en_proceso", "Martes": "entregado", ...}.
-- Si un día no aparece en el JSON, se trata como "pendiente".
ALTER TABLE weekly_orders ADD COLUMN IF NOT EXISTS day_status JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Croissants vendidos cada día sin pedido previo (walk-ins que llegan sin
-- haber pedido con anticipación) — se deja esta tabla vieja sin usar (no
-- borra nada), pero desde ahora se usa croissant_sales de abajo, que separa
-- el conteo por cómo se cobró (efectivo o tarjeta), para que ese registro
-- pueda llegar como venta real al panel de administración.
CREATE TABLE IF NOT EXISTS croissant_counts (
  day DATE PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Reemplaza a croissant_counts: un contador por día Y por forma de pago
-- (efectivo o tarjeta). Cada vez que cocina toca "+" en Efectivo o en
-- Tarjeta, suma 1 aquí — la fecha (day) siempre es HOY, automática. Con esto
-- más el precio del croissant (business_settings.croissant_price_cents),
-- Administración arma las ventas de croissants por semana, mostradas aparte
-- de las ventas de platillos con pedido previo.
CREATE TABLE IF NOT EXISTS croissant_sales (
  day DATE NOT NULL,
  payment_method TEXT NOT NULL, -- 'efectivo' | 'tarjeta'
  quantity INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (day, payment_method)
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
