import { createHash, randomBytes } from 'node:crypto';
import { getPool } from './db';

// Sessão revogável: o token bruto só existe no cookie; o banco guarda apenas o hash SHA-256.
export type Consulta = (sql: string, params: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

export const DURACAO_SESSAO_MS = 12 * 60 * 60 * 1000;

const FORMATO_TOKEN = /^[0-9a-f]{64}$/;

const consultaPadrao: Consulta = (sql, params) => getPool().query(sql, params as unknown[]);

export function hashDoToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function criarSessao(consulta: Consulta = consultaPadrao): Promise<string> {
  const token = randomBytes(32).toString('hex');
  const expira = new Date(Date.now() + DURACAO_SESSAO_MS);
  await consulta('select painel.sessao_criar($1, $2) as id', [hashDoToken(token), expira]);
  return token;
}

export async function validarSessao(token: string, consulta: Consulta = consultaPadrao): Promise<boolean> {
  if (!FORMATO_TOKEN.test(token ?? '')) return false;
  try {
    const { rows } = await consulta('select painel.sessao_valida($1) as ok', [hashDoToken(token)]);
    return rows[0]?.ok === true;
  } catch (erro) {
    console.error('Falha ao validar a sessão; acesso negado', erro);
    return false;
  }
}

export async function revogarSessao(token: string, consulta: Consulta = consultaPadrao): Promise<void> {
  if (!FORMATO_TOKEN.test(token ?? '')) return;
  await consulta('select painel.sessao_revogar($1)', [hashDoToken(token)]);
}
