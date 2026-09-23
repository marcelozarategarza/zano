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
    pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
  }
  return pool;
}

module.exports = { getPool };
