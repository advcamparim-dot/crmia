import { texto, type Carregado } from '@/lib/carregado';
import type { EtapaLead } from '@/lib/painel-dados';

export function Etapas({ etapas }: { etapas: Carregado<EtapaLead[]> }) {
  if (etapas.estado === 'indisponivel') return <p className="p-fora">{texto(etapas, () => '')}</p>;
  const maior = Math.max(...etapas.dados.map((e) => e.quantidade), 1);
  return (
    <ul className="p-barras">
      {etapas.dados.map((e) => (
        <li key={e.etapa}>
          <span className="p-barra-nome">{e.etapa}</span>
          <span className="p-barra"><i style={{ width: `${(e.quantidade / maior) * 100}%` }} /></span>
          <span className="p-barra-valor">{e.quantidade}</span>
        </li>
      ))}
    </ul>
  );
}
