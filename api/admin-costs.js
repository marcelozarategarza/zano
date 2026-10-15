// Varios "guardados" de Administración en un solo archivo (el plan gratuito
// de Vercel limita a 12 funciones — ver nota en api/mercadopago.js). Solo
// con token de admin. Se distingue por el campo "tipo" que manda la app:
//   tipo: 'platilloCosto' { platillo, mdoCents, entregaCents, comisionCents,
//         ingresoCents, materiaPrimaCents, totalCents } -> guarda (o
//         actualiza) los 6 números de costeo de UN platillo — ver
//         Administración > Gastos operativos. api/admin-data.js es quien
//         multiplica esos 6 números por los pedidos de cada semana.
//   tipo: 'croissantPrice' -> guarda el precio fijo de un croissant (para
//         que Cocina muestre el total a cobrar — ver api/staff.js).
//   tipo: 'notificacion'  -> manda una notificación push — a TODOS los
//         clientes que la tengan activada (ej. avisar una promoción) si no
//         se manda "userId", o SOLO a ese cliente si sí se manda — ver
//         Administración > Clientes > "Aviso a clientes", y api/_push.js.
//   tipo: 'eliminarCliente' { userId, asunto, mensaje } -> borra la cuenta
//         de ese cliente (y, con ON DELETE CASCADE, su historial de
//         pedidos y sus notificaciones activadas — ver schema.sql) y le
//         manda, antes de borrarla, un correo con el asunto/mensaje que
//         escribió Administración — ver pestaña Clientes.
const { getPool } = require('./_db');
const { getAdminFromRequest } = require('./_auth');
const { mandarPushAUsuario, mandarPushATodos } = require('./_push');
const { mandarCorreoCliente } = require('./_email');

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

  if (tipo === 'platilloCosto') {
    try {
      const { platillo, mdoCents, entregaCents, comisionCents, ingresoCents, materiaPrimaCents, totalCents } = req.body || {};
      const nombre = (platillo || '').trim();
      if (!nombre) {
        res.status(400).json({ error: 'Falta el nombre del platillo.' });
        return;
      }
      const pool = getPool();
      await pool.query(
        `INSERT INTO platillo_costos (platillo, mdo_cents, entrega_cents, comision_cents, ingreso_cents, materia_prima_cents, total_cents, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now())
         ON CONFLICT (platillo)
         DO UPDATE SET mdo_cents = EXCLUDED.mdo_cents, entrega_cents = EXCLUDED.entrega_cents,
                       comision_cents = EXCLUDED.comision_cents, ingreso_cents = EXCLUDED.ingreso_cents,
                       materia_prima_cents = EXCLUDED.materia_prima_cents, total_cents = EXCLUDED.total_cents,
                       updated_at = now()`,
        [nombre, mdoCents || 0, entregaCents || 0, comisionCents || 0, ingresoCents || 0, materiaPrimaCents || 0, totalCents || 0]
      );
      res.status(200).json({ ok: true });
    } catch (err) {
      console.error('[admin-costs:platilloCosto] Error:', err);
      res.status(500).json({ error: 'Error del servidor al guardar el costeo del platillo.' });
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

  if (tipo === 'eliminarCliente') {
    try {
      const { userId, asunto, mensaje } = req.body || {};
      const uid = Number(userId);
      const texto = (mensaje || '').trim();
      if (!uid) {
        res.status(400).json({ error: 'Cliente no válido.' });
        return;
      }
      if (!texto) {
        res.status(400).json({ error: 'Escribe el mensaje del correo antes de eliminar la cuenta.' });
        return;
      }
      const pool = getPool();
      const userRes = await pool.query('SELECT name, email FROM users WHERE id = $1', [uid]);
      const cliente = userRes.rows[0];
      if (!cliente) {
        res.status(404).json({ error: 'Ese cliente ya no existe (puede que ya lo hayas eliminado).' });
        return;
      }

      // El correo se manda ANTES de borrar — una vez borrada la cuenta ya
      // no tendríamos de dónde sacar su nombre/correo si algo saliera mal
      // después. Si el correo falla (cuota de EmailJS agotada, etc.), la
      // cuenta se borra igual — avisamos abajo si no se pudo mandar, pero
      // no se queda la cuenta "a medias" por un correo que no salió.
      const asuntoLimpio = (asunto || '').trim();
      const envioCorreo = await mandarCorreoCliente(
        cliente.email,
        cliente.name,
        asuntoLimpio || 'Tu cuenta en ZANO fue eliminada',
        texto
      );

      // ON DELETE CASCADE en la base de datos borra junto con el cliente su
      // historial de pedidos (weekly_orders) y sus notificaciones activadas
      // (push_subscriptions) — ver schema.sql. No hace falta borrar nada
      // más a mano.
      await pool.query('DELETE FROM users WHERE id = $1', [uid]);

      res.status(200).json({ ok: true, correoEnviado: !envioCorreo.skipped && !envioCorreo.error });
    } catch (err) {
      console.error('[admin-costs:eliminarCliente] Error:', err);
      res.status(500).json({ error: 'No se pudo eliminar la cuenta. Intenta de nuevo.' });
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

  res.status(400).json({ error: 'Tipo de guardado no reconocido.' });
};
