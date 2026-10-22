import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ARRANJO_PADRAO } from '@/lib/layout';

vi.mock('@/lib/session', () => ({ requireSession: async () => {} }));
vi.mock('@/app/login/actions', () => ({ logout: async () => {} }));
vi.mock('./actions', () => ({ salvarArranjo: async () => ({ ok: true }), marcarPagaAction: async () => {}, desfazerPagaAction: async () => {}, definirMetaAction: async () => {} }));
// A grade de verdade e do navegador; aqui so interessa o conteudo de cada quadro, na ordem do arranjo.
vi.mock('./Grade', () => ({
  default: ({ arranjo, quadros, marca, periodos, sair }: { arranjo: { itens: { id: string }[] }; quadros: Record<string, ReactNode>; marca?: ReactNode; periodos?: ReactNode; sair?: ReactNode }) =>
    createElement('div', null, marca, periodos, sair, arranjo.itens.map((i) => createElement('section', { key: i.id, 'data-quadro': i.id }, quadros[i.id])))
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
    contratos: ok({ fechados: 2, receita_contratada: 48400, receita_recebida: 6600, a_receber: 30000.5, atrasado: 1600 }),
    parcelas: ok([
      { id: 7, contrato_id: 3, lead_nome: 'Cliente Atrasado', telefone_fim: '6001', numero: 1, valor: 1600, vencimento: '2026-10-10', pago_em: null, status: 'atrasada', dias_atraso: 12 },
      { id: 8, contrato_id: 3, lead_nome: 'Cliente Atrasado', telefone_fim: '6001', numero: 2, valor: 1600, vencimento: '2026-11-20', pago_em: null, status: 'a_receber', dias_atraso: 0 },
      { id: 9, contrato_id: 4, lead_nome: 'Cliente Pago', telefone_fim: '6002', numero: 0, valor: 5000, vencimento: '2026-10-20', pago_em: '2026-10-20', status: 'paga', dias_atraso: 0 },
    ]),
    metas: ok([
      { tipo: 'consultas', meta: 10, atual: 2, percentual: 20, projecao: 6.2, dias_restantes: 9, dias_no_mes: 31 },
      { tipo: 'receita', meta: 50000, atual: 10000, percentual: 20, projecao: 31000, dias_restantes: 9, dias_no_mes: 31 },
    ]),
    funil: ok([
      { etapa: 'Novo', entraram: 83, avancaram: 23, perderam: 0, agora: 60 },
      { etapa: 'Em conversa', entraram: 23, avancaram: 4, perderam: 3, agora: 16 },
      { etapa: 'Consulta', entraram: 0, avancaram: 0, perderam: 0, agora: 0 },
      { etapa: 'Com a equipe', entraram: 4, avancaram: 0, perderam: 0, agora: 4 },
      { etapa: 'Contrato', entraram: 0, avancaram: 0, perderam: 0, agora: 0 },
    ]),
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
    d.carregarPainel.mockResolvedValue({ numeros: fora, fila: fora, etapas: fora, followups: fora, fontes: fora, tempo: fora, funil: fora, contratos: fora, parcelas: fora, metas: fora });
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

  it('o quadro Análise do funil mostra as cinco etapas, o aviso do histórico e vira indisponível se falhar', async () => {
    painelOk();
    const h = await html();
    const quadro = h.match(/data-quadro="analise-funil"[^>]*>([\s\S]*?)<\/section>/)![1];
    for (const e of ['Novo', 'Em conversa', 'Consulta', 'Com a equipe', 'Contrato']) expect(quadro).toContain(e);
    expect(quadro).toContain('83');
    expect(quadro).toContain('desde 06/10/2026');
    const base = await d.carregarPainel({ de: new Date(), ate: new Date() });
    d.carregarPainel.mockResolvedValue({ ...base, funil: fora });
    const h2 = await html();
    expect(h2.match(/data-quadro="analise-funil"[^>]*>([\s\S]*?)<\/section>/)![1]).toContain('indisponível');
  });

  it('os quadros de contratos mostram contratos fechados e as receitas formatadas em reais', async () => {
    painelOk();
    const h = await html();
    const q = (id: string) => h.match(new RegExp('data-quadro="' + id + '"[^>]*>([\\s\\S]*?)</section>'))![1];
    expect(q('kpi-contratos')).toContain('2');
    expect(q('kpi-receita-contratada')).toContain('R$ 48.400,00');
    expect(q('kpi-receita-recebida')).toContain('R$ 6.600,00');
  });

  it('a lista de parcelas mostra status, vencimento e os botões certos, e o resumo de a receber e atrasado', async () => {
    painelOk();
    const h = await html();
    const q = h.match(/data-quadro="parcelas"[^>]*>([\s\S]*?)<\/section>/)![1];
    expect(q).toContain('Cliente Atrasado');
    expect(q).toContain('atrasada há 12 dias');
    expect(q).toContain('20/11/2026');
    expect(q).toContain('R$ 1.600,00');
    expect(q).toContain('Marcar como paga');
    expect(q).toContain('Desfazer');
    expect(q).toContain('A receber R$ 30.000,50');
    expect(q).toContain('Atrasado R$ 1.600,00');
    expect(q.match(/Marcar como paga/g)!.length).toBe(2); // so as 2 nao pagas
    expect(q.match(/Desfazer/g)!.length).toBe(1); // so a paga
  });

  it('contratos e parcelas indisponíveis mostram "indisponível" e nunca R$ 0,00', async () => {
    painelOk();
    const base = await d.carregarPainel({ de: new Date(), ate: new Date() });
    d.carregarPainel.mockResolvedValue({ ...base, contratos: fora, parcelas: fora });
    const h = await html();
    for (const id of ['kpi-contratos', 'kpi-receita-contratada', 'kpi-receita-recebida', 'parcelas']) {
      expect(h.match(new RegExp('data-quadro="' + id + '"[^>]*>([\\s\\S]*?)</section>'))![1]).toContain('indisponível');
    }
    expect(h).not.toContain('R$ 0,00');
  });

  it('o quadro de metas mostra o avanço, os dias restantes e o formulário para definir', async () => {
    painelOk();
    const h = await html();
    const q = h.match(/data-quadro="metas"[^>]*>([\s\S]*?)<\/section>/)![1];
    expect(q).toContain('Consultas marcadas');
    expect(q).toContain('2 de 10');
    expect(q).toContain('20%');
    expect(q).toContain('Contratos');
    expect(q).toContain('Receita');
    expect(q).toContain('2 de 10 · 20% da meta');
    expect(q).toContain('Faltam 9 dias');
    expect(q).toContain('Salvar meta');
    expect(q).toContain('name="valor"');
  });

  it('sem metas definidas o quadro convida a definir (e não mostra 0%)', async () => {
    painelOk();
    const base = await d.carregarPainel({ de: new Date(), ate: new Date() });
    d.carregarPainel.mockResolvedValue({ ...base, metas: ok([]) });
    const q = (await html()).match(/data-quadro="metas"[^>]*>([\s\S]*?)<\/section>/)![1];
    expect(q).toContain('Sem meta de consultas');
    expect(q).toContain('Salvar meta');
    expect(q).not.toContain('0%');
  });

  it('meta indisponível mostra "indisponível" e não um velocímetro zerado', async () => {
    painelOk();
    const base = await d.carregarPainel({ de: new Date(), ate: new Date() });
    d.carregarPainel.mockResolvedValue({ ...base, metas: fora });
    const q = (await html()).match(/data-quadro="metas"[^>]*>([\s\S]*?)<\/section>/)![1];
    expect(q).toContain('indisponível');
    expect(q).not.toContain('%');
  });

  it('as etapas levam à lista dos leads da etapa', async () => {
    painelOk();
    const h = await html();
    expect(h).toContain('href="/painel/etapa/Novo"');
    expect(h).toContain('href="/painel/etapa/Em%20conversa"');
  });
});
