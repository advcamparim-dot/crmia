import { texto, type Carregado } from '@/lib/carregado';
import type { FonteLead } from '@/lib/painel-dados';

export function Fontes({ fontes }: { fontes: Carregado<FonteLead[]> }) {
  if (fontes.estado === 'indisponivel') return <p className="p-fora">{texto(fontes, () => '')}</p>;
  if (fontes.dados.length === 0) return <p className="p-vazio">Nenhum lead novo no período.</p>;
  const maior = Math.max(...fontes.dados.map((f) => f.quantidade), 1);
  return (
    <ul className="p-barras">
      {fontes.dados.map((f) => (
        <li key={f.fonte}>
          <span className="p-barra-nome">{f.fonte}</span>
          <span className="p-barra"><i style={{ width: `${(f.quantidade / maior) * 100}%` }} /></span>
          <span className="p-barra-valor">{f.quantidade}</span>
        </li>
      ))}
    </ul>
  );
}
