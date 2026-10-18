import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/session', () => ({ requireSession: async () => {} }));
vi.mock('@/app/login/actions', () => ({ logout: async () => {} }));
vi.mock('@/lib/metrics', () => ({
  getResumo: vi.fn(),
  getComercial: vi.fn(),
  getFunil: vi.fn(),
  getFinanceiro: vi.fn(),
  getJuridico: vi.fn(),
  getAlertas: vi.fn(),
  getLastSyncedAt: vi.fn()
}));

import * as metrics from '@/lib/metrics';
import Pagina from './page';

const m = vi.mocked(metrics);

function dadosOk() {
  m.getResumo.mockResolvedValue({ receitaContratada: 0, receitaRecebida: 0, leadsNovos: 73, contratosAssinados: 0, taxaConversao: 0 });
  m.getComercial.mockResolvedValue({ leadsQualificados: 0, consultasMarcadas: 0, consultasRealizadas: 0, propostasEnviadas: 0, ticketMedio: 0 });
  m.getFunil.mockResolvedValue([{ estagio: 'Leads', quantidade: 73 }]);
  m.getFinanceiro.mockResolvedValue({ valorAReceber: 0, pagamentosAtrasados: 0, taxaInadimplencia: 0, totalVencido: 0 });
  m.getJuridico.mockResolvedValue({ clientesAtivos: 0, casosAtivos: 0, prazosCriticos: 0, casosAltoRisco: 0 });
  m.getAlertas.mockResolvedValue([]);
  m.getLastSyncedAt.mockResolvedValue(new Date());
}

async function html(): Promise<string> {
  return renderToStaticMarkup(await Pagina({ searchParams: {} }));
}

afterEach(() => vi.clearAllMocks());

describe('Painel Executivo: falha por quadro', () => {
  it('quando o resumo falha, só ele mostra "indisponível" e o resto continua real', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    dadosOk();
    m.getResumo.mockRejectedValue(new Error('SELF_SIGNED_CERT_IN_CHAIN'));
    const saida = await html();
    const resumo = saida.slice(saida.indexOf('id="resumo"'), saida.indexOf('id="comercial"'));
    expect(resumo.match(/indisponível/g)?.length).toBe(5);
    expect(resumo).not.toContain('R$');
    expect(saida).toContain('73'); // o funil segue mostrando o dado real
    expect(saida).not.toContain('nunca');
  });

  it('quando tudo falha, nenhum número aparece: só "indisponível"', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const fn of Object.values(m)) (fn as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('falha'));
    const saida = await html();
    expect(saida).not.toMatch(/R\$\s?0,00/);
    expect(saida).not.toMatch(/>0%</);
    expect(saida).not.toContain('Última sincronização: nunca');
    expect(saida).toContain('indisponível');
    expect(saida).not.toContain('Nenhum alerta no momento');
  });

  it('com dados reais zerados (legítimo) mostra o zero, e a sincronização vazia mostra "nunca"', async () => {
    dadosOk();
    m.getLastSyncedAt.mockResolvedValue(null);
    const saida = await html();
    expect(saida).toMatch(/R\$\s?0,00/);
    expect(saida).toContain('Nenhum alerta no momento');
    expect(saida).toContain('nunca');
    expect(saida).not.toContain('indisponível');
  });
});
