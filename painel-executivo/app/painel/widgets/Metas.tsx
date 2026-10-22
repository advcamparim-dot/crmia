'use client';

import { useState } from 'react';
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

const TIPOS: TipoMeta[] = ['consultas', 'contratos', 'receita'];
const ETIQUETA: Record<TipoMeta, string> = { consultas: 'Consultas', contratos: 'Contratos', receita: 'Receita' };

export function Metas({ metas }: { metas: Carregado<MetaMes[]> }) {
  const [tipo, setTipo] = useState<TipoMeta>('consultas');
  if (metas.estado === 'indisponivel') return <p className="p-fora">{texto(metas, () => '')}</p>;
  const m = metas.dados.find((x) => x.tipo === tipo);
  return (
    <div>
      <div className="p-etiquetas" role="tablist" aria-label="Meta">
        {TIPOS.map((t) => (
          <button key={t} type="button" role="tab" aria-selected={t === tipo} className={`p-chip${t === tipo ? ' active' : ''}`} onClick={() => setTipo(t)}>{ETIQUETA[t]}</button>
        ))}
      </div>
      <div className="p-metas">
        {m ? (
          <div className="p-meta">
            <div className="p-meta-titulo">{ROTULO[m.tipo]}</div>
            <Velocimetro pct={m.percentual} />
            <div className="p-meta-valores">{valorMeta(m.tipo, m.atual)} de {valorMeta(m.tipo, m.meta)} · {Math.round(m.percentual)}% da meta</div>
            <div className="p-detalhe">
              Faltam {m.dias_restantes} {m.dias_restantes === 1 ? 'dia' : 'dias'} · ritmo atual: {valorMeta(m.tipo, m.tipo === 'receita' ? m.projecao : Math.round(m.projecao * 10) / 10)}
            </div>
          </div>
        ) : (
          <p className="p-vazio">Sem meta de {ETIQUETA[tipo].toLowerCase()} neste mês. Defina abaixo.</p>
        )}
      </div>
      <form action={definirMetaAction} className="p-meta-form">
        <input type="hidden" name="tipo" value={tipo} />
        <input type="text" name="valor" inputMode="decimal" placeholder={`meta de ${ETIQUETA[tipo].toLowerCase()}${tipo === 'receita' ? ' (R$)' : ''} · 0 remove`} aria-label="Valor da meta" required />
        <button type="submit" className="p-mini">Salvar meta</button>
      </form>
    </div>
  );
}
