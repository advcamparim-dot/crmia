import { requireSession } from '@/lib/session';
import { logout } from '@/app/login/actions';
import { resolvePeriod, type PeriodPreset } from '@/lib/period';
import { carregar, texto, INDISPONIVEL } from '@/lib/carregado';
import {
  getResumo,
  getComercial,
  getFunil,
  getFinanceiro,
  getJuridico,
  getAlertas,
  getLastSyncedAt
} from '@/lib/metrics';
import './styles.css';

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

  const [resumo, comercial, funil, financeiro, juridico, alertas, lastSyncedAt] = await Promise.all([
    carregar('resumo', () => getResumo(period)),
    carregar('comercial', () => getComercial(period)),
    carregar('funil', () => getFunil(period)),
    carregar('financeiro', () => getFinanceiro()),
    carregar('jurídico', () => getJuridico()),
    carregar('alertas', () => getAlertas()),
    carregar('última sincronização', () => getLastSyncedAt())
  ]);

  const dadosDesatualizados =
    lastSyncedAt.estado === 'ok' &&
    lastSyncedAt.dados !== null &&
    Date.now() - lastSyncedAt.dados.getTime() > 15 * 60 * 1000;

  const maiorFunil =
    funil.estado === 'ok' ? Math.max(...funil.dados.map((f) => f.quantidade), 1) : 1;

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
          {texto(lastSyncedAt, (d) =>
            d ? d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : 'nunca'
          )}
        </p>
      </header>

      <section aria-labelledby="resumo">
        <h2 id="resumo">Resumo</h2>
        <div className="tiles">
          <div className="tile accent">
            <span className="label">Receita contratada</span>
            <span className="value tabular">{texto(resumo, (r) => formatBRL(r.receitaContratada))}</span>
          </div>
          <div className="tile accent">
            <span className="label">Receita recebida</span>
            <span className="value tabular">{texto(resumo, (r) => formatBRL(r.receitaRecebida))}</span>
          </div>
          <div className="tile">
            <span className="label">Leads novos</span>
            <span className="value tabular">{texto(resumo, (r) => String(r.leadsNovos))}</span>
          </div>
          <div className="tile">
            <span className="label">Contratos assinados</span>
            <span className="value tabular">{texto(resumo, (r) => String(r.contratosAssinados))}</span>
          </div>
          <div className="tile">
            <span className="label">Taxa de conversão</span>
            <span className="value tabular">{texto(resumo, (r) => formatPercent(r.taxaConversao))}</span>
          </div>
        </div>
      </section>

      <section aria-labelledby="comercial">
        <h2 id="comercial">Comercial</h2>
        <div className="tiles">
          <div className="tile">
            <span className="label">Leads qualificados</span>
            <span className="value tabular">{texto(comercial, (c) => String(c.leadsQualificados))}</span>
          </div>
          <div className="tile">
            <span className="label">Consultas marcadas</span>
            <span className="value tabular">{texto(comercial, (c) => String(c.consultasMarcadas))}</span>
          </div>
          <div className="tile">
            <span className="label">Consultas realizadas</span>
            <span className="value tabular">{texto(comercial, (c) => String(c.consultasRealizadas))}</span>
          </div>
          <div className="tile">
            <span className="label">Propostas enviadas</span>
            <span className="value tabular">{texto(comercial, (c) => String(c.propostasEnviadas))}</span>
          </div>
          <div className="tile">
            <span className="label">Ticket médio</span>
            <span className="value tabular">{texto(comercial, (c) => formatBRL(c.ticketMedio))}</span>
          </div>
        </div>
      </section>

      <div className="cols">
        <section aria-labelledby="funil">
          <h2 id="funil">Funil comercial</h2>
          {funil.estado === 'ok' ? (
            funil.dados.map((estagio, i) => (
              <div className={`funnel-row${i === funil.dados.length - 1 ? ' final' : ''}`} key={estagio.estagio}>
                <span className="stage">{estagio.estagio}</span>
                <div className="funnel-track">
                  <div
                    className="funnel-fill"
                    style={{
                      width: `${(estagio.quantidade / maiorFunil) * 100}%`,
                      background: `var(--g${Math.min(i + 1, 4)})`
                    }}
                  />
                </div>
                <span className="n tabular">{estagio.quantidade}</span>
              </div>
            ))
          ) : (
            <p className="funnel-caption">{INDISPONIVEL}</p>
          )}
          <p className="funnel-caption">Largura proporcional ao maior estágio do período.</p>
        </section>

        <section aria-labelledby="financeiro">
          <h2 id="financeiro">Financeiro</h2>
          <div className="stat-grid">
            <div className="stat">
              <span className="label">Valor a receber</span>
              <span className="value tabular">{texto(financeiro, (f) => formatBRL(f.valorAReceber))}</span>
            </div>
            <div className="stat warn">
              <span className="label">Pagamentos atrasados</span>
              <span className="value tabular">{texto(financeiro, (f) => formatBRL(f.pagamentosAtrasados))}</span>
            </div>
            <div className="stat warn">
              <span className="label">Taxa de inadimplência</span>
              <span className="value tabular">{texto(financeiro, (f) => formatPercent(f.taxaInadimplencia))}</span>
            </div>
            <div className="stat">
              <span className="label">Total vencido</span>
              <span className="value tabular">{texto(financeiro, (f) => formatBRL(f.totalVencido))}</span>
            </div>
          </div>
        </section>
      </div>

      <section aria-labelledby="juridico">
        <h2 id="juridico">Jurídico e operacional</h2>
        <div className="kpi-row">
          <div className="kpi">
            <span className="label">Clientes ativos</span>
            <span className="value tabular">{texto(juridico, (j) => String(j.clientesAtivos))}</span>
          </div>
          <div className="kpi">
            <span className="label">Casos ativos</span>
            <span className="value tabular">{texto(juridico, (j) => String(j.casosAtivos))}</span>
          </div>
          <div className="kpi critical">
            <span className="label">Prazos críticos</span>
            <span className="value tabular">{texto(juridico, (j) => String(j.prazosCriticos))}</span>
          </div>
          <div className="kpi critical">
            <span className="label">Casos de alto risco</span>
            <span className="value tabular">{texto(juridico, (j) => String(j.casosAltoRisco))}</span>
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
              {alertas.estado === 'ok' &&
                alertas.dados.map((alerta, i) => (
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
              {alertas.estado === 'ok' && alertas.dados.length === 0 && (
                <tr>
                  <td colSpan={5}>Nenhum alerta no momento.</td>
                </tr>
              )}
              {alertas.estado === 'indisponivel' && (
                <tr>
                  <td colSpan={5}>Alertas {INDISPONIVEL}s no momento.</td>
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
