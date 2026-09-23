// Paso 1 de "olvidé mi contraseña": la persona da su correo, y si existe una
// cuenta con ese correo le mandamos un código de 6 dígitos por email (válido
// 15 minutos). Por seguridad, SIEMPRE respondemos {ok:true} exista o no la
// cuenta — así nadie puede usar este endpoint para adivinar qué correos
// están registrados en ZANO.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { getPool } = require('./_db');
const { mandarCorreoCliente } = require('./_email');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido.' });
    return;
  }
  try {
    const { email } = req.body || {};
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ error: 'Ingresa un correo válido.' });
      return;
    }
    const emailLower = String(email).toLowerCase().trim();
    const pool = getPool();

    const result = await pool.query('SELECT id, name, email FROM users WHERE email = $1', [emailLower]);
    const user = result.rows[0];

    if (user) {
      const code = String(crypto.randomInt(100000, 1000000)); // 6 dígitos
      const codeHash = await bcrypt.hash(code, 10);
      const expires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutos

      await pool.query(
        'UPDATE users SET reset_code_hash = $1, reset_code_expires = $2 WHERE id = $3',
        [codeHash, expires, user.id]
      );

      // Esperamos a que el correo termine de enviarse antes de responder
      // (si no, Vercel puede apagar la función a la mitad — ver register.js).
      await mandarCorreoCliente(
        user.email,
        user.name,
        'Tu código para restablecer tu contraseña en ZANO',
        'Tu código para restablecer tu contraseña es: ' + code + '\n\nEste código vence en 15 minutos. Si tú no pediste este cambio, ignora este correo — tu contraseña sigue igual.'
      ).catch((err) => { console.error('[forgot-password] Error mandando código:', err); });
    }

    // Misma respuesta exista o no la cuenta, para no revelar qué correos están registrados.
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[forgot-password] Error:', err);
    // Tampoco revelamos detalles del error aquí por la misma razón.
    res.status(200).json({ ok: true });
  }
};
