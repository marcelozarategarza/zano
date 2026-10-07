// Tres cosas, para no gastar otra función serverless (ver límite de 12 del
// plan gratuito de Vercel — ya está justo en el tope):
//   POST { }                   -> guarda (o actualiza) el pedido "en
//           borrador" de la semana en curso. La app lo llama sola cuando la
//           persona entra a la pantalla de Pagar — así, si deja el pedido a
//           medias sin pagar, el cron de abandonados lo puede detectar.
//   POST { action:'editEntrega' } -> para un pedido YA PAGADO: cambia el
//           horario de recogida de un día, o mueve el platillo de ese día a
//           otro día de la misma semana (ver "Editar entrega" en Perfil).
//   GET  -> tu historial de pedidos YA PAGADOS (el más reciente primero,
//           que incluye el de la semana que viene si ya la pagaste) — lo
//           usa la pantalla de Perfil para "Pedidos próximos"/"Pedidos
//           pasados" y el botón "Pedir lo mismo".
const { getPool } = require('./_db');
const { getUserFromRequest } = require('./_auth');

const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'];

// "Editar entrega" de un pedido YA PAGADO — cambia horario, o mueve el
// platillo de un día a otro día vacío de la misma semana. No toca
// total_cents ni status: es solo reacomodar la entrega, nunca cambia lo que
// se cobró. Si la cocina ya empezó a preparar ese día (day_status != o no
// "pendiente"), ya no se deja editar — evita que cocina prepare algo que
// la persona acaba de mover a otro día sin que se enteren a tiempo.
async function handleEditEntrega(req, res, auth) {
  try {
    const { weekStart, dia, horario, moveTo } = req.body || {};
    if (!weekStart || !dia || !DIAS.includes(dia)) {
      res.status(400).json({ error: 'Faltan datos del pedido a editar.' });
      return;
    }
    if (!horario && !moveTo) {
      res.status(400).json({ error: 'No se indicó qué cambiar.' });
      return;
    }
    if (moveTo && !DIAS.includes(moveTo)) {
      res.status(400).json({ error: 'Día de destino no válido.' });
      return;
    }

    const pool = getPool();
    const result = await pool.query(
      `SELECT items, horarios, day_status FROM weekly_orders WHERE user_id = $1 AND week_start = $2 AND status = 'paid'`,
      [auth.uid, weekStart]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'No encontramos ese pedido pagado.' });
      return;
    }
    const items = result.rows[0].items || {};
    const horarios = result.rows[0].horarios || {};
    const dayStatus = result.rows[0].day_status || {};

    if (!items[dia]) {
      res.status(400).json({ error: 'Ese día no tiene ningún platillo pedido.' });
      return;
    }
    if ((dayStatus[dia] || 'pendiente') !== 'pendiente') {
      res.status(400).json({ error: 'Ya se empezó a preparar tu pedido de ese día — ya no se puede editar. Contáctanos si necesitas un cambio.' });
      return;
    }

    if (moveTo) {
      if (moveTo === dia) {
        res.status(400).json({ error: 'Elige un día distinto.' });
        return;
      }
      if (items[moveTo]) {
        res.status(400).json({ error: 'Ese día ya tienes otro platillo pedido — elige un día libre.' });
        return;
      }
      if ((dayStatus[moveTo] || 'pendiente') !== 'pendiente') {
        res.status(400).json({ error: 'Ya se empezó a preparar algo para ese día — elige otro.' });
        return;
      }
      items[moveTo] = items[dia];
      delete items[dia];
      if (horarios[dia]) {
        horarios[moveTo] = horarios[dia];
        delete horarios[dia];
      }
      delete dayStatus[dia];
    }

    if (horario) {
      horarios[moveTo || dia] = horario;
    }

    await pool.query(
      `UPDATE weekly_orders SET items = $3, horarios = $4, day_status = $5, updated_at = now()
       WHERE user_id = $1 AND week_start = $2 AND status = 'paid'`,
      [auth.uid, weekStart, JSON.stringify(items), JSON.stringify(horarios), JSON.stringify(dayStatus)]
    );

    res.status(200).json({ ok: true, items, horarios });
  } catch (err) {
    console.error('[order-save:editEntrega] Error:', err);
    res.status(500).json({ error: 'No se pudo guardar el cambio. Intenta de nuevo.' });
  }
}

module.exports = async function handler(req, res) {
  const auth = getUserFromRequest(req);
  if (!auth) {
    res.status(401).json({ error: 'Sesión inválida o vencida.' });
    return;
  }

  if (req.method === 'POST' && req.body && req.body.action === 'editEntrega') {
    return handleEditEntrega(req, res, auth);
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
