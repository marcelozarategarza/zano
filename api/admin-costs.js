// Guarda (o actualiza) "Otros gastos" y las notas de una semana. Los demás
// gastos (Ingredientes, Sueldo del jefe, Sueldo de los cocineros, Comisión
// al instituto, Pago de inversión) ya NO se capturan aquí — se calculan
// solos en api/admin-data.js a partir de los platillos vendidos esa semana.
// Solo con token de admin.
//
// También guarda aquí el "valor de referencia" para Ganancia neta (un solo
// valor fijo, no por semana) — se metió en este mismo archivo, en vez de
// crear uno nuevo, porque el plan gratuito de Vercel limita a 12 funciones
// (ver nota en api/mercadopago.js). Se
// distingue por el campo "tipo" que manda la app:
//   tipo: 'semana' (o sin "tipo", para no romper nada que ya funcionaba)
//         -> guarda Otros gastos y notas de una semana.
//   tipo: 'meta'   -> guarda el valor de referencia fijo para Ganancia neta.
//   tipo: 'croissantPrice' -> guarda el precio fijo de un croissant (para
//         armar las ventas de croissants que llegan de Cocina, ver
//         api/admin-data.js y api/staff.js).
//   tipo: 'notificacion'  -> manda una notificación push — a TODOS los
//         clientes que la tengan activada (ej. avisar una promoción) si no
//         se manda "userId", o SOLO a ese cliente si sí se manda — ver
//         Administración > Gastos > "Aviso a clientes", y api/_push.js.
const { getPool } = require('./_db');
const { getAdminFromRequest } = require('./_auth');
const { mandarPushAUsuario, mandarPushATodos } = require('./_push');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido.' });
    return;
  }
  const admin = getAdminFromRequest(req);
  if (!admin) {
    res.status(401).json({ error: 'Sesión de administrador inválida o vencida.' });
    return;
  }

  const { tipo } = req.body || {};

  if (tipo === 'meta') {
    try {
      const { metaRecuperacionCents } = req.body || {};
      const pool = getPool();
      await pool.query(
        `INSERT INTO business_settings (id, meta_recuperacion_cents, updated_at)
         VALUES (1, $1, now())
         ON CONFLICT (id)
         DO UPDATE SET meta_recuperacion_cents = EXCLUDED.meta_recuperacion_cents, updated_at = now()`,
        [metaRecuperacionCents || 0]
      );
      res.status(200).json({ ok: true });
    } catch (err) {
      console.error('[admin-costs:meta] Error:', err);
      res.status(500).json({ error: 'Error del servidor al guardar el valor de referencia.' });
    }
    return;
  }

  if (tipo === 'notificacion') {
    try {
      const { titulo, mensaje, userId } = req.body || {};
      const texto = (mensaje || '').trim();
      if (!texto) {
        res.status(400).json({ error: 'Escribe el mensaje de la notificación.' });
        return;
      }
      const tituloLimpio = (titulo || '').trim();
      const payload = { title: tituloLimpio || 'ZANO', body: texto, url: '/' };

      let resultado;
      if (userId) {
        const uid = Number(userId);
        if (!uid) {
          res.status(400).json({ error: 'Cliente no válido.' });
          return;
        }
        resultado = await mandarPushAUsuario(uid, payload);
      } else {
        resultado = await mandarPushATodos(payload);
      }
      res.status(200).json({ ok: true, enviados: (resultado && resultado.enviados) || 0 });
    } catch (err) {
      console.error('[admin-costs:notificacion] Error:', err);
      res.status(500).json({ error: 'No se pudo mandar la notificación. Intenta de nuevo.' });
    }
    return;
  }

  if (tipo === 'croissantPrice') {
    try {
      const { croissantPriceCents } = req.body || {};
      const pool = getPool();
      await pool.query(
        `INSERT INTO business_settings (id, croissant_price_cents, updated_at)
         VALUES (1, $1, now())
         ON CONFLICT (id)
         DO UPDATE SET croissant_price_cents = EXCLUDED.croissant_price_cents, updated_at = now()`,
        [croissantPriceCents || 0]
      );
      res.status(200).json({ ok: true });
    } catch (err) {
      console.error('[admin-costs:croissantPrice] Error:', err);
      res.status(500).json({ error: 'Error del servidor al guardar el precio del croissant.' });
    }
    return;
  }

  try {
    const { weekStart, otrosGastosCents, notas } = req.body || {};
    if (!weekStart) {
      res.status(400).json({ error: 'Falta la semana.' });
      return;
    }
    const pool = getPool();
    await pool.query(
      `INSERT INTO weekly_costs (week_start, otros_gastos_cents, notas, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (week_start)
       DO UPDATE SET otros_gastos_cents = EXCLUDED.otros_gastos_cents, notas = EXCLUDED.notas, updated_at = now()`,
      [weekStart, otrosGastosCents || 0, notas || '']
    );
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[admin-costs] Error:', err);
    res.status(500).json({ error: 'Error del servidor al guardar los gastos.' });
  }
};
  const { tipo } = req.body || {};

  if (tipo === 'meta') {
    try {
      const { metaRecuperacionCents } = req.body || {};
      const pool = getPool();
      await pool.query(
        `INSERT INTO business_settings (id, meta_recuperacion_cents, updated_at)
         VALUES (1, $1, now())
         ON CONFLICT (id)
         DO UPDATE SET meta_recuperacion_cents = EXCLUDED.meta_recuperacion_cents, updated_at = now()`,
        [metaRecuperacionCents || 0]
      );
      res.status(200).json({ ok: true });
    } catch (err) {
      console.error('[admin-costs:meta] Error:', err);
      res.status(500).json({ error: 'Error del servidor al guardar el valor de referencia.' });
    }
    return;
  }

  if (tipo === 'croissantPrice') {
    try {
      const { croissantPriceCents } = req.body || {};
      const pool = getPool();
      await pool.query(
        `INSERT INTO business_settings (id, croissant_price_cents, updated_at)
         VALUES (1, $1, now())
         ON CONFLICT (id)
         DO UPDATE SET croissant_price_cents = EXCLUDED.croissant_price_cents, updated_at = now()`,
        [croissantPriceCents || 0]
      );
      res.status(200).json({ ok: true });
    } catch (err) {
      console.error('[admin-costs:croissantPrice] Error:', err);
      res.status(500).json({ error: 'Error del servidor al guardar el precio del croissant.' });
    }
    return;
  }

  try {
    const { weekStart, otrosGastosCents, notas } = req.body || {};
    if (!weekStart) {
      res.status(400).json({ error: 'Falta la semana.' });
      return;
    }
    const pool = getPool();
    await pool.query(
      `INSERT INTO weekly_costs (week_start, otros_gastos_cents, notas, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (week_start)
       DO UPDATE SET otros_gastos_cents = EXCLUDED.otros_gastos_cents, notas = EXCLUDED.notas, updated_at = now()`,
      [weekStart, otrosGastosCents || 0, notas || '']
    );
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[admin-costs] Error:', err);
    res.status(500).json({ error: 'Error del servidor al guardar los gastos.' });
  }
};
