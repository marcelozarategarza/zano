// Envío de correos desde el servidor con EmailJS (@emailjs/nodejs).
// Reutiliza el MISMO servicio de EmailJS que ya conectaste para "Ayuda" en la
// app, más DOS plantillas:
//   - EMAILJS_TEMPLATE_ID_AYUDA: la plantilla que ya tenías (destino fijo:
//     zano.ayuda@gmail.com) — aquí se reutiliza para avisarte de cosas nuevas.
//   - EMAILJS_TEMPLATE_ID_CLIENTE: una plantilla NUEVA (destino variable,
//     {{to_email}}) — ver README, sección "Plantilla para clientes".
// Todas estas variables se configuran en Vercel, NUNCA en el index.html
// (la Private Key es secreta — a diferencia de la Public Key, esta si se
// filtra le permite a cualquiera mandar correos desde tu cuenta).
const emailjs = require('@emailjs/nodejs');

const SERVICE_ID = process.env.EMAILJS_SERVICE_ID;
const TEMPLATE_AYUDA = process.env.EMAILJS_TEMPLATE_ID_AYUDA;
const TEMPLATE_CLIENTE = process.env.EMAILJS_TEMPLATE_ID_CLIENTE;
const PUBLIC_KEY = process.env.EMAILJS_PUBLIC_KEY;
const PRIVATE_KEY = process.env.EMAILJS_PRIVATE_KEY;

function listoParaAyuda() {
  return !!(SERVICE_ID && TEMPLATE_AYUDA && PUBLIC_KEY && PRIVATE_KEY);
}
function listoParaCliente() {
  return !!(SERVICE_ID && TEMPLATE_CLIENTE && PUBLIC_KEY && PRIVATE_KEY);
}

async function enviar(templateId, params) {
  return emailjs.send(SERVICE_ID, templateId, params, {
    publicKey: PUBLIC_KEY,
    privateKey: PRIVATE_KEY
  });
}

// Te avisa a ti (zano.ayuda@gmail.com) — reutiliza la plantilla de Ayuda.
async function notificarDueño(titulo, mensaje) {
  if (!listoParaAyuda()) {
    console.warn('[email] EmailJS (plantilla Ayuda) no configurado — no se avisó al dueño:', titulo);
    return { skipped: true };
  }
  try {
    return await enviar(TEMPLATE_AYUDA, { from_name: titulo, from_email: '', message: mensaje });
  } catch (err) {
    console.error('[email] Error avisando al dueño:', err);
    return { error: true };
  }
}

// Le manda un correo a un cliente (destino dinámico) — usa la plantilla nueva.
async function mandarCorreoCliente(toEmail, toName, subject, body) {
  if (!listoParaCliente()) {
    console.warn('[email] EmailJS (plantilla Cliente) no configurado — no se mandó correo a:', toEmail);
    return { skipped: true };
  }
  try {
    return await enviar(TEMPLATE_CLIENTE, { to_email: toEmail, to_name: toName || '', subject, body });
  } catch (err) {
    console.error('[email] Error mandando correo a cliente:', err);
    return { error: true };
  }
}

module.exports = { notificarDueño, mandarCorreoCliente };
