import { afterEach, describe, expect, it, vi } from 'vitest';

const requireSession = vi.fn();
vi.mock('@/lib/session', () => ({ requireSession: () => requireSession() }));
const gravarMeta = vi.fn();
const gravarPagamento = vi.fn();
const desfazerPagamento = vi.fn();
vi.mock('@/lib/painel-dados', () => ({ gravarArranjo: vi.fn(), gravarMeta: (...a: unknown[]) => gravarMeta(...a), gravarPagamento: (...a: unknown[]) => gravarPagamento(...a), desfazerPagamento: (...a: unknown[]) => desfazerPagamento(...a) }));
const revalidatePath = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath: (p: string) => revalidatePath(p) }));

import { definirMetaAction, desfazerPagaAction, marcarPagaAction } from './actions';

const form = (campos: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(campos)) f.set(k, v); return f; };

afterEach(() => vi.clearAllMocks());

describe('ações de pagamento de parcela', () => {
  it('exigem sessão: sem sessão a ação falha e o banco não é tocado', async () => {
    requireSession.mockRejectedValue(new Error('sem sessao'));
    await expect(marcarPagaAction(form({ id: '7', data: '2026-10-20' }))).rejects.toThrow('sem sessao');
    await expect(desfazerPagaAction(form({ id: '7' }))).rejects.toThrow('sem sessao');
    expect(gravarPagamento).not.toHaveBeenCalled();
    expect(desfazerPagamento).not.toHaveBeenCalled();
  });

  it('com sessão, marcam como paga e atualizam a tela', async () => {
    requireSession.mockResolvedValue(undefined);
    await marcarPagaAction(form({ id: '7', data: '2026-10-20' }));
    expect(gravarPagamento).toHaveBeenCalledWith(7, '2026-10-20');
    expect(revalidatePath).toHaveBeenCalledWith('/painel');
  });

  it('com sessão, desfazem e atualizam a tela', async () => {
    requireSession.mockResolvedValue(undefined);
    await desfazerPagaAction(form({ id: '7' }));
    expect(desfazerPagamento).toHaveBeenCalledWith(7);
    expect(revalidatePath).toHaveBeenCalledWith('/painel');
  });

  it('erro do banco ou dado inválido não derruba a página: registra e segue', async () => {
    requireSession.mockResolvedValue(undefined);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    gravarPagamento.mockRejectedValue(new Error('data invalida'));
    await expect(marcarPagaAction(form({ id: '7', data: '2099-01-01' }))).resolves.toBeUndefined();
    await expect(marcarPagaAction(form({ id: 'abc', data: '2026-10-20' }))).resolves.toBeUndefined();
    expect(revalidatePath).toHaveBeenCalled();
  });
});

describe('ação de definir meta', () => {
  it('exige sessão', async () => {
    requireSession.mockRejectedValue(new Error('sem sessao'));
    await expect(definirMetaAction(form({ tipo: 'consultas', valor: '10' }))).rejects.toThrow('sem sessao');
    expect(gravarMeta).not.toHaveBeenCalled();
  });

  it('com sessão, lê o valor em reais, grava e atualiza a tela', async () => {
    requireSession.mockResolvedValue(undefined);
    await definirMetaAction(form({ tipo: 'receita', valor: 'R$ 50.000,50' }));
    expect(gravarMeta).toHaveBeenCalledWith('receita', 50000.5);
    expect(revalidatePath).toHaveBeenCalledWith('/painel');
  });

  it('valor ilegível não chega ao banco e não derruba a página', async () => {
    requireSession.mockResolvedValue(undefined);
    await expect(definirMetaAction(form({ tipo: 'consultas', valor: 'dez' }))).resolves.toBeUndefined();
    expect(gravarMeta).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalled();
  });
});
