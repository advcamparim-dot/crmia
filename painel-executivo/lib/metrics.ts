import { getPool } from './db';
import type { Period } from './period';

export interface Resumo {
  receitaContratada: number;
  receitaRecebida: number;
  leadsNovos: number;
  contratosAssinados: number;
  taxaConversao: number;
}

export async function getResumo(period: Period): Promise<Resumo> {
  const pool = getPool();
  const { rows } = await pool.query(
    `select
       coalesce((select sum(amount) from crm_sync.contratos where status = 'Assinado' and signed_at between $1 and $2), 0) as receita_contratada,
       coalesce((select sum(amount) from crm_sync.pagamentos where status = 'Pago' and paid_at between $1 and $2), 0) as receita_recebida,
       (select count(*) from crm_sync.leads where created_at between $1 and $2) as leads_novos,
       (select count(*) from crm_sync.contratos where status = 'Assinado' and signed_at between $1 and $2) as contratos_assinados`,
    [period.from, period.to]
  );
  const row = rows[0];
  const leadsNovos = Number(row.leads_novos);
  const contratosAssinados = Number(row.contratos_assinados);
  return {
    receitaContratada: Number(row.receita_contratada),
    receitaRecebida: Number(row.receita_recebida),
    leadsNovos,
    contratosAssinados,
    taxaConversao: leadsNovos > 0 ? contratosAssinados / leadsNovos : 0
  };
}

export interface Comercial {
  leadsQualificados: number;
  consultasMarcadas: number;
  consultasRealizadas: number;
  propostasEnviadas: number;
  ticketMedio: number;
}

export async function getComercial(period: Period): Promise<Comercial> {
  const pool = getPool();
  const { rows } = await pool.query(
    `select
       (select count(*) from crm_sync.leads where created_at between $1 and $2 and status not in ('New','Dead')) as leads_qualificados,
       (select count(*) from crm_sync.meetings where date_start between $1 and $2) as consultas_marcadas,
       (select count(*) from crm_sync.meetings where date_start between $1 and $2 and status = 'Held') as consultas_realizadas,
       (select count(*) from crm_sync.propostas where sent_at between $1 and $2 and status in ('Enviada','Aceita','Recusada','Vencida')) as propostas_enviadas,
       coalesce((select sum(amount) from crm_sync.contratos where status = 'Assinado' and signed_at between $1 and $2), 0) as receita_contratada,
       (select count(*) from crm_sync.contratos where status = 'Assinado' and signed_at between $1 and $2) as contratos_assinados`,
    [period.from, period.to]
  );
  const row = rows[0];
  const contratosAssinados = Number(row.contratos_assinados);
  const receitaContratada = Number(row.receita_contratada);
  return {
    leadsQualificados: Number(row.leads_qualificados),
    consultasMarcadas: Number(row.consultas_marcadas),
    consultasRealizadas: Number(row.consultas_realizadas),
    propostasEnviadas: Number(row.propostas_enviadas),
    ticketMedio: contratosAssinados > 0 ? receitaContratada / contratosAssinados : 0
  };
}

export interface FunilEstagio {
  estagio: string;
  quantidade: number;
}

export async function getFunil(period: Period): Promise<FunilEstagio[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    `select
       (select count(*) from crm_sync.leads where created_at between $1 and $2) as leads,
       (select count(*) from crm_sync.leads where created_at between $1 and $2 and status not in ('New','Dead')) as qualificados,
       (select count(*) from crm_sync.meetings where date_start between $1 and $2 and status = 'Held') as consultas,
       (select count(*) from crm_sync.propostas where sent_at between $1 and $2 and status in ('Enviada','Aceita')) as propostas,
       (select count(*) from crm_sync.contratos where status = 'Assinado' and signed_at between $1 and $2) as contratos`,
    [period.from, period.to]
  );
  const row = rows[0];
  return [
    { estagio: 'Leads', quantidade: Number(row.leads) },
    { estagio: 'Qualificados', quantidade: Number(row.qualificados) },
    { estagio: 'Consultas', quantidade: Number(row.consultas) },
    { estagio: 'Propostas', quantidade: Number(row.propostas) },
    { estagio: 'Contratos', quantidade: Number(row.contratos) }
  ];
}

export interface Financeiro {
  valorAReceber: number;
  pagamentosAtrasados: number;
  taxaInadimplencia: number;
  totalVencido: number;
}

export async function getFinanceiro(): Promise<Financeiro> {
  const pool = getPool();
  const { rows } = await pool.query(
    `select
       coalesce((select sum(amount) from crm_sync.pagamentos where status in ('Pendente','Atrasado')), 0) as valor_a_receber,
       coalesce((select sum(amount) from crm_sync.pagamentos where status = 'Atrasado'), 0) as pagamentos_atrasados,
       coalesce((select sum(amount) from crm_sync.pagamentos where status = 'Atrasado' and due_date < current_date), 0) as total_vencido,
       coalesce((select sum(amount) from crm_sync.pagamentos where due_date between current_date - interval '90 days' and current_date and status in ('Pendente','Atrasado','Pago')), 0) as base_90_dias,
       coalesce((select sum(amount) from crm_sync.pagamentos where status = 'Atrasado' and due_date between current_date - interval '90 days' and current_date), 0) as atrasados_90_dias`
  );
  const row = rows[0];
  const atrasados = Number(row.pagamentos_atrasados);
  const base90 = Number(row.base_90_dias);
  const atrasados90 = Number(row.atrasados_90_dias);
  return {
    valorAReceber: Number(row.valor_a_receber),
    pagamentosAtrasados: atrasados,
    totalVencido: Number(row.total_vencido),
    taxaInadimplencia: base90 > 0 ? atrasados90 / base90 : 0
  };
}

export interface Juridico {
  clientesAtivos: number;
  casosAtivos: number;
  prazosCriticos: number;
  casosAltoRisco: number;
}

export async function getJuridico(): Promise<Juridico> {
  const pool = getPool();
  const { rows } = await pool.query(
    `select
       (select count(distinct client_id) from crm_sync.casos_juridicos where status = 'Ativo') as clientes_ativos,
       (select count(*) from crm_sync.casos_juridicos where status = 'Ativo') as casos_ativos,
       (select count(*) from crm_sync.casos_juridicos where status = 'Ativo' and next_deadline_at < now() + interval '7 days') as prazos_criticos,
       (select count(*) from crm_sync.casos_juridicos where status = 'Ativo' and risk_level = 'Alto') as casos_alto_risco`
  );
  const row = rows[0];
  return {
    clientesAtivos: Number(row.clientes_ativos),
    casosAtivos: Number(row.casos_ativos),
    prazosCriticos: Number(row.prazos_criticos),
    casosAltoRisco: Number(row.casos_alto_risco)
  };
}

export interface Alerta {
  tipo: 'Prazo' | 'Pagamento';
  severidade: 'Crítica' | 'Alta';
  referencia: string;
  data: string;
  situacao: string;
}

export async function getAlertas(): Promise<Alerta[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    `(
       select 'Prazo' as tipo,
              case when next_deadline_at < now() then 'Crítica' else 'Alta' end as severidade,
              'Caso ' || id as referencia,
              to_char(next_deadline_at, 'DD/MM/YYYY') as data,
              case when next_deadline_at < now() then 'Vencido' else 'Próximo' end as situacao,
              next_deadline_at as ordenacao
       from crm_sync.casos_juridicos
       where status = 'Ativo' and next_deadline_at < now() + interval '7 days'
     )
     union all
     (
       select 'Pagamento' as tipo,
              'Alta' as severidade,
              'Pagamento ' || id as referencia,
              to_char(due_date, 'DD/MM/YYYY') as data,
              'Atrasado' as situacao,
              due_date::timestamptz as ordenacao
       from crm_sync.pagamentos
       where status = 'Atrasado'
     )
     order by ordenacao asc
     limit 20`
  );
  return rows.map((row) => ({
    tipo: row.tipo,
    severidade: row.severidade,
    referencia: row.referencia,
    data: row.data,
    situacao: row.situacao
  }));
}

export async function getLastSyncedAt(): Promise<Date | null> {
  const pool = getPool();
  const { rows } = await pool.query(
    `select min(last_synced_at) as oldest from crm_sync.sync_state`
  );
  return rows[0]?.oldest ?? null;
}
