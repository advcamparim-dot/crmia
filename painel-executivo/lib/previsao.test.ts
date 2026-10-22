import { describe, expect, it } from 'vitest';
import { resumirPrevisao, type LinhaPrevisao } from './previsao';

const linha = (etapa: string, leads: number, chance: number, prazo_dias: number): LinhaPrevisao =>
  ({ etapa, leads, chance, prazo_dias, esperados: Math.round(leads * chance * 100) / 100, ticket_medio: 8000, ticket_origem: 'definido' });

describe('resumirPrevisao', () => {
  const linhas = [linha('Novo', 50, 0.02, 60), linha('Em conversa', 10, 0.1, 40), linha('Proposta enviada', 7, 0.3, 20)];
  const r = resumirPrevisao(linhas);

  it('conta os leads ativos', () => expect(r.ativos).toBe(67));
  it('acumula por horizonte: cada etapa entra no horizonte do seu prazo e nos seguintes', () => {
    expect(r.horizontes.map((h) => h.dias)).toEqual([20, 40, 60]);
    expect(r.horizontes[0].contratos).toBeCloseTo(2.1);
    expect(r.horizontes[1].contratos).toBeCloseTo(3.1);
    expect(r.horizontes[2].contratos).toBeCloseTo(4.1);
  });
  it('receita = contratos x valor medio', () => {
    expect(r.horizontes[0].receita).toBeCloseTo(2.1 * 8000);
    expect(r.horizontes[2].receita).toBeCloseTo(4.1 * 8000);
  });
  it('guarda a origem do valor medio', () => expect(r.origem).toBe('definido'));
  it('sem linhas, tudo zero', () => {
    const v = resumirPrevisao([]);
    expect(v.ativos).toBe(0);
    expect(v.horizontes.every((h) => h.contratos === 0 && h.receita === 0)).toBe(true);
  });
});
