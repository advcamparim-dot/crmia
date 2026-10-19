import { beforeEach, describe, expect, it, vi } from 'vitest';

const query = vi.fn();

vi.mock('./db', () => ({
  getPool: () => ({ query })
}));

import { getProducaoNoPeriodo, getResumo } from './metrics';

describe('getProducaoNoPeriodo', () => {
  beforeEach(() => query.mockReset());

  it('mantém contrato do período mesmo quando o lead nasceu antes, sem chamá-lo de conversão', async () => {
    query.mockResolvedValueOnce({
      rows: [{ leads: '0', qualificados: '0', consultas: '1', propostas: '2', contratos: '3' }]
    });

    await expect(getProducaoNoPeriodo({ from: new Date('2026-10-01'), to: new Date('2026-10-31') })).resolves.toEqual([
      { estagio: 'Leads novos', quantidade: 0 },
      { estagio: 'Leads qualificados', quantidade: 0 },
      { estagio: 'Consultas realizadas', quantidade: 1 },
      { estagio: 'Propostas enviadas', quantidade: 2 },
      { estagio: 'Contratos assinados', quantidade: 3 }
    ]);
  });
});

describe('getResumo', () => {
  beforeEach(() => query.mockReset());

  it('não inventa taxa de conversão entre coortes diferentes', async () => {
    query.mockResolvedValueOnce({
      rows: [{ receita_contratada: '300', receita_recebida: '0', leads_novos: '0', contratos_assinados: '3' }]
    });

    await expect(getResumo({ from: new Date('2026-10-01'), to: new Date('2026-10-31') })).resolves.toEqual({
      receitaContratada: 300,
      receitaRecebida: 0,
      leadsNovos: 0,
      contratosAssinados: 3
    });
  });
});
