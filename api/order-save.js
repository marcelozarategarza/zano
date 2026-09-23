// Guarda (o actualiza) el pedido "en borrador" de la semana en curso. La app
// lo llama sola cuando la persona entra a la pantalla de Pagar — así, si deja
// el pedido a medias sin pagar, el cron de abandonados lo puede detectar.
const { getPool } = require('./_db');
const { getUserFromRequest } = require('./_auth');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido.' });
    return;
  }
  const auth = getUserFromRequest(req);
  if (!auth) {
    res.status(401).json({ error: 'Sesión inválida o vencida.' });
    return;
  }
  try {
    const { weekStart, items, totalCents } = req.body || {};
    if (!weekStart) {
      res.status(400).json({ error: 'Falta la semana del pedido.' });
      return;
    }
    const pool = getPool();
    await pool.query(
      `INSERT INTO weekly_orders (user_id, week_start, items, total_cents, status, updated_at)
       VALUES ($1, $2, $3, $4, 'draft', now())
       ON CONFLICT (user_id, week_start)
       DO UPDATE SET items = EXCLUDED.items, total_cents = EXCLUDED.total_cents, updated_at = now()
       WHERE weekly_orders.status = 'draft'`,
      [auth.uid, weekStart, JSON.stringify(items || {}), totalCents || null]
    );
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[order-save] Error:', err);
    res.status(500).json({ error: 'Error del servidor al guardar el pedido.' });
  }
};
