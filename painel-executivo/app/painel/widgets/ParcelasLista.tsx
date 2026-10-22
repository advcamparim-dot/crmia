import { texto, type Carregado } from '@/lib/carregado';
import type { ContratosNumeros, ParcelaAberta } from '@/lib/painel-dados';
import { dataBR, formatarReais, hojeIso } from '../formatar';
import { desfazerPagaAction, marcarPagaAction } from '../actions';

function situacao(p: ParcelaAberta): string {
  if (p.status === 'paga') return `paga em ${p.pago_em ? dataBR(p.pago_em) : ''}`;
  if (p.status === 'atrasada') return `atrasada há ${p.dias_atraso} ${p.dias_atraso === 1 ? 'dia' : 'dias'}`;
  return 'a receber';
}

export function ParcelasLista({ parcelas, resumo }: { parcelas: Carregado<ParcelaAberta[]>; resumo: Carregado<ContratosNumeros> }) {
  if (parcelas.estado === 'indisponivel') return <p className="p-fora">{texto(parcelas, () => '')}</p>;
  if (parcelas.dados.length === 0) return <p className="p-vazio">Nenhuma parcela em aberto.</p>;
  const hoje = hojeIso();
  return (
    <div>
      {resumo.estado === 'ok' && (
        <p className="p-resumo-parcelas">A receber {formatarReais(resumo.dados.a_receber)} · Atrasado {formatarReais(resumo.dados.atrasado)}</p>
      )}
      <ul className="p-parcelas">
        {parcelas.dados.map((p) => (
          <li key={p.id} className={`p-parcela s-${p.status}`}>
            <div className="p-parcela-info">
              <strong>{p.lead_nome ?? 'Cliente'}</strong>
              {p.telefone_fim && <span className="p-fim"> · final {p.telefone_fim}</span>}
              <div className="p-detalhe">
                {p.numero === 0 ? 'Entrada' : `Parcela ${p.numero}`} · {formatarReais(p.valor)} · vence {dataBR(p.vencimento)} · {situacao(p)}
              </div>
            </div>
            {p.status === 'paga' ? (
              <form action={desfazerPagaAction} className="p-parcela-acao">
                <input type="hidden" name="id" value={p.id} />
                <button type="submit" className="p-mini">Desfazer</button>
              </form>
            ) : (
              <form action={marcarPagaAction} className="p-parcela-acao">
                <input type="hidden" name="id" value={p.id} />
                <input type="date" name="data" defaultValue={hoje} max={hoje} aria-label="Data do pagamento" required />
                <button type="submit" className="p-mini">Marcar como paga</button>
              </form>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
