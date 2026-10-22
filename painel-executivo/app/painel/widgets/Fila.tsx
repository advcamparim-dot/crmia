import { texto, type Carregado } from '@/lib/carregado';
import type { ItemFila } from '@/lib/painel-dados';
import { ORIGEM_TIPO, ROTULO_TIPO, haQuanto } from '../formatar';

const CRM = (process.env.CRM_URL || 'https://crm.camparimadvogados.com.br').replace(/\/+$/, '');

export function Fila({ fila }: { fila: Carregado<ItemFila[]> }) {
  if (fila.estado === 'indisponivel') return <p className="p-fora">{texto(fila, () => '')}</p>;
  if (fila.dados.length === 0) return <p className="p-vazio">Nada pendente. Tudo em dia.</p>;
  return (
    <ul className="p-fila">
      {fila.dados.map((i, k) => {
        const digitos = (i.telefone ?? '').replace(/\D/g, '');
        return (
          <li key={`${i.tipo}-${i.telefone ?? k}`} className={`p-item u${i.urgencia}`}>
            <div className="p-item-topo">
              <span className="p-tipo">{ROTULO_TIPO[i.tipo] ?? i.tipo}</span>
              <span className="p-espera">{ORIGEM_TIPO[i.tipo] && <em className="p-origem">{ORIGEM_TIPO[i.tipo]}</em>}{haQuanto(i.desde)}</span>
            </div>
            <div className="p-item-nome">
              {i.lead_nome ?? i.detalhe}
              {i.telefone_fim && <span className="p-fim"> · final {i.telefone_fim}</span>}
            </div>
            {i.lead_nome && <div className="p-detalhe">{i.detalhe}</div>}
            <div className="p-acoes">
              {digitos && <a href={`https://wa.me/${digitos}`} target="_blank" rel="noopener noreferrer">Abrir no WhatsApp</a>}
              {i.crm_lead_id && <a href={`${CRM}/#Lead/view/${encodeURIComponent(i.crm_lead_id)}`} target="_blank" rel="noopener noreferrer">Abrir no CRM</a>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
