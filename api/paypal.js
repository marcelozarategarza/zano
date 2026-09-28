// Cobro con PayPal (y Apple Pay) DESDE la app, sin ventanitas ni pestañas
// que se puedan quedar atoradas: en vez de un popup, este endpoint crea la
// orden en el servidor y le regresa a la app un enlace normal de PayPal
// al que la propia app navega (como abrir cualquier página) — PayPal
// solo regresa a la app cuando la persona termina o cancela. Así funciona
// igual en cualquier navegador, en modo incógnito, y también con la app
// agregada a la pantalla de inicio (que antes se quedaba atorada). El
// botón de Apple Pay usa este mismo endpoint solo para crear la orden —
// la confirmación de Apple Pay la hace directo el propio SDK de PayPal en
// el navegador (ver index.html).
//
// Junta dos acciones en un solo archivo (en vez de dos) porque el plan
// gratuito de Vercel limita a 12 funciones y ya estamos justo en ese
// tope (ver nota en order-save.js):
//   action=create  -> crea la orden y regresa a dónde mandar al cliente.
//   action=capture -> confirma el pago ya aprobado, marca el pedido
//                      pagado y manda los correos de confirmación (hace
//                      lo mismo que hacía antes order-confirm.js).
const { getPool } = require('./_db');
const { getUserFromRequest } = require('./_auth');
const { crearOrden, capturarOrden } = require('./_paypal');
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

  const { action } = req.body || {};

  if (action === 'create') {
    try {
      const { weekStart, totalCents } = req.body || {};
      if (!weekStart || !totalCents) {
        res.status(400).json({ error: 'Falta la semana o el total del pedido.' });
        return;
      }
      const amount = totalCents / 100;
      const origin = req.headers.origin || 'https://' + req.headers.host;
      const returnUrl = origin + '/?zpay=1&week=' + encodeURIComponent(weekStart);
      const cancelUrl = origin + '/?zpay=0&week=' + encodeURIComponent(weekStart);
      const { orderId, approveUrl } = await crearOrden({ amount, returnUrl, cancelUrl });
      if (!orderId) {
        res.status(500).json({ error: 'PayPal no regresó una orden válida.' });
        return;
      }
      res.status(200).json({ orderId, approveUrl });
    } catch (err) {
      console.error('[paypal:create] Error:', err);
      res.status(500).json({ error: 'No se pudo iniciar el pago con PayPal. Intenta de nuevo.' });
    }
    return;
  }

  if (action === 'capture') {
    try {
      const { orderId, weekStart, totalCents } = req.body || {};
      if (!orderId || !weekStart) {
        res.status(400).json({ error: 'Falta la orden o la semana del pedido.' });
        return;
      }
      const captura = await capturarOrden(orderId);
      if (captura.status !== 'COMPLETED') {
        res.status(400).json({ error: 'PayPal no confirmó el pago (estado: ' + captura.status + ').' });
        return;
      }
      const pool = getPool();
      const updated = await pool.query(
        `UPDATE weekly_orders
         SET status = 'paid', payment_id = $3, total_cents = COALESCE($4, total_cents), paid_at = now(), updated_at = now()
         WHERE user_id = $1 AND week_start = $2
         RETURNING id`,
        [auth.uid, weekStart, orderId, totalCents || null]
      );
      if (updated.rows.length === 0) {
        await pool.query(
          `INSERT INTO weekly_orders (user_id, week_start, items, total_cents, status, payment_id, paid_at, updated_at)
           VALUES ($1, $2, '{}'::jsonb, $3, 'paid', $4, now(), now())
           ON CONFLICT (user_id, week_start)
           DO UPDATE SET status = 'paid', payment_id = $4, paid_at = now(), updated_at = now()`,
          [auth.uid, weekStart, totalCents || null, orderId]
        );
      }

      const userRes = await pool.query('SELECT name, email FROM users WHERE id = $1', [auth.uid]);
      const user = userRes.rows[0];
      if (user) {
        await Promise.all([
          mandarCorreoCliente(
            user.email,
            user.name,
            'Tu pedido de ZANO está confirmado',
            'Ya confirmamos tu pago. Tu pedido de esta semana quedó agendado — nos vemos en tu institución en tu horario de recogida.'
          ).catch((err) => { console.error('[paypal:capture] Error mandando confirmación:', err); }),
          notificarDueño(
            'Pedido pagado en ZANO',
            'Pago confirmado de ' + user.name + ' (' + user.email + '). Referencia de PayPal: ' + orderId
          ).catch((err) => { console.error('[paypal:capture] Error avisando al dueño:', err); })
        ]);
      }

      res.status(200).json({ ok: true, paymentId: orderId });
    } catch (err) {
      console.error('[paypal:capture] Error:', err);
      res.status(500).json({
        error: 'No se pudo confirmar tu pago con PayPal. Si ya viste el cargo en tu cuenta, contáctanos.'
      });
    }
    return;
  }

  res.status(400).json({ error: 'Acción no reconocida.' });
};
