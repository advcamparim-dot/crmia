import { texto, type Carregado } from '@/lib/carregado';
import { resumirPrevisao, type LinhaPrevisao } from '@/lib/previsao';
import { definirPrevisaoAction, definirTicketAction } from '../actions';
import { formatarReais } from '../formatar';

const arred = (n: number) => (Math.round(n * 10) / 10).toLocaleString('pt-BR');

export function Previsao({ previsao }: { previsao: Carregado<LinhaPrevisao[]> }) {
  if (previsao.estado === 'indisponivel') return <p className="p-fora">{texto(previsao, () => '')}</p>;
  const r = resumirPrevisao(previsao.dados);
  return (
    <div>
      <p className="p-resumo-parcelas">
        {r.ativos} leads ativos agora · valor médio de contrato {formatarReais(r.ticket)} ({r.origem === 'real' ? 'média dos contratos reais' : 'definido por você'})
      </p>
      <ul className="p-etapas-cards">
        {r.horizontes.map((h) => (
          <li key={h.dias} className="p-etapa-card">
            <span className="p-etapa-nome">Em {h.dias} dias</span>
            <span className="p-etapa-entraram">{formatarReais(h.receita)}</span>
            <span className="p-etapa-linha"><b>{arred(h.contratos)}</b> contratos esperados</span>
          </li>
        ))}
      </ul>
      <table className="p-tabela">
        <thead><tr><th>Etapa</th><th>Leads</th><th>Chance</th><th>Prazo</th><th>Esperados</th></tr></thead>
        <tbody>
          {previsao.dados.map((l) => (
            <tr key={l.etapa}>
              <td>{l.etapa}</td><td>{l.leads}</td><td>{Math.round(l.chance * 100)}%</td><td>{l.prazo_dias} d</td><td>{arred(l.esperados)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="p-nota">Estimativa com as taxas que você definiu; ainda não vem do histórico (há poucos contratos fechados). Cada etapa conta a partir do horizonte do seu prazo.</p>
      <form action={definirPrevisaoAction} className="p-meta-form">
        <select name="etapa" aria-label="Etapa">
          {previsao.dados.map((l) => <option key={l.etapa} value={l.etapa}>{l.etapa}</option>)}
        </select>
        <input type="text" name="chance" inputMode="decimal" placeholder="chance de fechar (%)" aria-label="Chance de fechar" required />
        <select name="prazo" aria-label="Prazo típico">
          <option value="20">em 20 dias</option><option value="40">em 40 dias</option><option value="60">em 60 dias</option>
        </select>
        <button type="submit" className="p-mini">Salvar taxa</button>
      </form>
      <form action={definirTicketAction} className="p-meta-form">
        <input type="text" name="valor" inputMode="decimal" placeholder="valor médio do contrato (R$)" aria-label="Valor médio do contrato" required />
        <button type="submit" className="p-mini">Salvar valor médio</button>
      </form>
    </div>
  );
}
