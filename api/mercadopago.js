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
const {
  crearPreferencia,
  obtenerPago,
  crearCliente,
  guardarTarjeta,
  listarTarjetas,
  borrarTarjeta,
  crearPagoConToken
} = require('./_mercadopago');
const { notificarDueño, mandarCorreoCliente } = require('./_email');
const { mandarPushAUsuario } = require('./_push');

// Da el id de cliente de Mercado Pago de este usuario (ver
// users.mercadopago_customer_id) — si todavía no tiene uno (primera vez que
// usa "tarjetas guardadas"), lo crea en Mercado Pago y lo guarda.
async function obtenerOCrearClienteId(pool, userId) {
  const userRes = await pool.query('SELECT email, name, mercadopago_customer_id FROM users WHERE id = $1', [userId]);
  const user = userRes.rows[0];
  if (!user) throw new Error('Usuario no encontrado.');
  if (user.mercadopago_customer_id) return user.mercadopago_customer_id;
  const customerId = await crearCliente(user.email, user.name);
  await pool.query('UPDATE users SET mercadopago_customer_id = $1 WHERE id = $2', [customerId, userId]);
  return customerId;
}

// Traduce los motivos de rechazo más comunes de Mercado Pago a un mensaje
// que cualquiera entienda — si no reconocemos el motivo, un mensaje
// genérico sigue sirviendo.
function mensajeRechazo(statusDetail) {
  const MENSAJES = {
    cc_rejected_bad_filled_security_code: 'El código de seguridad (CVV) no es correcto.',
    cc_rejected_bad_filled_date: 'La fecha de vencimiento no es correcta.',
    cc_rejected_bad_filled_other: 'Revisa los datos de la tarjeta e intenta de nuevo.',
    cc_rejected_insufficient_amount: 'Tu tarjeta no tiene fondos suficientes.',
    cc_rejected_call_for_authorize: 'Tu banco necesita que autorices este pago directamente con ellos antes de intentar de nuevo.',
    cc_rejected_card_disabled: 'Tu tarjeta está deshabilitada para compras por internet — llama a tu banco para activarla.',
    cc_rejected_duplicated_payment: 'Ya se hizo un pago igual a este hace un momento.',
    cc_rejected_max_attempts: 'Llegaste al máximo de intentos permitidos con esta tarjeta.',
    cc_rejected_high_risk: 'Mercado Pago no autorizó este pago por seguridad. Intenta con otra tarjeta.'
  };
  return MENSAJES[statusDetail] || 'Tu banco rechazó el pago. Intenta de nuevo o usa otra tarjeta.';
}

// Convierte la tarjeta como la da Mercado Pago a solo lo que la app necesita
// mostrar — nunca mandamos el objeto completo (trae datos de más).
function tarjetaParaApp(c) {
  return {
    id: c.id,
    brand: (c.payment_method && c.payment_method.name) || 'Tarjeta',
    lastFour: c.last_four_digits || '',
    expMonth: c.expiration_month || null,
    expYear: c.expiration_year || null
  };
}

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
        ).catch((err) => { console.error('[mercadopago] Error avisando al dueño:', err); }),
        // Notificación push (si la persona la activó en Perfil) — además del
        // correo de arriba, igual de importante pero más inmediata.
        mandarPushAUsuario(userId, {
          title: 'ZANO',
          body: '¡Tu pago se confirmó! Tu pedido de esta semana ya quedó agendado.',
          url: '/#semana'
        }).catch((err) => { console.error('[mercadopago] Error mandando notificación push:', err); })
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

      // Hace falta correo verificado para pagar (ver api/register.js) — así
      // nos aseguramos de que el correo al que llegan la confirmación del
      // pedido y los recordatorios sea de verdad. El resto de la app (armar
      // la semana, ver el menú, etc.) sigue funcionando sin verificar.
      const pool = getPool();
      const verifRes = await pool.query('SELECT email_verified FROM users WHERE id = $1', [auth.uid]);
      if (!verifRes.rows[0] || !verifRes.rows[0].email_verified) {
        res.status(403).json({ error: 'Verifica tu correo antes de pagar — revisa el código que te mandamos al crear tu cuenta.' });
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

  // --- Tarjetas guardadas ------------------------------------------------

  if (action === 'getCards') {
    try {
      const pool = getPool();
      const customerId = await obtenerOCrearClienteId(pool, auth.uid);
      const tarjetas = await listarTarjetas(customerId);
      res.status(200).json({ cards: tarjetas.map(tarjetaParaApp) });
    } catch (err) {
      console.error('[mercadopago:getCards] Error:', err);
      res.status(500).json({ error: 'No se pudieron cargar tus tarjetas guardadas.' });
    }
    return;
  }

  if (action === 'saveCard') {
    try {
      const { token: cardToken } = req.body || {};
      if (!cardToken) {
        res.status(400).json({ error: 'Falta la tarjeta a guardar.' });
        return;
      }
      const pool = getPool();
      const customerId = await obtenerOCrearClienteId(pool, auth.uid);
      await guardarTarjeta(customerId, cardToken);
      const tarjetas = await listarTarjetas(customerId);
      res.status(200).json({ cards: tarjetas.map(tarjetaParaApp) });
    } catch (err) {
      console.error('[mercadopago:saveCard] Error:', err);
      res.status(400).json({ error: err.message || 'No se pudo guardar la tarjeta. Revisa los datos e intenta de nuevo.' });
    }
    return;
  }

  if (action === 'deleteCard') {
    try {
      const { cardId } = req.body || {};
      if (!cardId) {
        res.status(400).json({ error: 'Falta la tarjeta a borrar.' });
        return;
      }
      const pool = getPool();
      const customerId = await obtenerOCrearClienteId(pool, auth.uid);
      await borrarTarjeta(customerId, cardId);
      const tarjetas = await listarTarjetas(customerId);
      res.status(200).json({ cards: tarjetas.map(tarjetaParaApp) });
    } catch (err) {
      console.error('[mercadopago:deleteCard] Error:', err);
      res.status(500).json({ error: 'No se pudo borrar esa tarjeta. Intenta de nuevo.' });
    }
    return;
  }

  if (action === 'payWithCard') {
    try {
      const { token: cardToken, weekStart, totalCents } = req.body || {};
      if (!cardToken || !weekStart || !totalCents) {
        res.status(400).json({ error: 'Falta la tarjeta, la semana o el total del pedido.' });
        return;
      }

      // Mismo requisito que al pagar con Mercado Pago normal (ver
      // action=create más arriba): correo verificado antes de cobrar.
      const pool = getPool();
      const verifRes = await pool.query('SELECT email_verified FROM users WHERE id = $1', [auth.uid]);
      if (!verifRes.rows[0] || !verifRes.rows[0].email_verified) {
        res.status(403).json({ error: 'Verifica tu correo antes de pagar — revisa el código que te mandamos al crear tu cuenta.' });
        return;
      }

      const customerId = await obtenerOCrearClienteId(pool, auth.uid);
      const pago = await crearPagoConToken({
        amount: totalCents / 100,
        cardToken,
        description: 'Pedido semanal ZANO',
        externalReference: auth.uid + ':' + weekStart,
        customerId
      });

      if (pago.status === 'approved') {
        await marcarPedidoPagado({ userId: auth.uid, weekStart, paymentId: pago.id, totalCents });
        res.status(200).json({ ok: true, paymentId: pago.id });
        return;
      }
      if (pago.status === 'in_process' || pago.status === 'pending') {
        res.status(200).json({
          ok: false,
          pendiente: true,
          error: 'Tu pago quedó pendiente de confirmar. En cuanto se confirme, tu pedido queda agendado solo — te llegará un correo.'
        });
        return;
      }
      res.status(400).json({ error: mensajeRechazo(pago.status_detail) });
    } catch (err) {
      console.error('[mercadopago:payWithCard] Error:', err);
      res.status(500).json({ error: 'No se pudo cobrar con esa tarjeta. Si ya viste el cargo en tu cuenta, contáctanos.' });
    }
    return;
  }

  res.status(400).json({ error: 'Acción no reconocida.' });
};
