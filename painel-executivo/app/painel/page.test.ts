import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ARRANJO_PADRAO } from '@/lib/layout';

vi.mock('@/lib/session', () => ({ requireSession: async () => {} }));
vi.mock('@/app/login/actions', () => ({ logout: async () => {} }));
vi.mock('./actions', () => ({ salvarArranjo: async () => ({ ok: true }) }));
// A grade de verdade e do navegador; aqui so interessa o conteudo de cada quadro, na ordem do arranjo.
vi.mock('./Grade', () => ({
  default: ({ arranjo, quadros }: { arranjo: { itens: { id: string }[] }; quadros: Record<string, ReactNode> }) =>
    createElement('div', null, arranjo.itens.map((i) => createElement('section', { key: i.id, 'data-quadro': i.id }, quadros[i.id])))
}));
vi.mock('@/lib/painel-dados', () => ({ carregarPainel: vi.fn(), lerArranjo: vi.fn() }));

import * as dados from '@/lib/painel-dados';
import Pagina from './page';

const d = vi.mocked(dados);
const ok = <T,>(dados: T) => ({ estado: 'ok' as const, dados });
const fora = { estado: 'indisponivel' as const };

function painelOk() {
  d.lerArranjo.mockResolvedValue(ARRANJO_PADRAO);
  d.carregarPainel.mockResolvedValue({
    numeros: ok({ leads_novos: 13, em_conversa: 8, sem_resposta: 2, followups: 5, consultas: 1, canal: 'open' }),
    fila: ok([
      { tipo: 'lead_esperando', urgencia: 1, lead_nome: 'Maria Teste', telefone_fim: '4321', telefone: '+5511999994321', crm_lead_id: 'abc123', desde: new Date(Date.now() - 3 * 3600_000), detalhe: 'Aguardando resposta da equipe' },
      { tipo: 'canal', urgencia: 7, lead_nome: null, telefone_fim: null, telefone: null, crm_lead_id: null, desde: new Date(Date.now() - 600_000), detalhe: 'WhatsApp desconectado' },
    ]),
    etapas: ok([{ etapa: 'Novo', quantidade: 9 }, { etapa: 'Em conversa', quantidade: 8 }]),
    followups: ok({ enviados: 34, respostas: 3, falhas: 0 }),
    fontes: ok([{ fonte: 'sem origem', quantidade: 61 }]),
    tempo: ok({ media_segundos: 70, maior_espera_segundos: 7200 }),
  });
}

async function html(params: { periodo?: string; de?: string; ate?: string } = {}): Promise<string> {
  return renderToStaticMarkup(await Pagina({ searchParams: params }));
}

afterEach(() => vi.clearAllMocks());

describe('Painel inicial /painel', () => {
  it('um quadro que falha mostra "indisponível" e os demais mostram dados', async () => {
    painelOk();
    d.carregarPainel.mockResolvedValue({ ...(await d.carregarPainel({ de: new Date(), ate: new Date() })), fontes: fora });
    const h = await html();
    expect(h).toMatch(/data-quadro="fontes"[^>]*>(?:(?!<\/section>)[\s\S])*indisponível/);
    expect(h).toContain('13');
    expect(h).toContain('Maria Teste');
    expect(h).toContain('34');
  });

  it('nenhum zero aparece quando todas as consultas falham', async () => {
    d.lerArranjo.mockResolvedValue(ARRANJO_PADRAO);
    d.carregarPainel.mockResolvedValue({ numeros: fora, fila: fora, etapas: fora, followups: fora, fontes: fora, tempo: fora });
    const h = await html();
    expect(h).toContain('indisponível');
    const soTexto = h.replace(/<[^>]*>/g, ' ');
    expect(soTexto).not.toMatch(/(^|\s)0(\s|$)/);
    expect(soTexto).not.toContain('Nada pendente');
  });

  it('a fila mostra o tipo, o nome, a espera e os botões Abrir no WhatsApp e Abrir no CRM', async () => {
    painelOk();
    const h = await html();
    expect(h).toContain('Lead esperando');
    expect(h).toContain('Maria Teste');
    expect(h).toContain('final 4321');
    expect(h).toMatch(/há 3 h/);
    expect(h).toContain('Abrir no WhatsApp');
    expect(h).toContain('href="https://wa.me/5511999994321"');
    expect(h).toContain('Abrir no CRM');
    expect(h).toMatch(/href="https:\/\/[^"]*\/#Lead\/view\/abc123"/);
    expect(h).toContain('WhatsApp desconectado');
  });

  it('fila vazia diz que não há nada pendente (só quando a leitura deu certo)', async () => {
    painelOk();
    const base = await d.carregarPainel({ de: new Date(), ate: new Date() });
    d.carregarPainel.mockResolvedValue({ ...base, fila: ok([]) });
    expect(await html()).toContain('Nada pendente');
  });

  it('a barra de períodos marca o período ativo', async () => {
    painelOk();
    const h = await html({ periodo: 'ontem' });
    expect(h).toMatch(/class="[^"]*active[^"]*"[^>]*>Ontem</);
    expect(h).not.toMatch(/class="[^"]*active[^"]*"[^>]*>Hoje</);
    for (const rotulo of ['Hoje', 'Ontem', 'Semana', 'Mês', 'Período']) expect(h).toContain(rotulo);
  });

  it('período desconhecido cai em Semana e o período livre usa as datas da URL', async () => {
    painelOk();
    expect(await html({ periodo: 'xyz' })).toMatch(/class="[^"]*active[^"]*"[^>]*>Semana</);
    await html({ periodo: 'livre', de: '2026-10-01', ate: '2026-10-05' });
    const [periodo] = d.carregarPainel.mock.calls[1];
    expect(periodo.de.toISOString()).toBe('2026-10-01T03:00:00.000Z');
    expect(periodo.ate.toISOString()).toBe('2026-10-06T03:00:00.000Z');
  });

  it('não há texto de conversa na página', async () => {
    painelOk();
    const h = await html();
    expect(h).not.toMatch(/mensagem enviada por uma pessoa|nota do sistema/i);
    // a fila usa so os campos de identificacao e o detalhe fixo da funcao
    expect(d.carregarPainel).toHaveBeenCalledTimes(1);
  });

  it('formata o tempo de resposta e a maior espera', async () => {
    painelOk();
    const h = await html();
    expect(h).toContain('1 min 10 s');
    expect(h).toContain('2 h');
  });

  it('o quadro do WhatsApp mostra o estado do canal', async () => {
    painelOk();
    const h = await html();
    expect(h).toMatch(/data-quadro="kpi-canal"[^>]*>(?:(?!<\/section>)[\s\S])*Conectado/);
  });
});
