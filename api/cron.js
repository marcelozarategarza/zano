// Se despierta solo UNA vez al día (ver vercel.json) y hace dos cosas:
//  1. Si hoy es jueves: le manda un recordatorio a cada cuenta que todavía no
//     tiene pagado su pedido de la semana que entra.
//  2. Todos los días: revisa pedidos que quedaron "a medias" (se guardaron
//     como borrador pero nunca se pagaron) hace más de 3 horas, y les manda
//     un solo recordatorio (nunca más de uno por pedido).
const { getPool } = require('./_db');
const { mandarCorreoCliente } = require('./_email');

function mondayOfUTCDate(d) {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay(); // 0 domingo .. 6 sábado
  const diff = (day === 0 ? -6 : 1) - day;
  date.setUTCDate(date.getUTCDate() + diff);
  return date.toISOString().slice(0, 10);
}
function addDaysISO(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

module.exports = async function handler(req, res) {
  const authHeader = req.headers.authorization;
  const secret = process.env.CRON_SECRET;
  if (!secret || authHeader !== `Bearer ${secret}`) {
    res.status(401).json({ error: 'No autorizado.' });
    return;
  }

  const pool = getPool();
  const now = new Date();
  const isThursday = now.getUTCDay() === 4; // jueves
  const results = { recordatorios: 0, abandonados: 0, isThursday };

  try {
    if (isThursday) {
      const thisMonday = mondayOfUTCDate(now);
      const nextMonday = addDaysISO(thisMonday, 7);
      const { rows: usuarios } = await pool.query(
        `SELECT u.id, u.name, u.email FROM users u
         WHERE (u.last_reminder_week IS DISTINCT FROM $1::date)
         AND NOT EXISTS (
           SELECT 1 FROM weekly_orders w
           WHERE w.user_id = u.id AND w.week_start = $1::date AND w.status = 'paid'
         )`,
        [nextMonday]
      );
      for (const u of usuarios) {
        await mandarCorreoCliente(
          u.email,
          u.name,
          'No olvides tu pedido de la próxima semana',
          'Todavía no tienes armado (o pagado) tu pedido de ZANO para la próxima semana. Entra a la app y elige tus platillos antes de que se cierren los horarios de recogida que quieras.'
        );
        await pool.query('UPDATE users SET last_reminder_week = $1::date WHERE id = $2', [nextMonday, u.id]);
        results.recordatorios++;
      }
    }

    const { rows: abandonados } = await pool.query(
      `SELECT w.id, u.name, u.email FROM weekly_orders w
       JOIN users u ON u.id = w.user_id
       WHERE w.status = 'draft'
       AND w.abandoned_reminder_sent_at IS NULL
       AND w.updated_at < now() - interval '3 hours'
       AND w.items::text <> '{}'`
    );
    for (const o of abandonados) {
      await mandarCorreoCliente(
        o.email,
        o.name,
        'Se te quedó a medias tu pedido en ZANO',
        'Empezaste a armar tu pedido de la semana en ZANO pero no llegaste a pagarlo. Entra a la app para terminarlo antes de que se cierre tu horario de recogida.'
      );
      await pool.query('UPDATE weekly_orders SET abandoned_reminder_sent_at = now() WHERE id = $1', [o.id]);
      results.abandonados++;
    }

    res.status(200).json({ ok: true, ...results });
  } catch (err) {
    console.error('[cron] Error:', err);
    res.status(500).json({ error: 'Error del servidor en el cron.' });
  }
};
