// Todo lo que necesita el panel de cocina/trabajadores: los pedidos ya
// pagados de ESTA semana, uno por cada día que tengan platillo, con su
// estatus de preparación (pendiente / en_proceso / listo / entregado) y el
// conteo de croissants vendidos hoy sin pedido previo (walk-ins).
// No incluye ventas, ganancias ni ningún dato financiero — eso solo vive en
// el panel de administración (ver admin-data.js).
const { getPool } = require('./_db');
const { getStaffFromRequest } = require('./_auth');

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

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Método no permitido.' });
    return;
  }
  const staff = getStaffFromRequest(req);
  if (!staff) {
    res.status(401).json({ error: 'Sesión inválida o vencida.' });
    return;
  }
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

    const croissantRes = await pool.query(
      `SELECT count FROM croissant_counts WHERE day = CURRENT_DATE`
    );
    const croissantHoy = croissantRes.rows[0] ? croissantRes.rows[0].count : 0;

    res.status(200).json({ weekStart, rows, croissantHoy });
  } catch (err) {
    console.error('[staff-data] Error:', err);
    res.status(500).json({ error: 'Error del servidor al cargar los pedidos.' });
  }
};
