// Sesiones con JWT. JWT_SECRET debe configurarse en Vercel (ver README) —
// aquí hay un valor de respaldo solo para que el código no truene si alguien
// lo corre sin configurar nada, pero NO lo uses así en producción.
const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'zano-dev-secret-cambia-esto-en-vercel';

function signToken(user) {
  return jwt.sign({ uid: user.id, email: user.email }, SECRET, { expiresIn: '180d' });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, SECRET);
  } catch (err) {
    return null;
  }
}

function getUserFromRequest(req) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return null;
  return verifyToken(token);
}

// Sesión de administrador (panel de negocio) — token aparte, sin ligar a
// ningún usuario, solo dice "esta persona puso la contraseña de admin".
function signAdminToken() {
  return jwt.sign({ role: 'admin' }, SECRET, { expiresIn: '30d' });
}

function getAdminFromRequest(req) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return null;
  const payload = verifyToken(token);
  return payload && payload.role === 'admin' ? payload : null;
}

module.exports = { signToken, verifyToken, getUserFromRequest, signAdminToken, getAdminFromRequest };
