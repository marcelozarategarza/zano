// Cobro con Mercado Pago DESDE la app — reemplaza por completo a PayPal
// (ver api/paypal.js en versiones anteriores, ya borrado). Mismo diseño de
// antes: en vez de una ventanita/pestaña que se podía quedar atorada, este
// endpoint crea la "preferencia" (el equivalente a una orden) en el
// servidor y le regresa a la app un enlace normal de Mercado Pago al que
// la propia app navega (como abrir cualquier página) — Mercado Pago solo
// regresa a la app cuando la persona termina, cancela, o deja el pago
// pendiente (por ejemplo, pagando en efectivo en OXXO).
//
// A diferencia de PayPal, aquí SÍ se agrega un aviso automático
// (action=webhook) que Mercado Pago llama solo, desde sus servidores, cada
// vez que el estado de un pago cambia — así, si alguien paga en efectivo
// en OXXO (que tarda en confirmarse, no es al instante), el pedido se
// marca pagado solo en cuanto se confirme ese efectivo, aunque la persona
// ya haya cerrado la app.
//
// Junta tres acciones en un solo archivo (en vez de tres) porque el plan
// gratuito de Vercel limita a 12 funciones y ya estamos justo en ese tope:
//   action=create  -> crea la preferencia y regresa a dónde mandar al
//                      cliente.
//   action=capture -> consulta el estado real de un pago y, si ya está
//                      aprobado, marca el pedido pagado y manda los
//                      correos de confirmación.
//   action=webhook -> Mercado Pago llama esto solo (sin sesión de usuario,
//                      sin que nadie esté viendo la app) cuando el estado
//                      de un pago cambia.
const { getPool } = require('./_db');
const { getUserFromRequest } = require('./_auth');
const { crearPreferencia, obtenerPago } = require('./_mercadopago');
const { notificarDueño, mandarCorreoCliente } = require('./_email');

// Marca el pedido de esa semana como pagado y manda los correos de
// confirmación — pero solo si no estaba pagado ya (puede llegar tanto por
// el regreso normal a la app como por el webhook, casi al mismo tiempo, y
// no queremos mandar el correo dos veces).
async function marcarPedidoPagado({ userId, weekStart, paymentId, totalCents }) {
  const pool = getPool();
  const updated = await pool.query(
    `UPDATE weekly_orders
     SET status = 'paid', payment_id = $3, total_cents = COALESCE($4, total_cents), paid_at = now(), updated_at = now()
     WHERE user_id = $1 AND week_start = $2 AND status != 'paid'
     RETURNING id`,
    [userId, weekStart, String(paymentId), totalCents || null]
  );

  let yaEstabaPagado = false;
  if (updated.rows.length === 0) {
    const existing = await pool.query(
      `SELECT status FROM weekly_orders WHERE user_id = $1 AND week_start = $2`,
      [userId, weekStart]
    );
    if (existing.rows[0] && existing.rows[0].status === 'paid') {
      yaEstabaPagado = true;
    } else {
      // No había ni borrador guardado (por ejemplo, si la app no alcanzó a
      // guardarlo antes) — igual dejamos el pedido registrado como pagado.
      await pool.query(
        `INSERT INTO weekly_orders (user_id, week_start, items, total_cents, status, payment_id, paid_at, updated_at)
         VALUES ($1, $2, '{}'::jsonb, $3, 'paid', $4, now(), now())
         ON CONFLICT (user_id, week_start)
         DO UPDATE SET status = 'paid', payment_id = $4, paid_at = now(), updated_at = now()
         WHERE weekly_orders.status != 'paid'`,
        [userId, weekStart, totalCents || null, String(paymentId)]
      );
    }
  }

  if (!yaEstabaPagado) {
    const userRes = await pool.query('SELECT name, email FROM users WHERE id = $1', [userId]);
    const user = userRes.rows[0];
    if (user) {
      // Esperamos a que terminen los correos antes de responder (ver nota
      // en register.js) — si no, Vercel puede apagar la función a la mitad.
      await Promise.all([
        mandarCorreoCliente(
          user.email,
          user.name,
          'Tu pedido de ZANO está confirmado',
          'Ya confirmamos tu pago. Tu pedido de esta semana quedó agendado — nos vemos en tu institución en tu horario de recogida.'
        ).catch((err) => { console.error('[mercadopago] Error mandando confirmación:', err); }),
        notificarDueño(
          'Pedido pagado en ZANO',
          'Pago confirmado de ' + user.name + ' (' + user.email + '). Referencia de Mercado Pago: ' + paymentId
        ).catch((err) => { console.error('[mercadopago] Error avisando al dueño:', err); })
      ]);
    }
  }
}

module.exports = async function handler(req, res) {
  const action = (req.body && req.body.action) || (req.query && req.query.action) || '';

  // Mercado Pago llama esta acción SOLO, desde sus servidores — no hay
  // sesión de usuario ni cabecera de autorización, así que se atiende
  // antes de cualquier chequeo de sesión. Siempre respondemos 200 rápido
  // (aunque algo salga mal de nuestro lado) para que Mercado Pago no siga
  // reintentando de más.
  if (action === 'webhook') {
    try {
      const paymentId =
        (req.query && (req.query['data.id'] || req.query.id)) ||
        (req.body && req.body.data && req.body.data.id) ||
        null;
      const topic = (req.query && (req.query.type || req.query.topic)) || (req.body && req.body.type) || '';
      if (!paymentId || (topic && topic !== 'payment')) {
        res.status(200).json({ ok: true });
        return;
      }
      const pago = await obtenerPago(paymentId);
      if (pago.status === 'approved' && pago.external_reference) {
        const partes = String(pago.external_reference).split(':');
        const userId = Number(partes[0]);
        const weekStart = partes[1];
        if (userId && weekStart) {
          await marcarPedidoPagado({
            userId,
            weekStart,
            paymentId: pago.id,
            totalCents: Math.round((pago.transaction_amount || 0) * 100)
          });
        }
      }
      res.status(200).json({ ok: true });
    } catch (err) {
      console.error('[mercadopago:webhook] Error:', err);
      res.status(200).json({ ok: true });
    }
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido.' });
    return;
  }
  const auth = getUserFromRequest(req);
  if (!auth) {
    res.status(401).json({ error: 'Sesión inválida o vencida.' });
    return;
  }

  if (action === 'create') {
    try {
      const { weekStart, totalCents } = req.body || {};
      if (!weekStart || !totalCents) {
        res.status(400).json({ error: 'Falta la semana o el total del pedido.' });
        return;
      }
      const amount = totalCents / 100;
      const origin = req.headers.origin || 'https://' + req.headers.host;
      const successUrl = origin + '/?zpay=1&week=' + encodeURIComponent(weekStart);
      const failureUrl = origin + '/?zpay=0&week=' + encodeURIComponent(weekStart);
      const pendingUrl = origin + '/?zpay=2&week=' + encodeURIComponent(weekStart);
      const notificationUrl = origin + '/api/mercadopago?action=webhook';
      const { preferenceId, initPoint } = await crearPreferencia({
        amount,
        description: 'Pedido semanal ZANO',
        externalReference: auth.uid + ':' + weekStart,
        successUrl,
        failureUrl,
        pendingUrl,
        notificationUrl
      });
      if (!initPoint) {
        res.status(500).json({ error: 'Mercado Pago no regresó un enlace de pago válido.' });
        return;
      }
      res.status(200).json({ preferenceId, initPoint });
    } catch (err) {
      console.error('[mercadopago:create] Error:', err);
      res.status(500).json({ error: 'No se pudo iniciar el pago con Mercado Pago. Intenta de nuevo.' });
    }
    return;
  }

  if (action === 'capture') {
    try {
      const { paymentId, weekStart, totalCents } = req.body || {};
      if (!paymentId || !weekStart) {
        res.status(400).json({ error: 'Falta el pago o la semana del pedido.' });
        return;
      }
      const pago = await obtenerPago(paymentId);
      if (pago.status === 'pending' || pago.status === 'in_process') {
        res.status(200).json({
          ok: false,
          pendiente: true,
          error: 'Tu pago quedó pendiente de confirmar (por ejemplo, si vas a pagar en efectivo en OXXO). En cuanto se confirme, tu pedido queda agendado solo — te llegará un correo.'
        });
        return;
      }
      if (pago.status !== 'approved') {
        res.status(400).json({ error: 'Mercado Pago no confirmó el pago (estado: ' + pago.status + ').' });
        return;
      }
      await marcarPedidoPagado({ userId: auth.uid, weekStart, paymentId: pago.id, totalCents: totalCents || null });
      res.status(200).json({ ok: true, paymentId: pago.id });
    } catch (err) {
      console.error('[mercadopago:capture] Error:', err);
      res.status(500).json({
        error: 'No se pudo confirmar tu pago con Mercado Pago. Si ya viste el cargo en tu cuenta, contáctanos.'
      });
    }
    return;
  }

  res.status(400).json({ error: 'Acción no reconocida.' });
};
