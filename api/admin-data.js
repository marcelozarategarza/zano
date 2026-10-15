// Junta todo lo que el panel de administración necesita en una sola
// llamada: clientes, pedidos pagados por semana (con calendario de
// entregas, conteo de platillos y quién pidió cada uno), y el costeo por
// platillo (editable desde Administración > Gastos operativos). Solo se
// puede leer con el token de admin (ver admin-login.js).
//
// Los 6 números de costo de cada platillo (MdO, costo de entrega, comisión,
// ingreso, materia prima, total sin IVA) YA NO se calculan solos con una
// regla fija — cada platillo tiene su propio costeo, capturado a mano por
// el dueño y guardado en la tabla platillo_costos (ver schema.sql y
// api/admin-costs.js, tipo='platilloCosto'). Aquí solo se multiplican esos
// 6 números por la cantidad de pedidos de cada platillo, semana por semana.
const { getPool } = require('./_db');
const { getAdminFromRequest } = require('./_auth');

const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'];

// El Poke se guarda siempre con el mismo nombre ("Poke") en el pedido, sin
// importar qué proteína se eligió (ver index.html, isPokeSelected) — la
// proteína elegida vive aparte, en item.savedIngredients. Pero cuesta
// distinto según la proteína (atún/salmón/camarón), así que para el costeo
// y para "Pedidos de la semana" lo separamos en 3 nombres distintos.
// "Pasta Alfredo con Pollo" y "Yogurt Griego" también se renombran aquí
// nada más para que coincidan con los nombres del costeo que capturó el
// dueño en Administración > Gastos operativos.
function nombreCosteo(itemName, savedIngredients) {
  if (itemName === 'Poke') {
    const ing = savedIngredients || {};
    if (ing.atun) return 'Poke Atún';
    if (ing.salmon) return 'Poke Salmón';
    if (ing.camaron) return 'Poke Camarón';
    return 'Poke';
  }
  if (itemName === 'Pasta Alfredo con Pollo') return 'Pasta Alfredo';
  if (itemName === 'Yogurt Griego') return 'Yogurt con Granola';
  return itemName;
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
      `SELECT w.week_start::text AS week_start, w.items, w.horarios, w.plantel,
              u.name AS user_name, u.plantel AS user_plantel
       FROM weekly_orders w
       JOIN users u ON u.id = w.user_id
       WHERE w.status = 'paid' AND w.week_start >= (CURRENT_DATE - INTERVAL '182 days')
       ORDER BY w.week_start DESC`
    );

    const costosRes = await pool.query(
      `SELECT platillo, mdo_cents, entrega_cents, comision_cents, ingreso_cents, materia_prima_cents, total_cents
       FROM platillo_costos ORDER BY id`
    );
    const costosMap = new Map(costosRes.rows.map((c) => [c.platillo, c]));

    // Precio del croissant (venta presencial, sin pedido previo, que llega
    // de Cocina) — se sigue editando desde aquí (Gastos operativos) porque
    // el panel de Cocina lo necesita para mostrar el total a cobrar.
    const settingsRes = await pool.query(
      `SELECT croissant_price_cents FROM business_settings WHERE id = 1`
    );
    const croissantPriceCents = settingsRes.rows[0] ? (settingsRes.rows[0].croissant_price_cents || 0) : 0;

    const weeksMap = new Map();

    for (const o of ordersRes.rows) {
      const wk = o.week_start;
      if (!weeksMap.has(wk)) {
        weeksMap.set(wk, {
          weekStart: wk,
          dishCounts: {},
          dishClients: {},
          calendario: { Lunes: [], Martes: [], Miércoles: [], Jueves: [], Viernes: [] }
        });
      }
      const w = weeksMap.get(wk);

      const items = o.items || {};
      const horarios = o.horarios || {};
      const plantel = o.plantel || o.user_plantel || null;

      for (const dia of DIAS) {
        const item = items[dia];
        if (!item || !item.name) continue;

        const nombre = nombreCosteo(item.name, item.savedIngredients);
        w.dishCounts[nombre] = (w.dishCounts[nombre] || 0) + 1;
        if (!w.dishClients[nombre]) w.dishClients[nombre] = [];
        w.dishClients[nombre].push({
          nombre: o.user_name,
          dia,
          plantel,
          horario: horarios[dia] || null
        });

        w.calendario[dia].push({
          nombre: o.user_name,
          plantel: plantel,
          horario: horarios[dia] || null,
          platillo: item.name
        });
      }
    }

    // Con el conteo de pedidos por platillo de cada semana, armamos el
    // desglose de costos (Gastos operativos) multiplicando los 6 números
    // del costeo de ese platillo por cuántas veces se pidió esa semana.
    for (const w of weeksMap.values()) {
      const dishCosts = {};
      const totales = { mdoCents: 0, entregaCents: 0, comisionCents: 0, ingresoCents: 0, materiaPrimaCents: 0, totalCents: 0 };
      let pedidosTotal = 0;
      for (const [nombre, count] of Object.entries(w.dishCounts)) {
        const c = costosMap.get(nombre) || {};
        const fila = {
          count,
          mdoCents: (c.mdo_cents || 0) * count,
          entregaCents: (c.entrega_cents || 0) * count,
          comisionCents: (c.comision_cents || 0) * count,
          ingresoCents: (c.ingreso_cents || 0) * count,
          materiaPrimaCents: (c.materia_prima_cents || 0) * count,
          totalCents: (c.total_cents || 0) * count
        };
        dishCosts[nombre] = fila;
        totales.mdoCents += fila.mdoCents;
        totales.entregaCents += fila.entregaCents;
        totales.comisionCents += fila.comisionCents;
        totales.ingresoCents += fila.ingresoCents;
        totales.materiaPrimaCents += fila.materiaPrimaCents;
        totales.totalCents += fila.totalCents;
        pedidosTotal += count;
      }
      w.dishCosts = dishCosts;
      w.opTotales = totales;
      w.pedidosTotal = pedidosTotal;
    }

    const weeks = Array.from(weeksMap.values()).sort((a, b) => b.weekStart.localeCompare(a.weekStart));

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
      platilloCostos: costosRes.rows.map((c) => ({
        platillo: c.platillo,
        mdoCents: c.mdo_cents,
        entregaCents: c.entrega_cents,
        comisionCents: c.comision_cents,
        ingresoCents: c.ingreso_cents,
        materiaPrimaCents: c.materia_prima_cents,
        totalCents: c.total_cents
      })),
      croissantPriceCents
    });
  } catch (err) {
    console.error('[admin-data] Error:', err);
    res.status(500).json({ error: 'Error del servidor al cargar los datos.' });
  }
};
