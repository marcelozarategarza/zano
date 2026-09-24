// Entrada al panel de cocina/trabajadores. Usa su propia contraseña
// (STAFF_PASSWORD en Vercel), separada de ADMIN_PASSWORD, para que el
// personal pueda ver y mover pedidos sin tener acceso a ventas ni ganancias.
const { signStaffToken } = require('./_auth');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido.' });
    return;
  }
  try {
    const { password } = req.body || {};
    const real = process.env.STAFF_PASSWORD;
    if (!real) {
      res.status(500).json({ error: 'Falta configurar STAFF_PASSWORD en el servidor.' });
      return;
    }
    if (!password || password !== real) {
      res.status(401).json({ error: 'Contraseña incorrecta.' });
      return;
    }
    const token = signStaffToken();
    res.status(200).json({ token });
  } catch (err) {
    console.error('[staff-login] Error:', err);
    res.status(500).json({ error: 'Error del servidor.' });
  }
};
