// Mueve un pedido (de un día en concreto) a otro estatus de preparación:
// pendiente -> en_proceso -> listo -> entregado (y de regreso, por si se
// tocó el botón equivocado). Solo con sesión de personal o de admin.
const { getPool } = require('./_db');
const { getStaffFromRequest } = require('./_auth');

const ESTATUS_VALIDOS = ['pendiente', 'en_proceso', 'listo', 'entregado'];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido.' });
    return;
  }
  const staff = getStaffFromRequest(req);
  if (!staff) {
    res.status(401).json({ error: 'Sesión inválida o vencida.' });
    return;
  }
  try {
    const { orderId, dia, status } = req.body || {};
    if (!orderId || !dia || !ESTATUS_VALIDOS.includes(status)) {
      res.status(400).json({ error: 'Datos inválidos.' });
      return;
    }
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
    console.error('[staff-update-status] Error:', err);
    res.status(500).json({ error: 'Error del servidor al actualizar el pedido.' });
  }
};
