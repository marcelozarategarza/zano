// Notificaciones push a clientes — usa el protocolo estándar "Web Push" (lo
// mismo que usan Gmail o Facebook en la web) a través de la librería
// web-push. NO es una cuenta en ningún servicio externo: las llaves VAPID
// (una pública, que vive en index.html, y una privada, que vive aquí/en
// Vercel) solo identifican a ZANO como quien manda la notificación, se
// generan una sola vez y no vencen nunca.
//
// IMPORTANTE (iPhone): las notificaciones push solo funcionan en iOS 16.4 en
// adelante, y SOLO si la persona ya agregó la app a su pantalla de inicio
// (modo standalone) — si solo la abre desde un link en Safari, el propio
// iPhone no deja activarlas, por más que el código esté bien.
//
// Variables de entorno que hacen falta en Vercel (ver README):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (opcional)
const webpush = require('web-push');
const { getPool } = require('./_db');

const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:zano.ayuda@gmail.com';

let configurado = false;
function asegurarConfig() {
  if (configurado) return true;
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return false;
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
  configurado = true;
  return true;
}

// Manda una notificación a TODOS los dispositivos donde ese cliente activó
// "Notificaciones" en Perfil (puede tener más de uno). Si alguna ya no sirve
// (desinstaló la app, o el dispositivo lleva mucho tiempo sin usarse), Web
// Push regresa un error 404/410 — ahí se borra sola esa fila de
// push_subscriptions, para no seguir intentando mandarle algo a un
// dispositivo que ya no existe. Nunca truena si algo falla: una notificación
// que no se pudo mandar no debe tumbar el pago ni el cambio de estatus que
// la dispara.
// Regresa { enviados: N } (a cuántos dispositivos SÍ se le pudo mandar) —
// lo usan tanto los avisos automáticos (pago confirmado, pedido listo, que
// ignoran este dato) como "Aviso a un cliente" en Administración, que sí lo
// muestra, para que el dueño sepa si ese cliente de verdad tiene
// notificaciones activadas en algún dispositivo.
async function mandarPushAUsuario(userId, payload) {
  if (!asegurarConfig()) {
    console.warn('[push] VAPID no configurado (faltan VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY en Vercel) — no se mandó notificación a usuario', userId);
    return { enviados: 0 };
  }
  try {
    const pool = getPool();
    const subsRes = await pool.query(
      `SELECT id, endpoint, p256dh, auth_key FROM push_subscriptions WHERE user_id = $1`,
      [userId]
    );
    const mensaje = JSON.stringify(payload);
    let enviados = 0;
    await Promise.all(subsRes.rows.map(async (row) => {
      const subscription = {
        endpoint: row.endpoint,
        keys: { p256dh: row.p256dh, auth: row.auth_key }
      };
      try {
        await webpush.sendNotification(subscription, mensaje);
        enviados += 1;
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          await pool.query('DELETE FROM push_subscriptions WHERE id = $1', [row.id]).catch(() => {});
        } else {
          console.error('[push] Error mandando notificación a usuario ' + userId + ':', err.message || err);
        }
      }
    }));
    return { enviados };
  } catch (err) {
    console.error('[push] Error general mandando notificación a usuario ' + userId + ':', err);
    return { enviados: 0 };
  }
}

// Manda la MISMA notificación a TODOS los dispositivos activados, de
// cualquier cliente — para avisos generales (ej. una promoción), no de un
// pedido en particular. Ver api/admin-costs.js, tipo='notificacion'. Igual
// que arriba, si algún dispositivo ya no sirve se borra solo; el envío
// sigue con los demás aunque uno falle.
async function mandarPushATodos(payload) {
  if (!asegurarConfig()) {
    console.warn('[push] VAPID no configurado — no se mandó la notificación a todos.');
    return { enviados: 0 };
  }
  const pool = getPool();
  const subsRes = await pool.query(`SELECT id, endpoint, p256dh, auth_key FROM push_subscriptions`);
  const mensaje = JSON.stringify(payload);
  let enviados = 0;
  await Promise.all(subsRes.rows.map(async (row) => {
    const subscription = {
      endpoint: row.endpoint,
      keys: { p256dh: row.p256dh, auth: row.auth_key }
    };
    try {
      await webpush.sendNotification(subscription, mensaje);
      enviados += 1;
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        await pool.query('DELETE FROM push_subscriptions WHERE id = $1', [row.id]).catch(() => {});
      } else {
        console.error('[push] Error mandando notificación masiva (suscripción ' + row.id + '):', err.message || err);
      }
    }
  }));
  return { enviados };
}

module.exports = { mandarPushAUsuario, mandarPushATodos };
