'use client';

import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from 'react';
import GridLayout from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { arranjoParaCelular, normalizarArranjo, type Arranjo, type Item } from '@/lib/layout';
import { CATALOGO, type WidgetId } from '@/lib/widgets';
import { salvarArranjo } from './actions';

const LARGURA_CELULAR = 700;
const ALTURA_LINHA = 44;

type Props = { arranjo: Arranjo; quadros: Record<WidgetId, ReactNode> };

export default function Grade({ arranjo, quadros }: Props) {
  const [salvo, setSalvo] = useState<Arranjo>(arranjo);
  const [rascunho, setRascunho] = useState<Item[] | null>(null); // null = modo Ver
  const [largura, setLargura] = useState<number | null>(null); // null = ainda nao montou: empilha, igual ao servidor
  const [erro, setErro] = useState<string | null>(null);
  const [gravando, iniciar] = useTransition();
  const caixa = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = caixa.current;
    if (!el) return;
    const medir = () => setLargura(el.getBoundingClientRect().width);
    medir();
    const obs = new ResizeObserver(medir);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const celular = largura === null || largura < LARGURA_CELULAR;
  const configurando = rascunho !== null && !celular;
  const itens = configurando ? rascunho! : salvo.itens;
  const visiveis = useMemo(() => itens.filter((i) => !i.oculto), [itens]);
  const escondidos = useMemo(() => itens.filter((i) => i.oculto), [itens]);

  function cabecalho(id: WidgetId) {
    return (
      <header className="p-quadro-topo">
        <h2>{CATALOGO[id].titulo}</h2>
        {configurando && (
          <button type="button" className="p-mini" onClick={() => setRascunho(rascunho!.map((i) => (i.id === id ? { ...i, oculto: true } : i)))}>
            Esconder
          </button>
        )}
      </header>
    );
  }

  function aoMudar(layout: GridLayout.Layout[]) {
    if (!rascunho) return;
    setRascunho(rascunho.map((i) => {
      const l = layout.find((x) => x.i === i.id);
      return l && !i.oculto ? { ...i, x: l.x, y: l.y, w: l.w, h: l.h } : i;
    }));
  }

  function adicionar(id: WidgetId) {
    const fundo = rascunho!.reduce((m, i) => (i.oculto ? m : Math.max(m, i.y + i.h)), 0);
    setRascunho(rascunho!.map((i) => (i.id === id ? { ...i, oculto: false, x: 0, y: fundo, w: CATALOGO[id].w, h: CATALOGO[id].h } : i)));
  }

  function salvar() {
    setErro(null);
    const novo = normalizarArranjo({ versao: 1, itens: rascunho });
    iniciar(async () => {
      const r = await salvarArranjo(novo);
      if (r.ok) {
        setSalvo(novo);
        setRascunho(null);
      } else {
        setErro('Não foi possível salvar o arranjo. Tente de novo.');
      }
    });
  }

  return (
    <div ref={caixa} className="p-grade">
      {!celular && (
        <div className="p-barra-config">
          {configurando ? (
            <>
              {escondidos.length > 0 && (
                <select aria-label="Adicionar quadro" value="" onChange={(e) => e.target.value && adicionar(e.target.value as WidgetId)}>
                  <option value="">Adicionar quadro…</option>
                  {escondidos.map((i) => <option key={i.id} value={i.id}>{CATALOGO[i.id].titulo}</option>)}
                </select>
              )}
              <button type="button" className="p-chip active" disabled={gravando} onClick={salvar}>{gravando ? 'Salvando…' : 'Salvar'}</button>
              <button type="button" className="p-chip" disabled={gravando} onClick={() => { setRascunho(null); setErro(null); }}>Cancelar</button>
            </>
          ) : (
            <button type="button" className="p-chip" onClick={() => setRascunho(salvo.itens)}>Configurar</button>
          )}
          {erro && <span role="alert" className="p-erro">{erro}</span>}
        </div>
      )}

      {celular ? (
        <div className="p-pilha">
          {arranjoParaCelular({ versao: 1, itens: salvo.itens }).map((i) => (
            <section key={i.id} className="p-quadro">{cabecalho(i.id)}<div className="p-quadro-corpo">{quadros[i.id]}</div></section>
          ))}
        </div>
      ) : (
        <GridLayout
          className="layout"
          width={largura!}
          cols={12}
          rowHeight={ALTURA_LINHA}
          margin={[14, 14]}
          layout={visiveis.map((i) => ({ i: i.id, x: i.x, y: i.y, w: i.w, h: i.h, minW: 2, minH: 2 }))}
          isDraggable={configurando}
          isResizable={configurando}
          draggableCancel="button, select, a"
          onLayoutChange={aoMudar}
        >
          {visiveis.map((i) => (
            <section key={i.id} className={`p-quadro${configurando ? ' p-editando' : ''}`}>
              {cabecalho(i.id)}
              <div className="p-quadro-corpo">{quadros[i.id]}</div>
            </section>
          ))}
        </GridLayout>
      )}
    </div>
  );
}
