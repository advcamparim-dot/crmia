import { requireSession } from '@/lib/session';
import { logout } from '@/app/login/actions';
import { resolvePeriod, type PeriodPreset } from '@/lib/period';
import {
  getResumo,
  getComercial,
  getProducaoNoPeriodo,
  getFinanceiro,
  getJuridico,
  getAlertas,
  getLastSyncedAt,
  type Resumo,
  type Comercial,
  type ProducaoEstagio,
  type Financeiro,
  type Juridico,
  type Alerta
} from '@/lib/metrics';
import './styles.css';

const RESUMO_FALLBACK: Resumo = {
  receitaContratada: 0,
  receitaRecebida: 0,
  leadsNovos: 0,
  contratosAssinados: 0,
  taxaConversao: 0
};

const COMERCIAL_FALLBACK: Comercial = {
  leadsQualificados: 0,
  consultasMarcadas: 0,
  consultasRealizadas: 0,
  propostasEnviadas: 0,
  ticketMedio: 0
};

const PRODUCAO_FALLBACK: ProducaoEstagio[] = [];

const FINANCEIRO_FALLBACK: Financeiro = {
  valorAReceber: 0,
  pagamentosAtrasados: 0,
  taxaInadimplencia: 0,
  totalVencido: 0
};

const JURIDICO_FALLBACK: Juridico = {
  clientesAtivos: 0,
  casosAtivos: 0,
  prazosCriticos: 0,
  casosAltoRisco: 0
};

const ALERTAS_FALLBACK: Alerta[] = [];

function unwrap<T>(result: PromiseSettledResult<T>, label: string, fallback: T): T {
  if (result.status === 'fulfilled') return result.value;
  console.error(`Falha ao carregar ${label}`, result.reason);
  return fallback;
}

const PRESETS: { key: PeriodPreset; label: string }[] = [
  { key: 'hoje', label: 'Hoje' },
  { key: '7d', label: '7 dias' },
  { key: '30d', label: '30 dias' },
  { key: 'mes_atual', label: 'Mês atual' }
];

function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatPercent(value: number): string {
  return `${(value * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}

export default async function PainelExecutivoPage({
  searchParams
}: {
  searchParams: { periodo?: string };
}) {
  await requireSession();

  const presetKey = (PRESETS.find((p) => p.key === searchParams.periodo)?.key ?? '30d') as PeriodPreset;
  const period = resolvePeriod(presetKey);

  const [resumoResult, comercialResult, producaoResult, financeiroResult, juridicoResult, alertasResult, lastSyncedAtResult] =
    await Promise.allSettled([
      getResumo(period),
      getComercial(period),
      getProducaoNoPeriodo(period),
      getFinanceiro(),
      getJuridico(),
      getAlertas(),
      getLastSyncedAt()
    ]);

  const resumo = unwrap(resumoResult, 'resumo', RESUMO_FALLBACK);
  const comercial = unwrap(comercialResult, 'comercial', COMERCIAL_FALLBACK);
  const producao = unwrap(producaoResult, 'produção no período', PRODUCAO_FALLBACK);
  const financeiro = unwrap(financeiroResult, 'financeiro', FINANCEIRO_FALLBACK);
  const juridico = unwrap(juridicoResult, 'jurídico', JURIDICO_FALLBACK);
  const alertas = unwrap(alertasResult, 'alertas', ALERTAS_FALLBACK);
  const lastSyncedAt = unwrap(lastSyncedAtResult, 'última sincronização', null);

  const dadosDesatualizados =
    lastSyncedAt !== null && Date.now() - lastSyncedAt.getTime() > 15 * 60 * 1000;

  const maiorProducao = Math.max(...producao.map((f) => f.quantidade), 1);

  return (
    <div className="wrap">
      <div className="top-strip">
        <div className="brand">
          <img src="/logo-camparim.png" alt="Camparim Advogados" />
          <span className="firm">
            Camparim Advogados
            <small>Painel executivo</small>
          </span>
        </div>
        <div className="period">
          {PRESETS.map((p) => (
            <a key={p.key} href={`?periodo=${p.key}`}>
              <button className={p.key === presetKey ? 'active' : ''}>{p.label}</button>
            </a>
          ))}
          <form action={logout}>
            <button type="submit" title="Sair">Sair</button>
          </form>
        </div>
      </div>

      <nav className="tabbar" aria-label="Painéis">
        <a className="active" href="#">Executivo</a>
        <a aria-disabled="true" title="Em breve">Operacional</a>
        <a aria-disabled="true" title="Em breve">Financeiro</a>
        <a aria-disabled="true" title="Em breve">Marketing</a>
        <a aria-disabled="true" title="Em breve">IA</a>
      </nav>

      <header>
        <h1 className="display">Painel Executivo</h1>
        <p className="meta">
          {dadosDesatualizados && (
            <span className="sample-tag">dados podem estar desatualizados — </span>
          )}
          Última sincronização:{' '}
          {lastSyncedAt
            ? lastSyncedAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
            : 'nunca'}
        </p>
      </header>

      <section aria-labelledby="resumo">
        <h2 id="resumo">Resumo</h2>
        <div className="tiles">
          <div className="tile accent">
            <span className="label">Receita contratada</span>
            <span className="value tabular">{formatBRL(resumo.receitaContratada)}</span>
          </div>
          <div className="tile accent">
            <span className="label">Receita recebida</span>
            <span className="value tabular">{formatBRL(resumo.receitaRecebida)}</span>
          </div>
          <div className="tile">
            <span className="label">Leads novos</span>
            <span className="value tabular">{resumo.leadsNovos}</span>
          </div>
          <div className="tile">
            <span className="label">Contratos assinados</span>
            <span className="value tabular">{resumo.contratosAssinados}</span>
          </div>
          <div className="tile">
            <span className="label">Taxa de conversão</span>
            <span className="value tabular">{formatPercent(resumo.taxaConversao)}</span>
          </div>
        </div>
      </section>

      <section aria-labelledby="comercial">
        <h2 id="comercial">Comercial</h2>
        <div className="tiles">
          <div className="tile">
            <span className="label">Leads qualificados</span>
            <span className="value tabular">{comercial.leadsQualificados}</span>
          </div>
          <div className="tile">
            <span className="label">Consultas marcadas</span>
            <span className="value tabular">{comercial.consultasMarcadas}</span>
          </div>
          <div className="tile">
            <span className="label">Consultas realizadas</span>
            <span className="value tabular">{comercial.consultasRealizadas}</span>
          </div>
          <div className="tile">
            <span className="label">Propostas enviadas</span>
            <span className="value tabular">{comercial.propostasEnviadas}</span>
          </div>
          <div className="tile">
            <span className="label">Ticket médio</span>
            <span className="value tabular">{formatBRL(comercial.ticketMedio)}</span>
          </div>
        </div>
      </section>

      <div className="cols">
        <section aria-labelledby="producao">
          <h2 id="producao">Produção no período</h2>
          {producao.map((estagio, i) => (
            <div className={`funnel-row${i === producao.length - 1 ? ' final' : ''}`} key={estagio.estagio}>
              <span className="stage">{estagio.estagio}</span>
              <div className="funnel-track">
                <div
                  className="funnel-fill"
                  style={{
                    width: `${(estagio.quantidade / maiorProducao) * 100}%`,
                    background: `var(--g${Math.min(i + 1, 4)})`
                  }}
                />
              </div>
              <span className="n tabular">{estagio.quantidade}</span>
            </div>
          ))}
          <p className="funnel-caption">Itens realizados no período; não representa coorte nem taxa de conversão.</p>
        </section>

        <section aria-labelledby="financeiro">
          <h2 id="financeiro">Financeiro</h2>
          <div className="stat-grid">
            <div className="stat">
              <span className="label">Valor a receber</span>
              <span className="value tabular">{formatBRL(financeiro.valorAReceber)}</span>
            </div>
            <div className="stat warn">
              <span className="label">Pagamentos atrasados</span>
              <span className="value tabular">{formatBRL(financeiro.pagamentosAtrasados)}</span>
            </div>
            <div className="stat warn">
              <span className="label">Taxa de inadimplência</span>
              <span className="value tabular">{formatPercent(financeiro.taxaInadimplencia)}</span>
            </div>
            <div className="stat">
              <span className="label">Total vencido</span>
              <span className="value tabular">{formatBRL(financeiro.totalVencido)}</span>
            </div>
          </div>
        </section>
      </div>

      <section aria-labelledby="juridico">
        <h2 id="juridico">Jurídico e operacional</h2>
        <div className="kpi-row">
          <div className="kpi">
            <span className="label">Clientes ativos</span>
            <span className="value tabular">{juridico.clientesAtivos}</span>
          </div>
          <div className="kpi">
            <span className="label">Casos ativos</span>
            <span className="value tabular">{juridico.casosAtivos}</span>
          </div>
          <div className="kpi critical">
            <span className="label">Prazos críticos</span>
            <span className="value tabular">{juridico.prazosCriticos}</span>
          </div>
          <div className="kpi critical">
            <span className="label">Casos de alto risco</span>
            <span className="value tabular">{juridico.casosAltoRisco}</span>
          </div>
        </div>
      </section>

      <section aria-labelledby="alertas">
        <h2 id="alertas">Alertas executivos</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Tipo</th>
                <th>Severidade</th>
                <th>Referência</th>
                <th>Data</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {alertas.map((alerta, i) => (
                <tr key={i}>
                  <td>{alerta.tipo}</td>
                  <td>
                    <span className={`pill ${alerta.severidade === 'Crítica' ? 'critical' : 'warning'}`}>
                      {alerta.severidade}
                    </span>
                  </td>
                  <td>{alerta.referencia}</td>
                  <td className="date-col">{alerta.data}</td>
                  <td>{alerta.situacao}</td>
                </tr>
              ))}
              {alertas.length === 0 && (
                <tr>
                  <td colSpan={5}>Nenhum alerta no momento.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <p className="foot">
        Painel somente leitura. Não contém conversas, documentos, conteúdo jurídico detalhado ou dados pessoais sensíveis.
      </p>
    </div>
  );
}
