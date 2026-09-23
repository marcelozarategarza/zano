// Login del panel de administración (solo para ti). Compara la contraseña
// contra ADMIN_PASSWORD (variable de entorno en Vercel — nunca la pongas en
// el código). Si es correcta, entrega un token que dura 30 días.
const { signAdminToken } = require('./_auth');

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
    if (!password || password !== real) {
      res.status(401).json({ error: 'Contraseña incorrecta.' });
      return;
    }
    const token = signAdminToken();
    res.status(200).json({ token });
  } catch (err) {
    console.error('[admin-login] Error:', err);
    res.status(500).json({ error: 'Error del servidor.' });
  }
};
