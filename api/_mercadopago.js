// Ayudante para hablar con la API de Mercado Pago DESDE EL SERVIDOR (no
// desde el navegador). Reemplaza a _paypal.js — mismo diseño de antes: en
// vez de una ventanita/pestaña que se puede quedar atorada, el servidor
// crea una "preferencia" (el equivalente a una orden) y le da a la app un
// enlace de Mercado Pago al que simplemente navega (como abrir cualquier
// página), y Mercado Pago solo regresa a la app cuando la persona termina,
// cancela, o deja el pago pendiente — ver api/mercadopago.js y, en
// index.html, las funciones iniciarPagoMercadoPago() y el bloque que
// detecta "?zpay=" al abrir la app.
//
// Aquí se usa el Access Token de Mercado Pago (de PRODUCCIÓN, dinero
// real). Es secreto — NUNCA debe ponerse en index.html ni subirse a
// GitHub, solo vive aquí, leído de una variable de entorno configurada en
// Vercel (MERCADOPAGO_ACCESS_TOKEN). Ver README, sección "Cobro dentro de
// la app (Mercado Pago)", para dónde conseguirlo y cómo agregarlo.
const MP_API_BASE = 'https://api.mercadopago.com';

function getAccessToken() {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!token) {
    throw new Error(
      'Falta configurar MERCADOPAGO_ACCESS_TOKEN en las variables de entorno de tu proyecto en Vercel.'
    );
  }
  return token;
}

// Crea la preferencia de pago en Mercado Pago y regresa el enlace al que
// hay que mandar al cliente (initPoint) — en cuanto la persona termina ahí
// (aprobado, pendiente o rechazado), Mercado Pago la regresa sola a
// successUrl, pendingUrl o failureUrl según corresponda. notificationUrl
// es el aviso automático (webhook) que Mercado Pago llama solo, desde sus
// servidores, cada vez que el estado de este pago cambia (útil sobre todo
// para efectivo en OXXO, que no se confirma al instante).
async function crearPreferencia({ amount, description, externalReference, successUrl, failureUrl, pendingUrl, notificationUrl }) {
  const token = getAccessToken();
  const res = await fetch(MP_API_BASE + '/checkout/preferences', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      items: [
        {
          title: description || 'Pedido semanal ZANO',
          quantity: 1,
          currency_id: 'MXN',
          unit_price: Number(amount)
        }
      ],
      external_reference: externalReference,
      back_urls: { success: successUrl, failure: failureUrl, pending: pendingUrl },
      auto_return: 'approved',
      notification_url: notificationUrl,
      statement_descriptor: 'ZANO'
    })
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) {
    throw new Error('No se pudo crear la preferencia de Mercado Pago: ' + JSON.stringify(data));
  }
  return { preferenceId: data.id, initPoint: data.init_point || data.sandbox_init_point || null };
}

// Consulta el estado real de un pago ya hecho (o intentado) en Mercado
// Pago. pago.status puede ser, entre otros: 'approved' (aprobado, dinero
// real cobrado), 'pending' o 'in_process' (todavía no se confirma, por
// ejemplo un voucher de OXXO sin pagar), 'rejected' (rechazado).
async function obtenerPago(paymentId) {
  const token = getAccessToken();
  const res = await fetch(MP_API_BASE + '/v1/payments/' + encodeURIComponent(paymentId), {
    headers: { Authorization: 'Bearer ' + token }
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) {
    throw new Error('No se pudo consultar el pago en Mercado Pago: ' + JSON.stringify(data));
  }
  return data;
}

module.exports = { crearPreferencia, obtenerPago };
