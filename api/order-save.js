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
    const { weekStart, items, totalCents, horarios, plantel } = req.body || {};
    if (!weekStart) {
      res.status(400).json({ error: 'Falta la semana del pedido.' });
      return;
    }
    const pool = getPool();
    await pool.query(
      `INSERT INTO weekly_orders (user_id, week_start, items, horarios, plantel, total_cents, status, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'draft', now())
       ON CONFLICT (user_id, week_start)
       DO UPDATE SET items = EXCLUDED.items, horarios = EXCLUDED.horarios, plantel = EXCLUDED.plantel,
                     total_cents = EXCLUDED.total_cents, updated_at = now()
       WHERE weekly_orders.status = 'draft'`,
      [auth.uid, weekStart, JSON.stringify(items || {}), JSON.stringify(horarios || {}), plantel || null, totalCents || null]
    );
    // Aprovechamos y guardamos su institución en su perfil, así la próxima
    // vez ya no hay que preguntarle (y el panel de admin la puede mostrar
    // aunque todavía no tenga ningún pedido guardado esta semana).
    if (plantel) {
      await pool.query('UPDATE users SET plantel = $1 WHERE id = $2', [plantel, auth.uid]);
    }
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[order-save] Error:', err);
    res.status(500).json({ error: 'Error del servidor al guardar el pedido.' });
  }
};
