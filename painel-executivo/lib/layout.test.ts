import { describe, expect, it } from 'vitest';
import { CATALOGO, type WidgetId } from './widgets';
import { ARRANJO_PADRAO, arranjoParaCelular, normalizarArranjo } from './layout';

const ids = Object.keys(CATALOGO) as WidgetId[];

describe('normalizarArranjo', () => {
  it('JSON inválido devolve o padrão', () => {
    for (const ruim of [null, undefined, 'x', 42, [], { versao: 1 }, { versao: 1, itens: 'x' }]) {
      expect(normalizarArranjo(ruim)).toEqual(ARRANJO_PADRAO);
    }
  });

  it('versão desconhecida devolve o padrão', () => {
    expect(normalizarArranjo({ versao: 2, itens: [{ id: 'fila', x: 0, y: 0, w: 4, h: 4 }] })).toEqual(ARRANJO_PADRAO);
  });

  it('id desconhecido é descartado e o resto fica', () => {
    const r = normalizarArranjo({ versao: 1, itens: [{ id: 'fila', x: 0, y: 0, w: 4, h: 4 }, { id: 'quadro-que-sumiu', x: 4, y: 0, w: 2, h: 2 }] });
    expect(r.itens.map((i) => i.id)).not.toContain('quadro-que-sumiu');
    expect(r.itens.find((i) => i.id === 'fila')).toMatchObject({ x: 0, y: 0, w: 4, h: 4 });
  });

  it('quadro novo do catálogo aparece no fim, com o tamanho padrão', () => {
    const r = normalizarArranjo({ versao: 1, itens: [{ id: 'fila', x: 0, y: 0, w: 4, h: 4 }] });
    expect(r.itens.map((i) => i.id).sort()).toEqual([...ids].sort());
    const novo = r.itens.find((i) => i.id === 'fontes')!;
    expect(novo.w).toBe(CATALOGO.fontes.w);
    expect(novo.h).toBe(CATALOGO.fontes.h);
    expect(novo.y).toBeGreaterThanOrEqual(4);
  });

  it('id repetido fica uma vez só e item com número ruim é ignorado', () => {
    const r = normalizarArranjo({
      versao: 1,
      itens: [{ id: 'fila', x: 0, y: 0, w: 4, h: 4 }, { id: 'fila', x: 6, y: 6, w: 3, h: 3 }, { id: 'fontes', x: 'a', y: 0, w: 2, h: 2 }],
    });
    expect(r.itens.filter((i) => i.id === 'fila')).toHaveLength(1);
    expect(r.itens.filter((i) => i.id === 'fontes')).toHaveLength(1);
    expect(r.itens.find((i) => i.id === 'fontes')!.w).toBe(CATALOGO.fontes.w);
  });

  it('coloca dentro da grade de 12 colunas um quadro que passa da borda', () => {
    const r = normalizarArranjo({ versao: 1, itens: [{ id: 'fila', x: 10, y: 0, w: 6, h: 3 }] });
    const f = r.itens.find((i) => i.id === 'fila')!;
    expect(f.x + f.w).toBeLessThanOrEqual(12);
  });

  it('mantém o quadro escondido', () => {
    const r = normalizarArranjo({ versao: 1, itens: [{ id: 'fontes', x: 0, y: 0, w: 3, h: 3, oculto: true }] });
    expect(r.itens.find((i) => i.id === 'fontes')!.oculto).toBe(true);
  });

  it('um arranjo válido e completo sai igual', () => {
    expect(normalizarArranjo(ARRANJO_PADRAO)).toEqual(ARRANJO_PADRAO);
  });
});

describe('ARRANJO_PADRAO', () => {
  it('tem todos os quadros do catálogo, sem repetir e sem passar de 12 colunas', () => {
    expect(ARRANJO_PADRAO.versao).toBe(1);
    expect(ARRANJO_PADRAO.itens.map((i) => i.id).sort()).toEqual([...ids].sort());
    for (const i of ARRANJO_PADRAO.itens) expect(i.x + i.w).toBeLessThanOrEqual(12);
  });

  it('põe a faixa de números no topo e a fila logo abaixo, à esquerda', () => {
    const faixa = ['kpi-leads-novos', 'kpi-em-conversa', 'kpi-sem-resposta', 'kpi-followups', 'kpi-consultas', 'kpi-canal'];
    const topo = ARRANJO_PADRAO.itens.filter((i) => faixa.includes(i.id));
    expect(topo).toHaveLength(6);
    expect(topo.every((i) => i.y === 0)).toBe(true);
    const fila = ARRANJO_PADRAO.itens.find((i) => i.id === 'fila')!;
    expect(fila.x).toBe(0);
    expect(fila.y).toBeGreaterThan(0);
  });
});

describe('arranjoParaCelular', () => {
  it('põe a fila primeiro, depois a faixa, e deixa uma coluna', () => {
    const r = arranjoParaCelular(ARRANJO_PADRAO);
    expect(r[0].id).toBe('fila');
    expect(r.slice(1, 7).every((i) => i.id.startsWith('kpi-'))).toBe(true);
    expect(r.every((i) => i.x === 0 && i.w === 12)).toBe(true);
  });

  it('empilha sem sobrepor e deixa de fora os escondidos', () => {
    const a = { versao: 1 as const, itens: ARRANJO_PADRAO.itens.map((i) => (i.id === 'fontes' ? { ...i, oculto: true } : i)) };
    const r = arranjoParaCelular(a);
    expect(r.find((i) => i.id === 'fontes')).toBeUndefined();
    for (let k = 1; k < r.length; k++) expect(r[k].y).toBe(r[k - 1].y + r[k - 1].h);
  });
});
