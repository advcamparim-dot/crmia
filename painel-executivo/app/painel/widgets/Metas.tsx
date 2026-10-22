import { texto, type Carregado } from '@/lib/carregado';
import type { MetaMes, TipoMeta } from '@/lib/painel-dados';
import { definirMetaAction } from '../actions';
import { formatarReais } from '../formatar';

const ROTULO: Record<TipoMeta, string> = { consultas: 'Consultas marcadas', contratos: 'Contratos fechados', receita: 'Receita contratada' };
const R = 40;
const SEMI = Math.PI * R;

function Velocimetro({ pct }: { pct: number }) {
  const frac = Math.min(Math.max(pct, 0), 100) / 100;
  return (
    <svg viewBox="0 0 100 60" className="p-gauge" role="img" aria-label={`${Math.round(pct)}% da meta`}>
      <path d="M10,50 A40,40 0 0 1 90,50" fill="none" stroke="var(--surface-2)" strokeWidth="9" strokeLinecap="round" />
      <path d="M10,50 A40,40 0 0 1 90,50" fill="none" stroke={pct >= 100 ? 'var(--good)' : 'var(--brass)'} strokeWidth="9" strokeLinecap="round" strokeDasharray={`${frac * SEMI} ${SEMI}`} />
      <text x="50" y="48" textAnchor="middle" className="p-gauge-pct">{`${Math.round(pct)}%`}</text>
    </svg>
  );
}

function valorMeta(tipo: TipoMeta, v: number): string {
  return tipo === 'receita' ? formatarReais(v) : String(v);
}

export function Metas({ metas }: { metas: Carregado<MetaMes[]> }) {
  if (metas.estado === 'indisponivel') return <p className="p-fora">{texto(metas, () => '')}</p>;
  return (
    <div>
      {metas.dados.length === 0 ? (
        <p className="p-vazio">Defina uma meta do mês para acompanhar o avanço.</p>
      ) : (
        <div className="p-metas">
          {metas.dados.map((m) => (
            <div key={m.tipo} className="p-meta">
              <div className="p-meta-titulo">{ROTULO[m.tipo]}</div>
              <Velocimetro pct={m.percentual} />
              <div className="p-meta-valores">{valorMeta(m.tipo, m.atual)} de {valorMeta(m.tipo, m.meta)}</div>
              <div className="p-detalhe">
                Faltam {m.dias_restantes} {m.dias_restantes === 1 ? 'dia' : 'dias'} · ritmo atual: {valorMeta(m.tipo, m.tipo === 'receita' ? m.projecao : Math.round(m.projecao * 10) / 10)}
              </div>
            </div>
          ))}
        </div>
      )}
      <form action={definirMetaAction} className="p-meta-form">
        <select name="tipo" aria-label="Meta">
          <option value="consultas">Consultas marcadas</option>
          <option value="contratos">Contratos fechados</option>
          <option value="receita">Receita contratada (R$)</option>
        </select>
        <input type="text" name="valor" inputMode="decimal" placeholder="valor da meta (0 remove)" aria-label="Valor da meta" required />
        <button type="submit" className="p-mini">Salvar meta</button>
      </form>
    </div>
  );
}
