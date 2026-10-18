import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { criarSessao, hashDoToken, revogarSessao, validarSessao, type Consulta } from './sessao';

// Banco falso em memória que imita as três funções SQL (guarda só o hash).
function bancoFalso() {
  const tabela = new Map<string, { expira: Date; revogada: boolean }>();
  const chamadas: unknown[][] = [];
  const consulta: Consulta = vi.fn(async (sql: string, params: unknown[]) => {
    chamadas.push(params);
    const hash = params[0] as string;
    if (sql.includes('sessao_criar')) {
      tabela.set(hash, { expira: params[1] as Date, revogada: false });
      return { rows: [{ id: 'x' }] };
    }
    if (sql.includes('sessao_valida')) {
      const s = tabela.get(hash);
      return { rows: [{ ok: !!s && !s.revogada && s.expira.getTime() > Date.now() }] };
    }
    if (sql.includes('sessao_revogar')) {
      const s = tabela.get(hash);
      if (s) s.revogada = true;
      return { rows: [] };
    }
    throw new Error('sql inesperado: ' + sql);
  });
  return { consulta, tabela, chamadas };
}

describe('sessão revogável', () => {
  it('token válido passa', async () => {
    const { consulta } = bancoFalso();
    const token = await criarSessao(consulta);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(await validarSessao(token, consulta)).toBe(true);
  });

  it('token adulterado, vazio ou fora do formato falha sem nem consultar o banco', async () => {
    const { consulta } = bancoFalso();
    const token = await criarSessao(consulta);
    vi.mocked(consulta).mockClear();
    const adulterado = token.slice(0, -1) + (token.at(-1) === 'a' ? 'b' : 'a');
    expect(await validarSessao(adulterado, consulta)).toBe(false);
    expect(await validarSessao('', consulta)).toBe(false);
    expect(await validarSessao('abc', consulta)).toBe(false);
    expect(await validarSessao(token + '00', consulta)).toBe(false);
    expect(consulta).toHaveBeenCalledTimes(1); // só o adulterado (formato certo) chegou ao banco
  });

  it('token expirado falha', async () => {
    const { consulta, tabela } = bancoFalso();
    const token = await criarSessao(consulta);
    tabela.get(hashDoToken(token))!.expira = new Date(Date.now() - 1000);
    expect(await validarSessao(token, consulta)).toBe(false);
  });

  it('logout invalida o token e o mesmo token é recusado depois', async () => {
    const { consulta } = bancoFalso();
    const token = await criarSessao(consulta);
    expect(await validarSessao(token, consulta)).toBe(true);
    await revogarSessao(token, consulta);
    expect(await validarSessao(token, consulta)).toBe(false);
  });

  it('o token bruto nunca é enviado ao banco, só o hash SHA-256', async () => {
    const { consulta, chamadas } = bancoFalso();
    const token = await criarSessao(consulta);
    await validarSessao(token, consulta);
    await revogarSessao(token, consulta);
    expect(hashDoToken(token)).toBe(createHash('sha256').update(token).digest('hex'));
    for (const params of chamadas) expect(params).not.toContain(token);
    expect(chamadas.every((p) => p[0] === hashDoToken(token))).toBe(true);
  });

  it('a sessão dura 12 horas', async () => {
    const { consulta, chamadas } = bancoFalso();
    await criarSessao(consulta);
    const expira = chamadas[0][1] as Date;
    const horas = (expira.getTime() - Date.now()) / 3_600_000;
    expect(horas).toBeGreaterThan(11.9);
    expect(horas).toBeLessThanOrEqual(12);
  });

  it('se o banco falhar, a validação nega o acesso (falha fechada)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const consulta: Consulta = vi.fn(async () => {
      throw new Error('banco fora do ar');
    });
    expect(await validarSessao('a'.repeat(64), consulta)).toBe(false);
  });
});
