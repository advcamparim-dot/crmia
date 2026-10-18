import { Pool } from 'pg';
import { SUPABASE_CA_PEM } from './supabase-ca';

let pool: Pool | undefined;

// Verifica o certificado do servidor contra a CA do Supabase. Nunca desligar a verificação.
export function construirSsl(): { ca: string; rejectUnauthorized: true } {
  return { ca: SUPABASE_CA_PEM, rejectUnauthorized: true };
}

// O pg deixa a URL de conexao sobrescrever o objeto ssl: um ?sslmode=require anularia a CA.
// Remove so os parametros de ssl, sem reserializar o resto (evita mexer em senhas com caracteres especiais).
export function limparConexao(url: string): string {
  const i = url.indexOf('?');
  if (i < 0) return url;
  const manter = url
    .slice(i + 1)
    .split('&')
    .filter((p) => p !== '' && !/^(ssl[a-z]*|uselibpqcompat)=/i.test(p));
  return manter.length > 0 ? `${url.slice(0, i)}?${manter.join('&')}` : url.slice(0, i);
}

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.SUPABASE_DB_URL;
    if (!connectionString) throw new Error('SUPABASE_DB_URL não configurada');
    pool = new Pool({
      connectionString: limparConexao(connectionString),
      ssl: construirSsl(),
      options: '-c timezone=America/Sao_Paulo'
    });
    pool.on('error', (err) => {
      console.error('Unexpected error on idle Postgres client', err);
    });
  }
  return pool;
}
