import { afterEach, describe, expect, it, vi } from 'vitest';
import { carregar, texto } from './carregado';

afterEach(() => vi.restoreAllMocks());

describe('carregar', () => {
  it('devolve ok com os dados', async () => {
    const r = await carregar('resumo', async () => ({ leads: 73 }));
    expect(r).toEqual({ estado: 'ok', dados: { leads: 73 } });
  });

  it('devolve indisponivel quando a função lança, sem relançar', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await carregar('financeiro', async () => {
      throw new Error('SELF_SIGNED_CERT_IN_CHAIN');
    });
    expect(r).toEqual({ estado: 'indisponivel' });
    expect(erro).toHaveBeenCalledOnce();
    expect(String(erro.mock.calls[0][0])).toContain('financeiro');
  });

  it('não vaza a mensagem do erro no resultado', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await carregar('x', async () => {
      throw new Error('senha=abc123');
    });
    expect(JSON.stringify(r)).not.toContain('abc123');
  });
});

describe('texto', () => {
  it('devolve "indisponível" para falha, nunca "0" nem "R$ 0,00"', () => {
    const t = texto({ estado: 'indisponivel' } as const, (n: number) => `R$ ${n},00`);
    expect(t).toBe('indisponível');
    expect(t).not.toMatch(/^0$|R\$ 0,00/);
  });

  it('aplica o formatador quando ok, inclusive para o zero legítimo', () => {
    expect(texto({ estado: 'ok', dados: 0 } as const, (n: number) => String(n))).toBe('0');
    expect(texto({ estado: 'ok', dados: 73 } as const, (n: number) => String(n))).toBe('73');
  });
});
