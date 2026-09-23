// Paso 2 de "olvidé mi contraseña": la persona manda el código de 6 dígitos
// que le llegó por correo + su contraseña nueva. Si el código es válido y no
// venció, actualizamos la contraseña.
const bcrypt = require('bcryptjs');
const { getPool } = require('./_db');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido.' });
    return;
  }
  try {
    const { email, code, newPassword } = req.body || {};
    if (!email || !code || !newPassword) {
      res.status(400).json({ error: 'Completa el código y tu nueva contraseña.' });
      return;
    }
    if (String(newPassword).length < 6) {
      res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
      return;
    }

    const emailLower = String(email).toLowerCase().trim();
    const pool = getPool();

    const result = await pool.query(
      'SELECT id, reset_code_hash, reset_code_expires FROM users WHERE email = $1',
      [emailLower]
    );
    const user = result.rows[0];

    // Mensaje genérico en todos los casos de fallo, para no dar pistas de
    // si el correo existe, si el código está mal, o si ya venció.
    const errorGenerico = { error: 'Ese código no es válido o ya venció. Pide uno nuevo.' };

    if (!user || !user.reset_code_hash || !user.reset_code_expires) {
      res.status(400).json(errorGenerico);
      return;
    }
    if (new Date(user.reset_code_expires).getTime() < Date.now()) {
      res.status(400).json(errorGenerico);
      return;
    }
    const codeOk = await bcrypt.compare(String(code).trim(), user.reset_code_hash);
    if (!codeOk) {
      res.status(400).json(errorGenerico);
      return;
    }

    const newHash = await bcrypt.hash(String(newPassword), 10);
    await pool.query(
      'UPDATE users SET password_hash = $1, reset_code_hash = NULL, reset_code_expires = NULL WHERE id = $2',
      [newHash, user.id]
    );

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[reset-password] Error:', err);
    res.status(500).json({ error: 'Error del servidor al restablecer la contraseña.' });
  }
};
