import { describe, expect, it, vi } from 'vitest';
import type { Consulta } from './sessao';
import { ARRANJO_PADRAO } from './layout';
import { IDS_DO_CATALOGO } from './widgets';
import { carregarPainel, desfazerPagamento, gravarArranjo, gravarMeta, gravarPagamento, lerArranjo, lerLeadsDaEtapa, ETAPAS } from './painel-dados';

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
    if (sql.includes('contratos_numeros')) return { rows: [{ fechados: '2', receita_contratada: '48400.00', receita_recebida: '6600.00', a_receber: '30000.5', atrasado: '1600' }] };
    if (sql.includes('parcelas_abertas')) return { rows: [{ id: '7', contrato_id: '3', lead_nome: 'Fulano', telefone_fim: '6001', numero: 1, valor: '1600.00', vencimento: '2026-11-20', pago_em: null, status: 'a_receber', dias_atraso: 0 }] };
    if (sql.includes('metas_mes')) return { rows: [{ tipo: 'consultas', meta: '10', atual: '2', percentual: '20.0', projecao: '6.20', dias_restantes: 9, dias_no_mes: 31 }, { tipo: 'receita', meta: '50000.00', atual: '10000.00', percentual: '20.0', projecao: '31000', dias_restantes: 9, dias_no_mes: 31 }] };
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
    for (const nome of ['faixa_numeros', 'followups_periodo', 'fontes_de_lead', 'tempo_resposta', 'funil_periodo', 'contratos_numeros']) {
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
    expect(r.contratos).toEqual({ estado: 'ok', dados: { fechados: 2, receita_contratada: 48400, receita_recebida: 6600, a_receber: 30000.5, atrasado: 1600 } });
    expect(r.parcelas).toEqual({ estado: 'ok', dados: [{ id: 7, contrato_id: 3, lead_nome: 'Fulano', telefone_fim: '6001', numero: 1, valor: 1600, vencimento: '2026-11-20', pago_em: null, status: 'a_receber', dias_atraso: 0 }] });
    expect(r.metas).toEqual({ estado: 'ok', dados: [
      { tipo: 'consultas', meta: 10, atual: 2, percentual: 20, projecao: 6.2, dias_restantes: 9, dias_no_mes: 31 },
      { tipo: 'receita', meta: 50000, atual: 10000, percentual: 20, projecao: 31000, dias_restantes: 9, dias_no_mes: 31 },
    ] });
    expect(r.funil).toEqual({ estado: 'ok', dados: [{ etapa: 'Novo', entraram: 83, avancaram: 23, perderam: 0, agora: 60 }, { etapa: 'Em conversa', entraram: 23, avancaram: 4, perderam: 3, agora: 16 }] });
    expect(r.fila.estado === 'ok' && r.fila.dados[0]).toMatchObject({ tipo: 'lead_esperando', telefone_fim: '1234', crm_lead_id: 'abc' });
  });

  it('uma seção que falha vira indisponível e as outras continuam ok', async () => {
    const { consulta } = consultaFalsa(['fila_atencao']);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await carregarPainel(periodo, consulta);
    expect(r.fila).toEqual({ estado: 'indisponivel' });
    for (const k of ['numeros', 'etapas', 'followups', 'fontes', 'tempo', 'funil', 'contratos', 'parcelas', 'metas'] as const) expect(r[k].estado).toBe('ok');
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

describe('pagamento de parcela (única escrita de dinheiro do painel)', () => {
  it('marca a parcela como paga na data informada', async () => {
    const { consulta, chamadas } = consultaFalsa();
    await gravarPagamento(7, '2026-10-20', consulta, new Date('2026-10-22T15:00:00Z'));
    const c = chamadas.find((x) => x.sql.includes('parcela_marcar_paga'))!;
    expect(c.params).toEqual([7, '2026-10-20', 'painel']);
  });

  it('recusa id inválido, data inválida e data futura sem tocar no banco', async () => {
    const { consulta, chamadas } = consultaFalsa();
    const agora = new Date('2026-10-22T15:00:00Z');
    for (const [id, data] of [[0, '2026-10-20'], [-3, '2026-10-20'], [1.5, '2026-10-20'], [NaN, '2026-10-20'], [7, '20/10/2026'], [7, '2026-02-30'], [7, ''], [7, '2026-10-23']] as [number, string][]) {
      await expect(gravarPagamento(id, data, consulta, agora)).rejects.toThrow();
    }
    expect(chamadas.length).toBe(0);
  });

  it('aceita pagar hoje (fuso de São Paulo, mesmo com UTC já no dia seguinte)', async () => {
    const { consulta, chamadas } = consultaFalsa();
    await gravarPagamento(7, '2026-10-22', consulta, new Date('2026-10-23T01:30:00Z')); // 22:30 em São Paulo
    expect(chamadas.length).toBe(1);
  });

  it('desfazer chama a função certa e valida o id', async () => {
    const { consulta, chamadas } = consultaFalsa();
    await desfazerPagamento(7, consulta);
    expect(chamadas[0].sql).toContain('parcela_desfazer');
    expect(chamadas[0].params).toEqual([7, 'painel']);
    await expect(desfazerPagamento(0, consulta)).rejects.toThrow();
    expect(chamadas.length).toBe(1);
  });
});

describe('definir meta do mês (escrita do painel)', () => {
  it('chama painel.meta_definir com tipo, valor e quem', async () => {
    const { consulta, chamadas } = consultaFalsa();
    await gravarMeta('consultas', 12, consulta);
    const c = chamadas.find((x) => x.sql.includes('meta_definir'))!;
    expect(c.params).toEqual(['consultas', 12, 'painel']);
    await gravarMeta('receita', 50000.5, consulta);
    expect(chamadas[1].params).toEqual(['receita', 50000.5, 'painel']);
  });

  it('aceita 0 (remove a meta) e recusa tipo, valor e limites inválidos sem tocar no banco', async () => {
    const { consulta, chamadas } = consultaFalsa();
    await gravarMeta('contratos', 0, consulta);
    expect(chamadas.length).toBe(1);
    for (const [tipo, valor] of [['abobrinha', 5], ['consultas', -1], ['consultas', 2.5], ['consultas', 10001], ['receita', 100000001], ['consultas', NaN], ['consultas', Infinity]] as [string, number][]) {
      await expect(gravarMeta(tipo, valor, consulta)).rejects.toThrow();
    }
    expect(chamadas.length).toBe(1);
  });
});

describe('lerLeadsDaEtapa', () => {
  it('etapa fora da lista nem chega ao banco', async () => {
    const consulta = vi.fn();
    expect(await lerLeadsDaEtapa('Qualquer coisa', consulta)).toEqual({ estado: 'indisponivel' });
    expect(consulta).not.toHaveBeenCalled();
  });
  it('consulta a funcao do banco com a etapa como parametro', async () => {
    const consulta = vi.fn().mockResolvedValue({ rows: [{ lead_nome: 'Ana', telefone_fim: '1234', telefone: '5516999991234', crm_lead_id: 'x1' }] });
    const r = await lerLeadsDaEtapa('Proposta enviada', consulta);
    expect(consulta).toHaveBeenCalledWith('select * from painel.leads_da_etapa($1)', ['Proposta enviada']);
    expect(r).toEqual({ estado: 'ok', dados: [{ lead_nome: 'Ana', telefone_fim: '1234', telefone: '5516999991234', crm_lead_id: 'x1' }] });
  });
  it('falha do banco vira indisponivel, nao lista vazia', async () => {
    const consulta = vi.fn().mockRejectedValue(new Error('x'));
    expect(await lerLeadsDaEtapa('Novo', consulta)).toEqual({ estado: 'indisponivel' });
  });
  it('as sete etapas do funil', () => { expect(ETAPAS).toHaveLength(7); });
});
