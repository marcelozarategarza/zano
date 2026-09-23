const bcrypt = require('bcryptjs');
const { getPool } = require('./_db');
const { signToken } = require('./_auth');
const { notificarDueño, mandarCorreoCliente } = require('./_email');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido.' });
    return;
  }
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
    const result = await pool.query(
      'INSERT INTO users (name, email, password_hash, phone) VALUES ($1, $2, $3, $4) RETURNING id, name, email, phone',
      [name, emailLower, hash, phone || '']
    );
    const user = result.rows[0];
    const token = signToken(user);

    // Correos: no bloqueamos la respuesta por esto, y si fallan no tronamos el registro.
    mandarCorreoCliente(
      user.email,
      user.name,
      'Bienvenido a ZANO',
      'Gracias por crear tu cuenta en ZANO. Ya puedes entrar a la app y armar tu semana de comida sana.'
    ).catch(() => {});
    notificarDueño('Nueva cuenta en ZANO', 'Se registró: ' + user.name + ' (' + user.email + ')').catch(() => {});

    res.status(200).json({ token, user });
  } catch (err) {
    console.error('[register] Error:', err);
    res.status(500).json({ error: 'Error del servidor al crear la cuenta.' });
  }
};
