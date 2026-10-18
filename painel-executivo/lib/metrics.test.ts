import { beforeEach, describe, expect, it, vi } from 'vitest';

const query = vi.fn();

vi.mock('./db', () => ({
  getPool: () => ({ query })
}));

import { getProducaoNoPeriodo } from './metrics';

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
