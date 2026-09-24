// Dos cosas, para no gastar otra función serverless (ver límite de 12 del
// plan gratuito de Vercel — ya está justo en el tope):
//   POST -> guarda (o actualiza) el pedido "en borrador" de la semana en
//           curso. La app lo llama sola cuando la persona entra a la
//           pantalla de Pagar — así, si deja el pedido a medias sin pagar,
//           el cron de abandonados lo puede detectar.
//   GET  -> tu historial de pedidos YA PAGADOS de semanas anteriores (el
//           más reciente primero) — lo usa la pantalla de Perfil para
//           mostrar "Pedidos pasados" y el botón "Pedir lo mismo".
const { getPool } = require('./_db');
const { getUserFromRequest } = require('./_auth');

module.exports = async function handler(req, res) {
  const auth = getUserFromRequest(req);
  if (!auth) {
    res.status(401).json({ error: 'Sesión inválida o vencida.' });
    return;
  }

  if (req.method === 'GET') {
    try {
      const pool = getPool();
      const result = await pool.query(
        `SELECT week_start::text AS week_start, items, horarios, plantel, total_cents
         FROM weekly_orders
         WHERE user_id = $1 AND status = 'paid'
         ORDER BY week_start DESC
         LIMIT 15`,
        [auth.uid]
      );
      res.status(200).json({
        history: result.rows.map((r) => ({
          weekStart: r.week_start,
          items: r.items || {},
          horarios: r.horarios || {},
          plantel: r.plantel || null,
          totalCents: r.total_cents || 0
        }))
      });
    } catch (err) {
      console.error('[order-save:history] Error:', err);
      res.status(500).json({ error: 'Error del servidor al cargar tu historial.' });
    }
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido.' });
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
