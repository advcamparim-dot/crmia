import { Pool } from 'pg';

let pool: Pool | undefined;

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.SUPABASE_DB_URL;
    if (!connectionString) throw new Error('SUPABASE_DB_URL não configurada');
    pool = new Pool({
      connectionString,
      ssl: true,
      options: '-c timezone=America/Sao_Paulo'
    });
    pool.on('error', (err) => {
      console.error('Unexpected error on idle Postgres client', err);
    });
  }
  return pool;
}
