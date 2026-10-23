import { texto, type Carregado } from '@/lib/carregado';
import type { ResumoReativacao } from '@/lib/painel-dados';
import { dataBR } from '../formatar';

const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '—');

export function Reativacao({ reativacao }: { reativacao: Carregado<ResumoReativacao> }) {
  if (reativacao.estado === 'indisponivel') return <p className="p-fora">{texto(reativacao, () => '')}</p>;
  const r = reativacao.dados;
  if (r.leads === 0) return <p className="p-vazio">Nenhuma reativação em andamento.</p>;
  return (
    <div>
      <p className="p-resumo-parcelas">
        {r.abordados} de {r.leads} leads abordados{r.primeiro_envio && ` desde ${dataBR(r.primeiro_envio)}`} · {r.restantes} na fila para os próximos dias
      </p>
      <ul className="p-etapas-cards">
        <li className="p-etapa-card">
          <span className="p-etapa-nome">Responderam</span>
          <span className="p-etapa-entraram">{r.responderam}</span>
          <span className="p-etapa-linha"><b>{pct(r.responderam, r.abordados)}</b> dos abordados</span>
          {r.horas_ate_resposta !== null && <span className="p-etapa-agora">em média {r.horas_ate_resposta.toLocaleString('pt-BR')} h depois</span>}
        </li>
        <li className="p-etapa-card">
          <span className="p-etapa-nome">Em conversa</span>
          <span className="p-etapa-entraram">{r.em_conversa}</span>
          <span className="p-etapa-linha">com a Mayara</span>
        </li>
        <li className="p-etapa-card">
          <span className="p-etapa-nome">Com a equipe</span>
          <span className="p-etapa-entraram">{r.com_equipe}</span>
          <span className="p-etapa-linha">esperando você</span>
        </li>
        <li className="p-etapa-card">
          <span className="p-etapa-nome">Sem interesse</span>
          <span className="p-etapa-entraram">{r.sem_interesse}</span>
          <span className="p-etapa-linha">saem da lista</span>
        </li>
        <li className="p-etapa-card">
          <span className="p-etapa-nome">Consultas</span>
          <span className="p-etapa-entraram">{r.consultas}</span>
          <span className="p-etapa-linha">marcadas</span>
        </li>
      </ul>
      <p className="p-nota">{r.followups} follow-ups da régua enviados depois da primeira mensagem. “Responderam” conta qualquer mensagem do lead após o envio.</p>
    </div>
  );
}
