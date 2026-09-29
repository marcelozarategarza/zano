// Login del panel de administración (solo para ti). Ahora pide DOS cosas:
// el correo (tiene que estar en ADMIN_EMAILS, variable de entorno en Vercel
// con uno o varios correos separados por coma) y la contraseña compartida
// (ADMIN_PASSWORD). No es un inicio de sesión real de Gmail/iCloud — el
// correo no tiene que existir de verdad, es solo un segundo dato que tiene
// que coincidir, igual que la contraseña. Si todo es correcto, entrega un
// token que dura 30 días, y te avisa por correo (a zano.ayuda@gmail.com)
// con cuál correo se entró, por si algún día no fuiste tú.
const { getPool } = require('./_db');
const { signAdminToken, emailPermitido } = require('./_auth');
const { getClientIp, checkThrottle, registerFail, registerSuccess } = require('./_throttle');
const { notificarDueño } = require('./_email');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido.' });
    return;
  }
  try {
    const { email, password } = req.body || {};
    const real = process.env.ADMIN_PASSWORD;
    if (!real) {
      res.status(500).json({ error: 'Falta configurar ADMIN_PASSWORD en el servidor.' });
      return;
    }
    if (!process.env.ADMIN_EMAILS) {
      res.status(500).json({ error: 'Falta configurar ADMIN_EMAILS en el servidor.' });
      return;
    }
    if (!email || !password) {
      res.status(400).json({ error: 'Escribe el correo y la contraseña.' });
      return;
    }

    // Aquí no hay una cuenta por persona (es una contraseña compartida),
    // así que el límite de intentos se cuenta por dirección IP de quien toca
    // la puerta, para que alguien probando al azar se bloquee.
    const pool = getPool();
    const ip = getClientIp(req);
    const throttle = await checkThrottle(pool, 'admin', ip);
    if (throttle.blocked) {
      res.status(429).json({ error: `Demasiados intentos fallidos. Espera ${throttle.minutosRestantes} minuto(s) e intenta de nuevo.` });
      return;
    }

    // Mensaje genérico en ambos casos (correo no permitido o contraseña
    // mala) para no darle pistas a quien esté adivinando de cuál de las dos
    // cosas falló.
    if (!emailPermitido(email, process.env.ADMIN_EMAILS) || password !== real) {
      await registerFail(pool, 'admin', ip);
      res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
      return;
    }
    await registerSuccess(pool, 'admin', ip);
    const token = signAdminToken();

    const emailLower = String(email).trim().toLowerCase();
    notificarDueño(
      'ZANO: inicio de sesión en Administración',
      `Se inició sesión en el panel de Administración con el correo: ${emailLower}.`
    ).catch((err) => { console.error('[admin-login] Error avisando inicio de sesión:', err); });

    res.status(200).json({ token });
  } catch (err) {
    console.error('[admin-login] Error:', err);
    res.status(500).json({ error: 'Error del servidor.' });
  }
};
