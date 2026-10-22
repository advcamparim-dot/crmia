import { texto, type Carregado } from '@/lib/carregado';
import type { FunilEtapa } from '@/lib/painel-dados';

export function AnaliseFunil({ funil }: { funil: Carregado<FunilEtapa[]> }) {
  if (funil.estado === 'indisponivel') return <p className="p-fora">{texto(funil, () => '')}</p>;
  return (
    <div>
      <ul className="p-etapas-cards">
        {funil.dados.map((e) => (
          <li key={e.etapa} className="p-etapa-card">
            <a className="p-etapa-nome" href={`/painel/etapa/${encodeURIComponent(e.etapa)}`}>{e.etapa} ›</a>
            <span className="p-etapa-entraram">{e.entraram}</span>
            <span className="p-etapa-linha"><b>{e.avancaram}</b> avançaram</span>
            <span className={`p-etapa-linha${e.perderam > 0 ? ' p-alerta' : ''}`}><b>{e.perderam}</b> perdidos</span>
            <span className="p-etapa-agora">{e.agora} agora</span>
          </li>
        ))}
      </ul>
      <p className="p-nota">Histórico disponível desde 06/10/2026. Datas de consulta, equipe e perda são aproximadas.</p>
    </div>
  );
}
