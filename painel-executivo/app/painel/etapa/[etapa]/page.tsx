import { notFound } from 'next/navigation';
import { requireSession } from '@/lib/session';
import { texto } from '@/lib/carregado';
import { ETAPAS, lerLeadsDaEtapa } from '@/lib/painel-dados';
import '../../styles.css';

const CRM = (process.env.CRM_URL || 'https://crm.camparimadvogados.com.br').replace(/\/+$/, '');

export default async function EtapaPage({ params }: { params: { etapa: string } }) {
  await requireSession();
  const etapa = decodeURIComponent(params.etapa);
  if (!(ETAPAS as readonly string[]).includes(etapa)) notFound();
  const leads = await lerLeadsDaEtapa(etapa);

  return (
    <div className="p-wrap">
      <div className="p-topo">
        <a href="/painel" className="p-chip">← Painel</a>
        <h1 className="p-titulo-pagina">{etapa}{leads.estado === 'ok' ? ` · ${leads.dados.length}` : ''}</h1>
        <span />
      </div>
      <section className="p-quadro">
        <div className="p-quadro-corpo">
          {leads.estado === 'indisponivel' ? <p className="p-fora">{texto(leads, () => '')}</p>
            : leads.dados.length === 0 ? <p className="p-vazio">Nenhum lead nesta etapa.</p>
            : (
              <ul className="p-fila">
                {leads.dados.map((l, k) => {
                  const digitos = (l.telefone ?? '').replace(/\D/g, '');
                  return (
                    <li key={`${l.telefone ?? k}`} className="p-item">
                      <div className="p-item-nome">
                        {l.lead_nome ?? 'Sem nome'}
                        {l.telefone_fim && <span className="p-fim"> · final {l.telefone_fim}</span>}
                      </div>
                      <div className="p-acoes">
                        {digitos && <a href={`https://wa.me/${digitos}`} target="_blank" rel="noopener noreferrer">Abrir no WhatsApp</a>}
                        {l.crm_lead_id && <a href={`${CRM}/#Lead/view/${encodeURIComponent(l.crm_lead_id)}`} target="_blank" rel="noopener noreferrer">Abrir no CRM</a>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
        </div>
      </section>
    </div>
  );
}
