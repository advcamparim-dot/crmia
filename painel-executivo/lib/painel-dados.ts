import { getPool } from './db';
import { carregar, type Carregado } from './carregado';
import { ARRANJO_PADRAO, normalizarArranjo, type Arranjo } from './layout';
import type { Consulta } from './sessao';
import type { LinhaPrevisao } from './previsao';

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

export type ResumoReativacao = {
  leads: number; abordados: number; restantes: number; responderam: number; em_conversa: number; com_equipe: number;
  sem_interesse: number; consultas: number; followups: number; horas_ate_resposta: number | null;
  primeiro_envio: string | null; ultimo_envio: string | null;
};

export type ContratosNumeros = { fechados: number; receita_contratada: number; receita_recebida: number; a_receber: number; atrasado: number };
export type ParcelaAberta = {
  id: number; contrato_id: number; lead_nome: string | null; telefone_fim: string | null; numero: number; valor: number;
  vencimento: string; pago_em: string | null; status: string; dias_atraso: number;
};

export type TipoMeta = 'consultas' | 'contratos' | 'receita';
export type MetaMes = { tipo: TipoMeta; meta: number; atual: number; percentual: number; projecao: number; dias_restantes: number; dias_no_mes: number };

export type Periodo = { de: Date; ate: Date };
export type DadosDoPainel = {
  numeros: Carregado<FaixaNumeros>;
  fila: Carregado<ItemFila[]>;
  etapas: Carregado<EtapaLead[]>;
  followups: Carregado<FollowupsPeriodo>;
  fontes: Carregado<FonteLead[]>;
  tempo: Carregado<TempoResposta>;
  funil: Carregado<FunilEtapa[]>;
  contratos: Carregado<ContratosNumeros>;
  parcelas: Carregado<ParcelaAberta[]>;
  metas: Carregado<MetaMes[]>;
  previsao: Carregado<LinhaPrevisao[]>;
  reativacao: Carregado<ResumoReativacao>;
};

const consultaPadrao: Consulta = (sql, params) => getPool().query(sql, params as unknown[]);

// pg devolve bigint como texto; os numeros do painel sao pequenos, entao viram number.
const n = (v: unknown): number => Number(v ?? 0);
const nOuNulo = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export async function carregarPainel(periodo: Periodo, consulta: Consulta = consultaPadrao): Promise<DadosDoPainel> {
  const janela = [periodo.de, periodo.ate];
  const [numeros, fila, etapas, followups, fontes, tempo, funil, contratos, parcelas, metas, previsao, reativacao] = await Promise.all([
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
    carregar('contratos e receita', async () => {
      const { rows } = await consulta('select * from painel.contratos_numeros($1, $2)', janela);
      const r = rows[0];
      if (!r) throw new Error('contratos_numeros sem resposta');
      return { fechados: n(r.fechados), receita_contratada: n(r.receita_contratada), receita_recebida: n(r.receita_recebida), a_receber: n(r.a_receber), atrasado: n(r.atrasado) };
    }),
    carregar('parcelas', async () => {
      const { rows } = await consulta(
        "select id, contrato_id, lead_nome, telefone_fim, numero, valor, to_char(vencimento, 'YYYY-MM-DD') as vencimento, to_char(pago_em, 'YYYY-MM-DD') as pago_em, status, dias_atraso from painel.parcelas_abertas(30)", []);
      return rows.map((r) => ({
        id: n(r.id), contrato_id: n(r.contrato_id), lead_nome: (r.lead_nome as string | null) ?? null, telefone_fim: (r.telefone_fim as string | null) ?? null,
        numero: n(r.numero), valor: n(r.valor), vencimento: String(r.vencimento), pago_em: (r.pago_em as string | null) ?? null, status: String(r.status), dias_atraso: n(r.dias_atraso),
      }));
    }),
    carregar('metas do mes', async () => {
      const { rows } = await consulta('select * from painel.metas_mes()', []);
      return rows.map((r) => ({
        tipo: String(r.tipo) as TipoMeta, meta: n(r.meta), atual: n(r.atual), percentual: n(r.percentual), projecao: n(r.projecao),
        dias_restantes: n(r.dias_restantes), dias_no_mes: n(r.dias_no_mes),
      }));
    }),
    carregar('previsao de vendas', async () => {
      const { rows } = await consulta('select * from painel.previsao()', []);
      return rows.map((r) => ({
        etapa: String(r.etapa), leads: n(r.leads), chance: n(r.chance), prazo_dias: n(r.prazo_dias),
        esperados: n(r.esperados), ticket_medio: n(r.ticket_medio), ticket_origem: String(r.ticket_origem),
      }));
    }),
    carregar('reativacao em massa', async () => {
      const { rows } = await consulta("select leads, abordados, restantes, responderam, em_conversa, com_equipe, sem_interesse, consultas, followups, horas_ate_resposta, to_char(primeiro_envio, 'YYYY-MM-DD') as primeiro_envio, to_char(ultimo_envio, 'YYYY-MM-DD') as ultimo_envio from painel.reativacao_resumo()", []);
      const r = rows[0];
      if (!r) throw new Error('reativacao_resumo sem resposta');
      return {
        leads: n(r.leads), abordados: n(r.abordados), restantes: n(r.restantes), responderam: n(r.responderam), em_conversa: n(r.em_conversa),
        com_equipe: n(r.com_equipe), sem_interesse: n(r.sem_interesse), consultas: n(r.consultas), followups: n(r.followups),
        horas_ate_resposta: nOuNulo(r.horas_ate_resposta), primeiro_envio: (r.primeiro_envio as string | null) ?? null, ultimo_envio: (r.ultimo_envio as string | null) ?? null,
      };
    }),
  ]);
  return { numeros, fila, etapas, followups, fontes, tempo, funil, contratos, parcelas, metas, previsao, reativacao };
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

const hojeSaoPaulo = (agora: Date): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(agora);

function idValido(id: number): void {
  if (!Number.isInteger(id) || id <= 0) throw new Error('parcela invalida');
}

// Marcar pagamento: a data precisa existir e nao pode ser futura (o banco confere de novo e grava a auditoria).
export async function gravarPagamento(id: number, data: string, consulta: Consulta = consultaPadrao, agora: Date = new Date()): Promise<void> {
  idValido(id);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(data ?? ''));
  if (!m) throw new Error('data invalida');
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) throw new Error('data invalida');
  if (data > hojeSaoPaulo(agora)) throw new Error('data futura');
  await consulta('select painel.parcela_marcar_paga($1::bigint, $2::date, $3)', [id, data, 'painel']);
}

export async function desfazerPagamento(id: number, consulta: Consulta = consultaPadrao): Promise<void> {
  idValido(id);
  await consulta('select painel.parcela_desfazer($1::bigint, $2)', [id, 'painel']);
}

const LIMITE_META: Record<TipoMeta, number> = { consultas: 10000, contratos: 10000, receita: 100000000 };

// Definir meta do mes (0 remove). O banco valida de novo e grava a auditoria.
export async function gravarMeta(tipo: string, valor: number, consulta: Consulta = consultaPadrao): Promise<void> {
  if (!(tipo in LIMITE_META)) throw new Error('tipo de meta invalido');
  const t = tipo as TipoMeta;
  if (!Number.isFinite(valor) || valor < 0 || valor > LIMITE_META[t]) throw new Error('valor de meta invalido');
  if (t !== 'receita' && !Number.isInteger(valor)) throw new Error('meta precisa ser inteira');
  await consulta('select painel.meta_definir($1, $2::numeric, $3)', [t, valor, 'painel']);
}

export const ETAPAS = ['Novo', 'Em conversa', 'Consulta', 'Com a equipe', 'Proposta enviada', 'Contrato', 'Perdidos'] as const;
export type LeadDaEtapa = { lead_nome: string | null; telefone_fim: string | null; telefone: string | null; crm_lead_id: string | null };

// So etapas conhecidas chegam ao banco; falha vira "indisponivel", nunca lista vazia.
export async function lerLeadsDaEtapa(etapa: string, consulta: Consulta = consultaPadrao): Promise<Carregado<LeadDaEtapa[]>> {
  if (!(ETAPAS as readonly string[]).includes(etapa)) return { estado: 'indisponivel' };
  try {
    const { rows } = await consulta('select * from painel.leads_da_etapa($1)', [etapa]);
    return {
      estado: 'ok',
      dados: rows.map((r) => ({
        lead_nome: (r.lead_nome as string | null) ?? null, telefone_fim: (r.telefone_fim as string | null) ?? null,
        telefone: (r.telefone as string | null) ?? null, crm_lead_id: (r.crm_lead_id as string | null) ?? null,
      })),
    };
  } catch (erro) {
    console.error('Falha ao ler os leads da etapa', erro);
    return { estado: 'indisponivel' };
  }
}

const ETAPAS_PREVISAO = ['Novo', 'Em conversa', 'Consulta', 'Com a equipe', 'Proposta enviada'];

export async function gravarPrevisao(etapa: string, chance: number, prazo: number, consulta: Consulta = consultaPadrao): Promise<void> {
  if (!ETAPAS_PREVISAO.includes(etapa)) throw new Error('etapa invalida');
  if (!Number.isFinite(chance) || chance < 0 || chance > 1) throw new Error('chance invalida');
  if (![20, 40, 60].includes(prazo)) throw new Error('prazo invalido');
  await consulta('select painel.previsao_definir($1, $2::numeric, $3::integer)', [etapa, chance, prazo]);
}

export async function gravarTicketMedio(valor: number, consulta: Consulta = consultaPadrao): Promise<void> {
  if (!Number.isFinite(valor) || valor <= 0 || valor > 10_000_000) throw new Error('valor medio invalido');
  await consulta('select painel.previsao_ticket_definir($1::numeric)', [valor]);
}

// "Ja assumi": tira o lead da fila de atencao ate ele escrever de novo. So aceita numero com digitos suficientes.
export async function dispensarDaFila(telefone: string, consulta: Consulta = consultaPadrao): Promise<boolean> {
  const digitos = telefone.replace(/\D/g, '');
  if (digitos.length < 10 || digitos.length > 15) throw new Error('telefone invalido');
  const { rows } = await consulta('select painel.fila_dispensar($1, $2) as ok', [`+${digitos}`, 'painel']);
  return rows[0]?.ok === true;
}
