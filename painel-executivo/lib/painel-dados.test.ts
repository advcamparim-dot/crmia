import { describe, expect, it, vi } from 'vitest';
import type { Consulta } from './sessao';
import { ARRANJO_PADRAO } from './layout';
import { IDS_DO_CATALOGO } from './widgets';
import { carregarPainel, gravarArranjo, lerArranjo } from './painel-dados';

const periodo = { de: new Date('2026-10-19T03:00:00Z'), ate: new Date('2026-10-20T03:00:00Z') };

function consultaFalsa(falhar: string[] = []): { consulta: Consulta; chamadas: { sql: string; params: unknown[] }[] } {
  const chamadas: { sql: string; params: unknown[] }[] = [];
  const consulta: Consulta = vi.fn(async (sql: string, params: unknown[]) => {
    chamadas.push({ sql, params });
    if (falhar.some((f) => sql.includes(f))) throw new Error('banco fora do ar');
    if (sql.includes('faixa_numeros')) return { rows: [{ f: { leads_novos: 3, em_conversa: '5', sem_resposta: 1, followups: 2, consultas: 0, canal: 'open' } }] };
    if (sql.includes('fila_atencao')) return { rows: [{ tipo: 'lead_esperando', urgencia: 1, lead_nome: 'Fulano', telefone_fim: '1234', telefone: '+5511999990000', crm_lead_id: 'abc', desde: new Date('2026-10-19T12:00:00Z'), detalhe: 'x' }] };
    if (sql.includes('leads_por_etapa')) return { rows: [{ etapa: 'Novo', quantidade: '4' }, { etapa: 'Em conversa', quantidade: 2 }] };
    if (sql.includes('followups_periodo')) return { rows: [{ enviados: '7', respostas: 2, falhas: 0 }] };
    if (sql.includes('fontes_de_lead')) return { rows: [{ fonte: 'sem origem', quantidade: '3' }] };
    if (sql.includes('funil_periodo')) return { rows: [{ etapa: 'Novo', ordem: 1, entraram: '83', avancaram: 23, perderam: 0, agora: 60 }, { etapa: 'Em conversa', ordem: 2, entraram: 23, avancaram: 4, perderam: 3, agora: 16 }] };
    if (sql.includes('tempo_resposta')) return { rows: [{ media_segundos: 70, maior_espera_segundos: null }] };
    if (sql.includes('layout_ler')) return { rows: [{ layout: { versao: 1, itens: [{ id: 'fila', x: 0, y: 0, w: 12, h: 9 }] } }] };
    return { rows: [] };
  });
  return { consulta, chamadas };
}

describe('carregarPainel', () => {
  it('cada seção chama a função SQL certa com de e ate', async () => {
    const { consulta, chamadas } = consultaFalsa();
    const r = await carregarPainel(periodo, consulta);
    for (const nome of ['faixa_numeros', 'followups_periodo', 'fontes_de_lead', 'tempo_resposta', 'funil_periodo']) {
      const c = chamadas.find((x) => x.sql.includes(nome))!;
      expect(c.params).toEqual([periodo.de, periodo.ate]);
    }
    expect(chamadas.find((x) => x.sql.includes('fila_atencao'))!.params).toEqual([]);
    expect(chamadas.find((x) => x.sql.includes('leads_por_etapa'))!.params).toEqual([]);
    expect(r.numeros).toEqual({ estado: 'ok', dados: { leads_novos: 3, em_conversa: 5, sem_resposta: 1, followups: 2, consultas: 0, canal: 'open' } });
    expect(r.etapas).toEqual({ estado: 'ok', dados: [{ etapa: 'Novo', quantidade: 4 }, { etapa: 'Em conversa', quantidade: 2 }] });
    expect(r.followups).toEqual({ estado: 'ok', dados: { enviados: 7, respostas: 2, falhas: 0 } });
    expect(r.fontes).toEqual({ estado: 'ok', dados: [{ fonte: 'sem origem', quantidade: 3 }] });
    expect(r.tempo).toEqual({ estado: 'ok', dados: { media_segundos: 70, maior_espera_segundos: null } });
    expect(r.funil).toEqual({ estado: 'ok', dados: [{ etapa: 'Novo', entraram: 83, avancaram: 23, perderam: 0, agora: 60 }, { etapa: 'Em conversa', entraram: 23, avancaram: 4, perderam: 3, agora: 16 }] });
    expect(r.fila.estado === 'ok' && r.fila.dados[0]).toMatchObject({ tipo: 'lead_esperando', telefone_fim: '1234', crm_lead_id: 'abc' });
  });

  it('uma seção que falha vira indisponível e as outras continuam ok', async () => {
    const { consulta } = consultaFalsa(['fila_atencao']);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await carregarPainel(periodo, consulta);
    expect(r.fila).toEqual({ estado: 'indisponivel' });
    for (const k of ['numeros', 'etapas', 'followups', 'fontes', 'tempo', 'funil'] as const) expect(r[k].estado).toBe('ok');
  });

  it('todas as seções falhando nunca viram zero', async () => {
    const consulta: Consulta = async () => { throw new Error('fora do ar'); };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await carregarPainel(periodo, consulta);
    expect(Object.values(r).every((c) => c.estado === 'indisponivel')).toBe(true);
  });

  it('resposta vazia da faixa de números é indisponível, não zero', async () => {
    const consulta: Consulta = async () => ({ rows: [] });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await carregarPainel(periodo, consulta);
    expect(r.numeros).toEqual({ estado: 'indisponivel' });
  });
});

describe('lerArranjo', () => {
  it('devolve o arranjo salvo, normalizado com os quadros que faltam', async () => {
    const { consulta } = consultaFalsa();
    const a = await lerArranjo(consulta);
    expect(a.itens[0]).toMatchObject({ id: 'fila', w: 12 });
    expect(a.itens.length).toBeGreaterThan(1);
  });

  it('banco fora do ar devolve o arranjo padrão', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const a = await lerArranjo(async () => { throw new Error('fora do ar'); });
    expect(a).toEqual(ARRANJO_PADRAO);
  });

  it('nunca salvo (nulo) devolve o padrão', async () => {
    const a = await lerArranjo(async () => ({ rows: [{ layout: null }] }));
    expect(a).toEqual(ARRANJO_PADRAO);
  });
});

describe('gravarArranjo', () => {
  it('normaliza antes de gravar e chama layout_salvar com o JSON', async () => {
    const { consulta, chamadas } = consultaFalsa();
    await gravarArranjo({ versao: 1, itens: [{ id: 'fila', x: 0, y: 0, w: 12, h: 9 }, { id: 'quadro-que-sumiu', x: 0, y: 9, w: 2, h: 2 }] }, consulta);
    const c = chamadas.find((x) => x.sql.includes('layout_salvar'))!;
    const salvo = JSON.parse(c.params[0] as string);
    expect(salvo.versao).toBe(1);
    expect(salvo.itens.map((i: { id: string }) => i.id)).not.toContain('quadro-que-sumiu');
    expect(salvo.itens.length).toBe(IDS_DO_CATALOGO.length);
  });

  it('erro do banco sobe para quem chamou (a ação trata)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(gravarArranjo(ARRANJO_PADRAO, async () => { throw new Error('recusado'); })).rejects.toThrow('recusado');
  });
});
