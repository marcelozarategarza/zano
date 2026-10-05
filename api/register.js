// Crear cuenta + verificación de correo con un código de 6 dígitos (igual
// de diseño que "olvidé mi contraseña" en forgot-password.js/reset-password.js,
// pero para confirmar que el correo con el que alguien se registra es real).
//
// Junta tres acciones en un solo archivo (en vez de tres) porque el plan
// gratuito de Vercel limita a 12 funciones:
//   (sin "action", para no romper nada que ya funcionaba) -> crea la cuenta.
//   action: 'verify' -> confirma el código de 6 dígitos y marca el correo
//                        como verificado.
//   action: 'resend' -> manda un código nuevo (por si el primero venció o
//                        no llegó).
//
// Mientras el correo no esté verificado, la cuenta funciona casi normal —
// solo no puede PAGAR (ver api/mercadopago.js, que revisa email_verified
// antes de dejar pasar un pago) — así nadie se queda totalmente bloqueado
// de usar la app por no haber alcanzado a verificar todavía.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { getPool } = require('./_db');
const { signToken } = require('./_auth');
const { checkThrottle, registerFail, registerSuccess } = require('./_throttle');
const { notificarDueño, mandarCorreoCliente } = require('./_email');

const CODIGO_VIGENCIA_MIN = 30;

function generarCodigo() {
  return String(crypto.randomInt(100000, 1000000)); // 6 dígitos
}

async function enviarCodigoVerificacion(user, code) {
  return mandarCorreoCliente(
    user.email,
    user.name,
    'Verifica tu correo en ZANO',
    'Gracias por crear tu cuenta en ZANO. Para activarla, escribe este código en la app: ' + code +
    '\n\nEste código vence en ' + CODIGO_VIGENCIA_MIN + ' minutos. Mientras no lo confirmes, puedes seguir usando la app normal, pero no vas a poder pagar tu pedido todavía.' +
    '\n\nSi tú no creaste esta cuenta, ignora este correo.'
  );
}

async function handleRegister(req, res) {
  try {
    const { name, email, password, phone } = req.body || {};
    if (!name || !email || !password) {
      res.status(400).json({ error: 'Completa nombre, correo y contraseña.' });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ error: 'Ingresa un correo válido.' });
      return;
    }
    if (String(password).length < 6) {
      res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
      return;
    }

    const pool = getPool();
    const emailLower = String(email).toLowerCase().trim();

    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [emailLower]);
    if (existing.rows.length > 0) {
      res.status(409).json({ error: 'Ya existe una cuenta con ese correo. Inicia sesión.' });
      return;
    }

    const hash = await bcrypt.hash(String(password), 10);
    const code = generarCodigo();
    const codeHash = await bcrypt.hash(code, 10);
    const expires = new Date(Date.now() + CODIGO_VIGENCIA_MIN * 60 * 1000);

    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash, phone, email_verified, verify_code_hash, verify_code_expires)
       VALUES ($1, $2, $3, $4, false, $5, $6)
       RETURNING id, name, email, phone, email_verified`,
      [name, emailLower, hash, phone || '', codeHash, expires]
    );
    const row = result.rows[0];
    const user = { id: row.id, name: row.name, email: row.email, phone: row.phone, emailVerified: row.email_verified };
    const token = signToken(user);

    // Correos: esperamos a que terminen (aunque fallen, no tronamos el registro)
    // porque en Vercel la función se puede apagar en cuanto respondemos, y un
    // envío "disparado y olvidado" se cortaría a la mitad sin avisar.
    await Promise.all([
      enviarCodigoVerificacion(user, code)
        .catch((err) => { console.error('[register] Error mandando código de verificación:', err); }),
      notificarDueño('Nueva cuenta en ZANO', 'Se registró: ' + user.name + ' (' + user.email + ')')
        .catch((err) => { console.error('[register] Error avisando al dueño:', err); })
    ]);

    res.status(200).json({ token, user });
  } catch (err) {
    console.error('[register] Error:', err);
    res.status(500).json({ error: 'Error del servidor al crear la cuenta.' });
  }
}

async function handleVerify(req, res) {
  try {
    const { email, code } = req.body || {};
    if (!email || !code) {
      res.status(400).json({ error: 'Falta el correo o el código.' });
      return;
    }
    const emailLower = String(email).toLowerCase().trim();
    const pool = getPool();

    const throttle = await checkThrottle(pool, 'verify', emailLower);
    if (throttle.blocked) {
      res.status(429).json({ error: `Demasiados intentos. Pide un código nuevo en ${throttle.minutosRestantes} minutos.` });
      return;
    }

    const result = await pool.query(
      'SELECT id, email_verified, verify_code_hash, verify_code_expires FROM users WHERE email = $1',
      [emailLower]
    );
    const user = result.rows[0];
    const errorGenerico = { error: 'Ese código no es válido o ya venció. Pide uno nuevo.' };

    if (!user) {
      await registerFail(pool, 'verify', emailLower);
      res.status(400).json(errorGenerico);
      return;
    }
    if (user.email_verified) {
      res.status(200).json({ ok: true, yaVerificado: true });
      return;
    }
    if (!user.verify_code_hash || !user.verify_code_expires || new Date(user.verify_code_expires).getTime() < Date.now()) {
      await registerFail(pool, 'verify', emailLower);
      res.status(400).json(errorGenerico);
      return;
    }
    const codeOk = await bcrypt.compare(String(code).trim(), user.verify_code_hash);
    if (!codeOk) {
      await registerFail(pool, 'verify', emailLower);
      res.status(400).json(errorGenerico);
      return;
    }
    await registerSuccess(pool, 'verify', emailLower);

    await pool.query(
      'UPDATE users SET email_verified = true, verify_code_hash = NULL, verify_code_expires = NULL WHERE id = $1',
      [user.id]
    );

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[register:verify] Error:', err);
    res.status(500).json({ error: 'Error del servidor al verificar tu correo.' });
  }
}

async function handleResend(req, res) {
  try {
    const { email } = req.body || {};
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ error: 'Ingresa un correo válido.' });
      return;
    }
    const emailLower = String(email).toLowerCase().trim();
    const pool = getPool();

    const result = await pool.query('SELECT id, name, email, email_verified FROM users WHERE email = $1', [emailLower]);
    const user = result.rows[0];

    // Igual que forgot-password.js: respondemos {ok:true} exista o no la
    // cuenta, para no revelar qué correos están registrados.
    if (user && !user.email_verified) {
      const code = generarCodigo();
      const codeHash = await bcrypt.hash(code, 10);
      const expires = new Date(Date.now() + CODIGO_VIGENCIA_MIN * 60 * 1000);
      await pool.query(
        'UPDATE users SET verify_code_hash = $1, verify_code_expires = $2 WHERE id = $3',
        [codeHash, expires, user.id]
      );
      await enviarCodigoVerificacion(user, code)
        .catch((err) => { console.error('[register:resend] Error mandando código:', err); });
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[register:resend] Error:', err);
    res.status(200).json({ ok: true });
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido.' });
    return;
  }
  const { action } = req.body || {};
  if (action === 'verify') return handleVerify(req, res);
  if (action === 'resend') return handleResend(req, res);
  return handleRegister(req, res);
};
