// Marca el pedido de la semana como pagado y dispara el correo de
// confirmación al cliente + un aviso a ti. La app lo llama justo cuando
// PayPal confirma el pago (onApprove).
const { getPool } = require('./_db');
const { getUserFromRequest } = require('./_auth');
const { notificarDueño, mandarCorreoCliente } = require('./_email');

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
    const { weekStart, paymentId, totalCents } = req.body || {};
    if (!weekStart || !paymentId) {
      res.status(400).json({ error: 'Faltan datos del pago.' });
      return;
    }
    const pool = getPool();

    const updated = await pool.query(
      `UPDATE weekly_orders
       SET status = 'paid', payment_id = $3, total_cents = COALESCE($4, total_cents), paid_at = now(), updated_at = now()
       WHERE user_id = $1 AND week_start = $2
       RETURNING id`,
      [auth.uid, weekStart, paymentId, totalCents || null]
    );

    if (updated.rows.length === 0) {
      // No había un borrador guardado (por ejemplo, si la app no alcanzó a
      // guardarlo antes) — igual dejamos el pedido registrado como pagado.
      await pool.query(
        `INSERT INTO weekly_orders (user_id, week_start, items, total_cents, status, payment_id, paid_at, updated_at)
         VALUES ($1, $2, '{}'::jsonb, $3, 'paid', $4, now(), now())
         ON CONFLICT (user_id, week_start)
         DO UPDATE SET status = 'paid', payment_id = $4, paid_at = now(), updated_at = now()`,
        [auth.uid, weekStart, totalCents || null, paymentId]
      );
    }

    const userRes = await pool.query('SELECT name, email FROM users WHERE id = $1', [auth.uid]);
    const user = userRes.rows[0];
    if (user) {
      // Esperamos a que terminen los correos antes de responder (ver nota en
      // register.js) — si no, Vercel puede apagar la función a la mitad.
      await Promise.all([
        mandarCorreoCliente(
          user.email,
          user.name,
          'Tu pedido de ZANO está confirmado',
          'Ya confirmamos tu pago. Tu pedido de esta semana quedó agendado — nos vemos en tu institución en tu horario de recogida.'
        ).catch((err) => { console.error('[order-confirm] Error mandando confirmación:', err); }),
        notificarDueño(
          'Pedido pagado en ZANO',
          'Pago confirmado de ' + user.name + ' (' + user.email + '). Referencia de PayPal: ' + paymentId
        ).catch((err) => { console.error('[order-confirm] Error avisando al dueño:', err); })
      ]);
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[order-confirm] Error:', err);
    res.status(500).json({ error: 'Error del servidor al confirmar el pago.' });
  }
};
