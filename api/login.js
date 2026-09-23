const bcrypt = require('bcryptjs');
const { getPool } = require('./_db');
const { signToken } = require('./_auth');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido.' });
    return;
  }
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      res.status(400).json({ error: 'Completa correo y contraseña.' });
      return;
    }
    const pool = getPool();
    const emailLower = String(email).toLowerCase().trim();
    const result = await pool.query(
      'SELECT id, name, email, phone, password_hash FROM users WHERE email = $1',
      [emailLower]
    );
    if (result.rows.length === 0) {
      res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
      return;
    }
    const row = result.rows[0];
    const ok = await bcrypt.compare(String(password), row.password_hash);
    if (!ok) {
      res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
      return;
    }
    const user = { id: row.id, name: row.name, email: row.email, phone: row.phone || '' };
    const token = signToken(user);
    res.status(200).json({ token, user });
  } catch (err) {
    console.error('[login] Error:', err);
    res.status(500).json({ error: 'Error del servidor al iniciar sesión.' });
  }
};
