// Guarda (o actualiza) los gastos de una semana, para calcular ganancia
// bruta y neta junto con las ventas. Solo con token de admin.
const { getPool } = require('./_db');
const { getAdminFromRequest } = require('./_auth');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido.' });
    return;
  }
  const admin = getAdminFromRequest(req);
  if (!admin) {
    res.status(401).json({ error: 'Sesión de administrador inválida o vencida.' });
    return;
  }
  try {
    const { weekStart, ingredientesCents, empaqueCents, otrosGastosCents, notas } = req.body || {};
    if (!weekStart) {
      res.status(400).json({ error: 'Falta la semana.' });
      return;
    }
    const pool = getPool();
    await pool.query(
      `INSERT INTO weekly_costs (week_start, ingredientes_cents, empaque_cents, otros_gastos_cents, notas, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (week_start)
       DO UPDATE SET ingredientes_cents = EXCLUDED.ingredientes_cents, empaque_cents = EXCLUDED.empaque_cents,
                     otros_gastos_cents = EXCLUDED.otros_gastos_cents, notas = EXCLUDED.notas, updated_at = now()`,
      [weekStart, ingredientesCents || 0, empaqueCents || 0, otrosGastosCents || 0, notas || '']
    );
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[admin-costs] Error:', err);
    res.status(500).json({ error: 'Error del servidor al guardar los gastos.' });
  }
};
