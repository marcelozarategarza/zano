// Contador de croissants vendidos HOY sin pedido previo (walk-ins que
// llegan sin haber pedido con anticipación). Cada llamada suma o resta 1,
// nunca baja de 0. Solo con sesión de personal o de admin.
const { getPool } = require('./_db');
const { getStaffFromRequest } = require('./_auth');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido.' });
    return;
  }
  const staff = getStaffFromRequest(req);
  if (!staff) {
    res.status(401).json({ error: 'Sesión inválida o vencida.' });
    return;
  }
  try {
    const delta = (req.body && req.body.delta === -1) ? -1 : 1;
    const pool = getPool();
    const r = await pool.query(
      `INSERT INTO croissant_counts (day, count, updated_at)
       VALUES (CURRENT_DATE, GREATEST($1, 0), now())
       ON CONFLICT (day) DO UPDATE
         SET count = GREATEST(croissant_counts.count + $1, 0), updated_at = now()
       RETURNING count`,
      [delta]
    );
    res.status(200).json({ ok: true, count: r.rows[0].count });
  } catch (err) {
    console.error('[staff-croissant] Error:', err);
    res.status(500).json({ error: 'Error del servidor al actualizar el conteo.' });
  }
};
