// Ayudante para hablar con la API de PayPal DESDE EL SERVIDOR (no desde el
// navegador). Esto es lo que permite que el pago pase de verdad "dentro de
// la app" sin ninguna ventanita/pestaña que se pueda quedar atorada (el
// problema reportado antes): en vez de abrir un popup, el servidor crea la
// orden y le da a la app un enlace de PayPal al que simplemente navega
// (como abrir cualquier página), y PayPal solo regresa a la app cuando la
// persona termina o cancela — ver api/paypal.js y, en index.html, las
// funciones iniciarPagoPayPal() y el bloque que detecta "?zpay=" al abrir
// la app.
//
// Aquí SÍ se usa el "Secret" de PayPal (a diferencia del Client ID, que va
// en el <head> de index.html y es público, ese es seguro tenerlo visible).
// El Secret NUNCA debe ponerse en index.html ni subirse a GitHub — solo
// vive aquí, leído de una variable de entorno configurada en Vercel. Ver
// README, sección "Cobro dentro de la app (PayPal) + Apple Pay", para
// dónde conseguirlo y cómo agregarlo.
const PAYPAL_API_BASE = 'https://api-m.paypal.com'; // LIVE (dinero real) — no sandbox

// Mismo Client ID que ya está en el <head> de index.html (ese es público).
// Si algún día lo cambias ahí, cámbialo también aquí (o mejor, configura
// PAYPAL_CLIENT_ID en Vercel y ya no hace falta tocar código nunca más).
const PAYPAL_CLIENT_ID =
  process.env.PAYPAL_CLIENT_ID ||
  'BAA9IQZnchv-jwAGGZMjpBuVQY8KCQfhR4Yu25NGnxPuGNzoT1alY1890JpmXWBVNS4A_Cbc1tY_2Kvh50';
const PAYPAL_SECRET = process.env.PAYPAL_SECRET;

async function getAccessToken() {
  if (!PAYPAL_SECRET) {
    throw new Error(
      'Falta configurar PAYPAL_SECRET en las variables de entorno de tu proyecto en Vercel.'
    );
  }
  const creds = Buffer.from(PAYPAL_CLIENT_ID + ':' + PAYPAL_SECRET).toString('base64');
  const res = await fetch(PAYPAL_API_BASE + '/v1/oauth2/token', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + creds,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || !data.access_token) {
    throw new Error('No se pudo autenticar con PayPal: ' + JSON.stringify(data));
  }
  return data.access_token;
}

// Crea la orden en PayPal y regresa el enlace al que hay que mandar al
// cliente (approveUrl) — en cuanto la persona termina ahí (pagó o
// canceló), PayPal la regresa sola a returnUrl o a cancelUrl.
async function crearOrden({ amount, returnUrl, cancelUrl, description }) {
  const token = await getAccessToken();
  const res = await fetch(PAYPAL_API_BASE + '/v2/checkout/orders', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [
        {
          description: description || 'Pedido semanal ZANO',
          amount: { currency_code: 'MXN', value: amount.toFixed(2) }
        }
      ],
      application_context: {
        brand_name: 'ZANO',
        landing_page: 'LOGIN',
        user_action: 'PAY_NOW',
        shipping_preference: 'NO_SHIPPING',
        return_url: returnUrl,
        cancel_url: cancelUrl
      }
    })
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) {
    throw new Error('No se pudo crear la orden de PayPal: ' + JSON.stringify(data));
  }
  const approveLink = (data.links || []).find(
    (l) => l.rel === 'approve' || l.rel === 'payer-action'
  );
  return { orderId: data.id, approveUrl: approveLink ? approveLink.href : null };
}

// Confirma/cobra una orden ya aprobada. data.status debe quedar 'COMPLETED'.
async function capturarOrden(orderId) {
  const token = await getAccessToken();
  const res = await fetch(
    PAYPAL_API_BASE + '/v2/checkout/orders/' + encodeURIComponent(orderId) + '/capture',
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json'
      }
    }
  );
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) {
    throw new Error('No se pudo capturar el pago de PayPal: ' + JSON.stringify(data));
  }
  return data;
}

module.exports = { crearOrden, capturarOrden, PAYPAL_CLIENT_ID };
