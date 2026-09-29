// Junta todo lo que el panel de administración necesita en una sola
// llamada: clientes, pedidos pagados (agrupados por semana, con calendario
// de entregas y conteo de platillos) y los gastos de cada semana. Solo se
// puede leer con el token de admin (ver admin-login.js).
//
// Los gastos por platillo (Ingredientes, Sueldo del jefe, Sueldo de los
// cocineros, Comisión al instituto, Pago de inversión) YA NO se escriben a
// mano: se calculan aquí solos, platillo por platillo, a partir de lo que
// cada cliente pagó por su platillo esa semana. La regla (explicada por el
// dueño): de cada platillo vendido, $70 pesos se reparten siempre igual —
// $20 sueldo del jefe, $20 sueldo de los dos cocineros, $10 comisión al
// instituto y $20 pago de inversión — y el resto del precio del platillo
// (precio − $70) es el costo real de ingredientes (empaque ya va incluido
// ahí). Solo "Otros gastos" (transporte, gas, etc.) sigue siendo un campo
// que el dueño captura a mano, porque no depende de qué platillo se vendió.
const { getPool } = require('./_db');
const { getAdminFromRequest } = require('./_auth');

const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'];

// Reparto fijo de los $70 por cada platillo vendido (en centavos).
const SUELDO_JEFE_CENTS = 2000;
const SUELDO_COCINEROS_CENTS = 2000;
const COMISION_INSTITUTO_CENTS = 1000;
const PAGO_INVERSION_CENTS = 2000;
const TOTAL_REPARTO_CENTS = SUELDO_JEFE_CENTS + SUELDO_COCINEROS_CENTS + COMISION_INSTITUTO_CENTS + PAGO_INVERSION_CENTS; // 7000

// Convierte un precio guardado como texto (ej. "$150.00", "Gratis") a
// centavos. Si no se puede leer un número, regresa 0 (por ejemplo, "Gratis"
// o un precio que todavía no se ha definido).
function precioACentavos(str) {
  if (!str) return 0;
  const n = parseFloat(String(str).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

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

    // De weekly_costs solo usamos "Otros gastos" y las notas — lo demás ya
    // se calcula solo (ver arriba). Las columnas viejas (ingredientes_cents,
    // etc.) se dejan sin usar, no hace falta borrarlas.
    const costsRes = await pool.query(
      `SELECT week_start::text AS week_start, otros_gastos_cents, notas
       FROM weekly_costs ORDER BY week_start DESC`
    );

    // Valor de referencia fijo para Ganancia neta, y precio del croissant
    // (una sola fila, id=1). Si por lo que sea la fila no existe todavía
    // (por ejemplo, si aún no has vuelto a correr schema.sql), se trata como
    // $0 en vez de tronar.
    const settingsRes = await pool.query(
      `SELECT meta_recuperacion_cents, croissant_price_cents FROM business_settings WHERE id = 1`
    );

    // Ventas de croissants (los únicos que se venden en el momento, sin
    // pedido previo — ver croissant_sales en schema.sql), agrupadas por
    // semana Y por cómo se cobraron. Se muestran APARTE de las ventas de
    // platillos con pedido previo, no se suman a Ganancia bruta/neta.
    // date_trunc('week', ...) en Postgres regresa el lunes de esa semana,
    // igual que weekStart en todo lo demás de este archivo.
    const croissantsRes = await pool.query(
      `SELECT date_trunc('week', day)::date::text AS week_start, payment_method, SUM(quantity)::int AS qty
       FROM croissant_sales
       WHERE day >= (CURRENT_DATE - INTERVAL '182 days')
       GROUP BY 1, 2
       ORDER BY 1 DESC`
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
          calendario: { Lunes: [], Martes: [], Miércoles: [], Jueves: [], Viernes: [] },
          // Desglose automático de gastos por platillo vendido (ver arriba).
          platillosContados: 0,
          ingredientesAutoCents: 0,
          sueldoJefeCents: 0,
          sueldoCocinerosCents: 0,
          comisionInstitutoCents: 0,
          pagoInversionCents: 0
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

        const precioCents = precioACentavos(item.price);
        if (precioCents > 0) {
          w.platillosContados += 1;
          w.ingredientesAutoCents += Math.max(0, precioCents - TOTAL_REPARTO_CENTS);
          w.sueldoJefeCents += SUELDO_JEFE_CENTS;
          w.sueldoCocinerosCents += SUELDO_COCINEROS_CENTS;
          w.comisionInstitutoCents += COMISION_INSTITUTO_CENTS;
          w.pagoInversionCents += PAGO_INVERSION_CENTS;
        }
      }
    }

    const weeks = Array.from(weeksMap.values()).sort((a, b) => b.weekStart.localeCompare(a.weekStart));
    const topDishesAllTime = Object.entries(dishCountsAllTime)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    const costs = costsRes.rows.map((c) => ({
      weekStart: c.week_start,
      otrosGastosCents: c.otros_gastos_cents || 0,
      notas: c.notas || ''
    }));

    const metaRecuperacionCents = settingsRes.rows[0] ? (settingsRes.rows[0].meta_recuperacion_cents || 0) : 0;
    const croissantPriceCents = settingsRes.rows[0] ? (settingsRes.rows[0].croissant_price_cents || 0) : 0;

    const croissantsMap = new Map();
    for (const c of croissantsRes.rows) {
      const wk = c.week_start;
      if (!croissantsMap.has(wk)) {
        croissantsMap.set(wk, { weekStart: wk, efectivoQty: 0, tarjetaQty: 0 });
      }
      const cw = croissantsMap.get(wk);
      if (c.payment_method === 'efectivo') cw.efectivoQty += c.qty || 0;
      else if (c.payment_method === 'tarjeta') cw.tarjetaQty += c.qty || 0;
    }
    const croissants = Array.from(croissantsMap.values())
      .sort((a, b) => b.weekStart.localeCompare(a.weekStart))
      .map((cw) => ({
        weekStart: cw.weekStart,
        efectivoQty: cw.efectivoQty,
        tarjetaQty: cw.tarjetaQty,
        totalQty: cw.efectivoQty + cw.tarjetaQty,
        efectivoCents: cw.efectivoQty * croissantPriceCents,
        tarjetaCents: cw.tarjetaQty * croissantPriceCents,
        totalCents: (cw.efectivoQty + cw.tarjetaQty) * croissantPriceCents
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
      costs,
      metaRecuperacionCents,
      croissantPriceCents,
      croissants
    });
  } catch (err) {
    console.error('[admin-data] Error:', err);
    res.status(500).json({ error: 'Error del servidor al cargar los datos.' });
  }
};
