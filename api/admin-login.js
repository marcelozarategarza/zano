// Login del panel de administración (solo para ti). Compara la contraseña
// contra ADMIN_PASSWORD (variable de entorno en Vercel — nunca la pongas en
// el código). Si es correcta, entrega un token que dura 30 días.
const { getPool } = require('./_db');
const { signAdminToken } = require('./_auth');
const { getClientIp, checkThrottle, registerFail, registerSuccess } = require('./_throttle');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido.' });
    return;
  }
  try {
    const { password } = req.body || {};
    const real = process.env.ADMIN_PASSWORD;
    if (!real) {
      res.status(500).json({ error: 'Falta configurar ADMIN_PASSWORD en el servidor.' });
      return;
    }

    // Aquí no hay una cuenta por persona (es una sola contraseña compartida),
    // así que el límite de intentos se cuenta por dirección IP de quien toca
    // la puerta, para que alguien probando contraseñas al azar se bloquee.
    const pool = getPool();
    const ip = getClientIp(req);
    const throttle = await checkThrottle(pool, 'admin', ip);
    if (throttle.blocked) {
      res.status(429).json({ error: `Demasiados intentos fallidos. Espera ${throttle.minutosRestantes} minuto(s) e intenta de nuevo.` });
      return;
    }

    if (!password || password !== real) {
      await registerFail(pool, 'admin', ip);
      res.status(401).json({ error: 'Contraseña incorrecta.' });
      return;
    }
    await registerSuccess(pool, 'admin', ip);
    const token = signAdminToken();
    res.status(200).json({ token });
  } catch (err) {
    console.error('[admin-login] Error:', err);
    res.status(500).json({ error: 'Error del servidor.' });
  }
};
