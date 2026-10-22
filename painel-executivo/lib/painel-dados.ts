import { getPool } from './db';
import { carregar, type Carregado } from './carregado';
import { ARRANJO_PADRAO, normalizarArranjo, type Arranjo } from './layout';
import type { Consulta } from './sessao';

export type FaixaNumeros = { leads_novos: number; em_conversa: number; sem_resposta: number; followups: number; consultas: number; canal: string };
export type ItemFila = {
  tipo: string; urgencia: number; lead_nome: string | null; telefone_fim: string | null;
  telefone: string | null; crm_lead_id: string | null; desde: Date; detalhe: string;
};
export type EtapaLead = { etapa: string; quantidade: number };
export type FollowupsPeriodo = { enviados: number; respostas: number; falhas: number };
export type FonteLead = { fonte: string; quantidade: number };
export type TempoResposta = { media_segundos: number | null; maior_espera_segundos: number | null };

export type FunilEtapa = { etapa: string; entraram: number; avancaram: number; perderam: number; agora: number };

export type Periodo = { de: Date; ate: Date };
export type DadosDoPainel = {
  numeros: Carregado<FaixaNumeros>;
  fila: Carregado<ItemFila[]>;
  etapas: Carregado<EtapaLead[]>;
  followups: Carregado<FollowupsPeriodo>;
  fontes: Carregado<FonteLead[]>;
  tempo: Carregado<TempoResposta>;
  funil: Carregado<FunilEtapa[]>;
};

const consultaPadrao: Consulta = (sql, params) => getPool().query(sql, params as unknown[]);

// pg devolve bigint como texto; os numeros do painel sao pequenos, entao viram number.
const n = (v: unknown): number => Number(v ?? 0);
const nOuNulo = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export async function carregarPainel(periodo: Periodo, consulta: Consulta = consultaPadrao): Promise<DadosDoPainel> {
  const janela = [periodo.de, periodo.ate];
  const [numeros, fila, etapas, followups, fontes, tempo, funil] = await Promise.all([
    carregar('faixa de numeros', async () => {
      const { rows } = await consulta('select painel.faixa_numeros($1, $2) as f', janela);
      const f = rows[0]?.f as Record<string, unknown> | undefined;
      if (!f) throw new Error('faixa_numeros sem resposta');
      return {
        leads_novos: n(f.leads_novos), em_conversa: n(f.em_conversa), sem_resposta: n(f.sem_resposta),
        followups: n(f.followups), consultas: n(f.consultas), canal: String(f.canal ?? ''),
      };
    }),
    carregar('fila', async () => {
      const { rows } = await consulta('select * from painel.fila_atencao()', []);
      return rows.map((r) => ({
        tipo: String(r.tipo), urgencia: n(r.urgencia), lead_nome: (r.lead_nome as string | null) ?? null,
        telefone_fim: (r.telefone_fim as string | null) ?? null, telefone: (r.telefone as string | null) ?? null,
        crm_lead_id: (r.crm_lead_id as string | null) ?? null, desde: new Date(r.desde as string | Date), detalhe: String(r.detalhe ?? ''),
      }));
    }),
    carregar('leads por etapa', async () => {
      const { rows } = await consulta('select * from painel.leads_por_etapa()', []);
      return rows.map((r) => ({ etapa: String(r.etapa), quantidade: n(r.quantidade) }));
    }),
    carregar('follow-ups do periodo', async () => {
      const { rows } = await consulta('select * from painel.followups_periodo($1, $2)', janela);
      const r = rows[0];
      if (!r) throw new Error('followups_periodo sem resposta');
      return { enviados: n(r.enviados), respostas: n(r.respostas), falhas: n(r.falhas) };
    }),
    carregar('fontes de lead', async () => {
      const { rows } = await consulta('select * from painel.fontes_de_lead($1, $2)', janela);
      return rows.map((r) => ({ fonte: String(r.fonte), quantidade: n(r.quantidade) }));
    }),
    carregar('tempo de resposta', async () => {
      const { rows } = await consulta('select * from painel.tempo_resposta($1, $2)', janela);
      const r = rows[0];
      if (!r) throw new Error('tempo_resposta sem resposta');
      return { media_segundos: nOuNulo(r.media_segundos), maior_espera_segundos: nOuNulo(r.maior_espera_segundos) };
    }),
    carregar('funil por etapa', async () => {
      const { rows } = await consulta('select * from painel.funil_periodo($1, $2)', janela);
      return rows.map((r) => ({ etapa: String(r.etapa), entraram: n(r.entraram), avancaram: n(r.avancaram), perderam: n(r.perderam), agora: n(r.agora) }));
    }),
  ]);
  return { numeros, fila, etapas, followups, fontes, tempo, funil };
}

// Falha de banco nao pode tirar a tela do ar: sem arranjo salvo ou sem banco, vale o padrao.
export async function lerArranjo(consulta: Consulta = consultaPadrao): Promise<Arranjo> {
  try {
    const { rows } = await consulta('select painel.layout_ler() as layout', []);
    return rows[0]?.layout == null ? ARRANJO_PADRAO : normalizarArranjo(rows[0].layout);
  } catch (erro) {
    console.error('Falha ao ler o arranjo dos quadros', erro);
    return ARRANJO_PADRAO;
  }
}

// Unica escrita do painel nesta etapa. O banco ainda valida a forma; aqui so se descarta o que nao e do catalogo.
export async function gravarArranjo(arranjo: unknown, consulta: Consulta = consultaPadrao): Promise<void> {
  const limpo = normalizarArranjo(arranjo);
  await consulta('select painel.layout_salvar($1::jsonb)', [JSON.stringify(limpo)]);
}
