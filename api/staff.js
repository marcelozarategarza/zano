// Panel de cocina/trabajadores — TODO en un solo archivo (login, datos,
// cambiar estatus de un pedido, y el conteo de croissants) para no pasarnos
// del límite de 12 funciones serverless del plan gratuito de Vercel.
// Qué acción hacer se decide con ?action=... en la URL:
//   POST /api/staff?action=login          { password }
//   GET  /api/staff?action=data
//   POST /api/staff?action=update-status  { orderId, dia, status }
//   POST /api/staff?action=croissant      { delta }
const { getPool } = require('./_db');
const { signStaffToken, getStaffFromRequest } = require('./_auth');
const { getClientIp, checkThrottle, registerFail, registerSuccess } = require('./_throttle');

const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'];
const ESTATUS_VALIDOS = ['pendiente', 'en_proceso', 'listo', 'entregado'];

// Lunes de la semana actual, en la zona horaria del servidor (igual que
// computeWeekStartISO() en el frontend, con la misma limitación: si el
// servidor y el teléfono están en zonas horarias distintas puede haber un
// desfase de un día justo al filo de la medianoche).
function weekStartISO() {
  const d = new Date();
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff);
  const yyyy = monday.getFullYear();
  const mm = String(monday.getMonth() + 1).padStart(2, '0');
  const dd = String(monday.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

async function handleLogin(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Método no permitido.' }); return; }
  try {
    const { password } = req.body || {};
    const real = process.env.STAFF_PASSWORD;
    if (!real) { res.status(500).json({ error: 'Falta configurar STAFF_PASSWORD en el servidor.' }); return; }

    // Igual que en admin-login: una sola contraseña compartida, así que el
    // límite de intentos se cuenta por IP en vez de por cuenta.
    const pool = getPool();
    const ip = getClientIp(req);
    const throttle = await checkThrottle(pool, 'staff', ip);
    if (throttle.blocked) {
      res.status(429).json({ error: `Demasiados intentos fallidos. Espera ${throttle.minutosRestantes} minuto(s) e intenta de nuevo.` });
      return;
    }

    if (!password || password !== real) {
      await registerFail(pool, 'staff', ip);
      res.status(401).json({ error: 'Contraseña incorrecta.' });
      return;
    }
    await registerSuccess(pool, 'staff', ip);
    const token = signStaffToken();
    res.status(200).json({ token });
  } catch (err) {
    console.error('[staff:login] Error:', err);
    res.status(500).json({ error: 'Error del servidor.' });
  }
}

async function handleData(req, res) {
  if (req.method !== 'GET') { res.status(405).json({ error: 'Método no permitido.' }); return; }
  const staff = getStaffFromRequest(req);
  if (!staff) { res.status(401).json({ error: 'Sesión inválida o vencida.' }); return; }
  try {
    const pool = getPool();
    const weekStart = weekStartISO();

    const ordersRes = await pool.query(
      `SELECT w.id AS order_id, w.items, w.horarios, w.day_status, w.plantel,
              u.name AS user_name, u.plantel AS user_plantel
       FROM weekly_orders w
       JOIN users u ON u.id = w.user_id
       WHERE w.status = 'paid' AND w.week_start = $1`,
      [weekStart]
    );

    const rows = [];
    for (const o of ordersRes.rows) {
      const items = o.items || {};
      const horarios = o.horarios || {};
      const dayStatus = o.day_status || {};
      const plantel = o.plantel || o.user_plantel || null;
      for (const dia of DIAS) {
        const item = items[dia];
        if (!item || !item.name) continue;
        const estatus = dayStatus[dia];
        rows.push({
          orderId: o.order_id,
          dia,
          cliente: o.user_name,
          plantel,
          horario: horarios[dia] || null,
          platillo: item.name,
          status: ESTATUS_VALIDOS.includes(estatus) ? estatus : 'pendiente'
        });
      }
    }
    rows.sort((a, b) => DIAS.indexOf(a.dia) - DIAS.indexOf(b.dia) || (a.horario || '').localeCompare(b.horario || ''));

    const croissantRes = await pool.query(`SELECT count FROM croissant_counts WHERE day = CURRENT_DATE`);
    const croissantHoy = croissantRes.rows[0] ? croissantRes.rows[0].count : 0;

    res.status(200).json({ weekStart, rows, croissantHoy });
  } catch (err) {
    console.error('[staff:data] Error:', err);
    res.status(500).json({ error: 'Error del servidor al cargar los pedidos.' });
  }
}

async function handleUpdateStatus(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Método no permitido.' }); return; }
  const staff = getStaffFromRequest(req);
  if (!staff) { res.status(401).json({ error: 'Sesión inválida o vencida.' }); return; }
  try {
    const { orderId, dia, status } = req.body || {};
    if (!orderId || !dia || !ESTATUS_VALIDOS.includes(status)) { res.status(400).json({ error: 'Datos inválidos.' }); return; }
    const pool = getPool();
    await pool.query(
      `UPDATE weekly_orders
       SET day_status = jsonb_set(COALESCE(day_status, '{}'::jsonb), $2, to_jsonb($3::text), true),
           updated_at = now()
       WHERE id = $1`,
      [orderId, [dia], status]
    );
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[staff:update-status] Error:', err);
    res.status(500).json({ error: 'Error del servidor al actualizar el pedido.' });
  }
}

async function handleCroissant(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Método no permitido.' }); return; }
  const staff = getStaffFromRequest(req);
  if (!staff) { res.status(401).json({ error: 'Sesión inválida o vencida.' }); return; }
  try {
    const delta = (req.body && req.body.delta === -1) ? -1 : 1;
    const pool = getPool();
    const r = await pool.query(
      `INSERT INTO croissant_counts (day, count, updated_at)
       VALUES (CURRENT_DATE, GREATEST($1, 0), now())
       ON CONFLICT (day) DO UPDATE
         SET count = GREATEST(croissant_counts.count + $1, 0), updated_at = now()
       RETURNING count`,
      [delta]
    );
    res.status(200).json({ ok: true, count: r.rows[0].count });
  } catch (err) {
    console.error('[staff:croissant] Error:', err);
    res.status(500).json({ error: 'Error del servidor al actualizar el conteo.' });
  }
}

module.exports = async function handler(req, res) {
  const action = (req.query && req.query.action) || '';
  if (action === 'login') return handleLogin(req, res);
  if (action === 'data') return handleData(req, res);
  if (action === 'update-status') return handleUpdateStatus(req, res);
  if (action === 'croissant') return handleCroissant(req, res);
  res.status(400).json({ error: 'Acción no reconocida.' });
};
