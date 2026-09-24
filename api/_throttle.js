// Límite de intentos de contraseña (fuerza bruta). Se guarda en la base de
// datos (no en memoria) porque cada función de Vercel puede correr en un
// contenedor distinto — si lo guardáramos en una variable normal, cada
// intento podría "olvidar" los anteriores.
//
// Cómo se usa (ver login.js, admin-login.js y staff.js):
//   1. Antes de checar la contraseña: const t = await checkThrottle(pool, 'login', identificador);
//      si t.blocked, responde 429 y no sigas.
//   2. Si la contraseña estuvo MAL: await registerFail(pool, 'login', identificador);
//   3. Si la contraseña estuvo BIEN: await registerSuccess(pool, 'login', identificador);
//
// "identificador" es a quién le contamos los intentos: el correo (en minúsculas)
// para el login de clientes, o la IP de quien está tocando la puerta para
// admin/cocina (ahí no hay una cuenta por persona, solo una contraseña compartida).
const MAX_INTENTOS = 5;
const VENTANA_MINUTOS = 15; // si el último intento fallido fue hace más de esto, el conteo se reinicia
const BLOQUEO_MINUTOS = 15; // cuánto dura el bloqueo una vez alcanzado el máximo

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'desconocida';
}

async function ensureTable(pool) {
  // Por si a alguien se le olvidó correr la parte nueva de schema.sql —
  // así este archivo nunca truena la app por una tabla faltante.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS login_throttle (
      scope TEXT NOT NULL,
      identifier TEXT NOT NULL,
      fail_count INTEGER NOT NULL DEFAULT 0,
      last_fail_at TIMESTAMPTZ,
      locked_until TIMESTAMPTZ,
      PRIMARY KEY (scope, identifier)
    )
  `);
}

async function checkThrottle(pool, scope, identifier) {
  try {
    await ensureTable(pool);
    const r = await pool.query(
      'SELECT locked_until FROM login_throttle WHERE scope = $1 AND identifier = $2',
      [scope, identifier]
    );
    if (r.rows.length === 0) return { blocked: false };
    const lockedUntil = r.rows[0].locked_until;
    if (lockedUntil && new Date(lockedUntil) > new Date()) {
      const minutosRestantes = Math.max(1, Math.ceil((new Date(lockedUntil) - new Date()) / 60000));
      return { blocked: true, minutosRestantes };
    }
    return { blocked: false };
  } catch (err) {
    console.error('[throttle] Error al revisar intentos (dejamos pasar el intento):', err);
    return { blocked: false };
  }
}

async function registerFail(pool, scope, identifier) {
  try {
    await ensureTable(pool);
    const now = new Date();
    const r = await pool.query(
      'SELECT fail_count, last_fail_at FROM login_throttle WHERE scope = $1 AND identifier = $2',
      [scope, identifier]
    );
    let failCount = 1;
    if (r.rows.length > 0) {
      const row = r.rows[0];
      const dentroDeLaVentana = row.last_fail_at && (now - new Date(row.last_fail_at)) < VENTANA_MINUTOS * 60000;
      failCount = dentroDeLaVentana ? row.fail_count + 1 : 1;
    }
    const lockedUntil = failCount >= MAX_INTENTOS ? new Date(now.getTime() + BLOQUEO_MINUTOS * 60000) : null;
    await pool.query(
      `INSERT INTO login_throttle (scope, identifier, fail_count, last_fail_at, locked_until)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (scope, identifier) DO UPDATE
         SET fail_count = $3, last_fail_at = $4, locked_until = $5`,
      [scope, identifier, failCount, now, lockedUntil]
    );
  } catch (err) {
    console.error('[throttle] Error al registrar intento fallido:', err);
  }
}

async function registerSuccess(pool, scope, identifier) {
  try {
    await pool.query('DELETE FROM login_throttle WHERE scope = $1 AND identifier = $2', [scope, identifier]);
  } catch (err) {
    console.error('[throttle] Error al limpiar intentos:', err);
  }
}

module.exports = { getClientIp, checkThrottle, registerFail, registerSuccess, BLOQUEO_MINUTOS };
