// Junta todo lo que el panel de administración necesita en una sola
// llamada: clientes, pedidos pagados (agrupados por semana, con calendario
// de entregas y conteo de platillos) y los gastos que hayas capturado.
// Solo se puede leer con el token de admin (ver admin-login.js).
const { getPool } = require('./_db');
const { getAdminFromRequest } = require('./_auth');

const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'];

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Método no permitido.' });
    return;
  }
  const admin = getAdminFromRequest(req);
  if (!admin) {
    res.status(401).json({ error: 'Sesión de administrador inválida o vencida.' });
    return;
  }
  try {
    const pool = getPool();

    const customersRes = await pool.query(
      `SELECT id, name, email, phone, plantel, created_at::date::text AS created_at
       FROM users ORDER BY created_at DESC`
    );

    // Solo pedidos ya PAGADOS (eso es venta real) de los últimos ~6 meses,
    // para no traer un historial infinito cada vez que abres el panel.
    const ordersRes = await pool.query(
      `SELECT w.week_start::text AS week_start, w.items, w.horarios, w.plantel, w.total_cents,
              u.name AS user_name, u.plantel AS user_plantel
       FROM weekly_orders w
       JOIN users u ON u.id = w.user_id
       WHERE w.status = 'paid' AND w.week_start >= (CURRENT_DATE - INTERVAL '182 days')
       ORDER BY w.week_start DESC`
    );

    const costsRes = await pool.query(
      `SELECT week_start::text AS week_start, ingredientes_cents, empaque_cents, otros_gastos_cents, notas
       FROM weekly_costs ORDER BY week_start DESC`
    );

    const weeksMap = new Map();
    const dishCountsAllTime = {};

    for (const o of ordersRes.rows) {
      const wk = o.week_start;
      if (!weeksMap.has(wk)) {
        weeksMap.set(wk, {
          weekStart: wk,
          ventasCents: 0,
          pedidosPagados: 0,
          dishCounts: {},
          calendario: { Lunes: [], Martes: [], Miércoles: [], Jueves: [], Viernes: [] }
        });
      }
      const w = weeksMap.get(wk);
      w.ventasCents += o.total_cents || 0;
      w.pedidosPagados += 1;

      const items = o.items || {};
      const horarios = o.horarios || {};
      const plantel = o.plantel || o.user_plantel || null;

      for (const dia of DIAS) {
        const item = items[dia];
        if (!item || !item.name) continue;
        w.dishCounts[item.name] = (w.dishCounts[item.name] || 0) + 1;
        dishCountsAllTime[item.name] = (dishCountsAllTime[item.name] || 0) + 1;
        w.calendario[dia].push({
          nombre: o.user_name,
          plantel: plantel,
          horario: horarios[dia] || null,
          platillo: item.name
        });
      }
    }

    const weeks = Array.from(weeksMap.values()).sort((a, b) => b.weekStart.localeCompare(a.weekStart));
    const topDishesAllTime = Object.entries(dishCountsAllTime)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    const costs = costsRes.rows.map((c) => ({
      weekStart: c.week_start,
      ingredientesCents: c.ingredientes_cents || 0,
      empaqueCents: c.empaque_cents || 0,
      otrosGastosCents: c.otros_gastos_cents || 0,
      notas: c.notas || ''
    }));

    res.status(200).json({
      customers: customersRes.rows.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        phone: u.phone,
        plantel: u.plantel,
        createdAt: u.created_at
      })),
      weeks,
      topDishesAllTime,
      costs
    });
  } catch (err) {
    console.error('[admin-data] Error:', err);
    res.status(500).json({ error: 'Error del servidor al cargar los datos.' });
  }
};
