import { getPool } from './db';
import type { SessionStore } from './session';

export const postgresSessionStore: SessionStore = {
  async create(hash, expiresAt) {
    await getPool().query('select painel.criar_sessao($1, $2)', [hash, expiresAt]);
  },

  async isValid(hash, now) {
    const { rows } = await getPool().query<{ valida: boolean }>(
      'select painel.sessao_valida($1, $2) as valida',
      [hash, now]
    );
    return rows[0]?.valida === true;
  },

  async revoke(hash, now) {
    await getPool().query('select painel.revogar_sessao($1, $2)', [hash, now]);
  }
};
