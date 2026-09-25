// Conexión a la base de datos Postgres (Neon, vía Vercel Marketplace).
// Ver README, sección "Base de datos" para crearla y conectarla a tu proyecto.
const { Pool } = require('pg');

let pool;

function getPool() {
  if (!pool) {
    const connectionString =
      process.env.DATABASE_URL ||
      process.env.POSTGRES_URL ||
      process.env.DATABASE_URL_UNPOOLED;
    if (!connectionString) {
      throw new Error(
        'Falta configurar la base de datos: agrega DATABASE_URL (o POSTGRES_URL) en las variables de entorno de tu proyecto en Vercel.'
      );
    }
    pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
      // Seguridad para que la app aguante a muchas personas usándola al
      // mismo tiempo (por ejemplo, todas ordenando el mismo día antes de
      // que cierre la semana):
      //
      // - max: 1 → cada función de Vercel abre COMO MÁXIMO 1 conexión a la
      //   base de datos. Vercel puede levantar muchas copias de la misma
      //   función al mismo tiempo cuando hay mucha gente conectada (cada
      //   una en su propio contenedor, sin compartir este "pool" entre
      //   sí), así que si cada una pudiera abrir varias conexiones (el
      //   valor por default de esta librería es 10), entre pocas personas
      //   ya se podría agotar el límite de conexiones que permite Neon.
      //   Con max:1, el límite total queda controlado por cuántas
      //   funciones corren a la vez, no multiplicado por 10.
      // - connectionTimeoutMillis → si no logra conectarse a la base de
      //   datos rápido (por ejemplo porque está saturada un instante),
      //   falla rápido con un error claro en vez de dejar a la persona
      //   esperando sin respuesta.
      // - idleTimeoutMillis → cierra la conexión si lleva un rato sin
      //   usarse, para no dejar conexiones "fantasma" abiertas de más.
      max: 1,
      connectionTimeoutMillis: 8000,
      idleTimeoutMillis: 10000,
    });
  }
  return pool;
}

module.exports = { getPool };
