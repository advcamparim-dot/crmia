import { CATALOGO, IDS_DO_CATALOGO, ehWidgetId, type WidgetId } from './widgets';

export type Item = { id: WidgetId; x: number; y: number; w: number; h: number; oculto?: boolean };
export type Arranjo = { versao: 1; itens: Item[] };

const COLUNAS = 12;
const ALTURA_MAX = 40;
const Y_MAX = 1000;

export const ARRANJO_PADRAO: Arranjo = {
  versao: 1,
  itens: [
    { id: 'kpi-leads-novos', x: 0, y: 0, w: 2, h: 2 },
    { id: 'kpi-em-conversa', x: 2, y: 0, w: 2, h: 2 },
    { id: 'kpi-sem-resposta', x: 4, y: 0, w: 2, h: 2 },
    { id: 'kpi-followups', x: 6, y: 0, w: 2, h: 2 },
    { id: 'kpi-consultas', x: 8, y: 0, w: 2, h: 2 },
    { id: 'kpi-canal', x: 10, y: 0, w: 2, h: 2 },
    { id: 'fila', x: 0, y: 2, w: 7, h: 9 },
    { id: 'leads-por-etapa', x: 7, y: 2, w: 5, h: 5 },
    { id: 'followups-dia', x: 7, y: 7, w: 5, h: 4 },
    { id: 'fontes', x: 0, y: 11, w: 6, h: 5 },
    { id: 'tempo-resposta', x: 6, y: 11, w: 6, h: 5 },
    { id: 'analise-funil', x: 0, y: 16, w: 12, h: 4 },
    { id: 'kpi-contratos', x: 0, y: 22, w: 3, h: 2 },
    { id: 'kpi-receita-contratada', x: 3, y: 22, w: 4, h: 2 },
    { id: 'kpi-receita-recebida', x: 7, y: 22, w: 5, h: 2 },
    { id: 'parcelas', x: 0, y: 24, w: 12, h: 8 },
    { id: 'metas', x: 0, y: 32, w: 12, h: 7 },
    { id: 'previsao', x: 0, y: 39, w: 12, h: 8 },
  ],
};

function inteiro(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v);
}

function limitar(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}

function lerItem(bruto: unknown): Item | null {
  if (typeof bruto !== 'object' || bruto === null) return null;
  const o = bruto as Record<string, unknown>;
  if (!ehWidgetId(o.id) || !inteiro(o.x) || !inteiro(o.y) || !inteiro(o.w) || !inteiro(o.h)) return null;
  const w = limitar(o.w, 1, COLUNAS);
  const item: Item = {
    id: o.id,
    x: limitar(o.x, 0, COLUNAS - w),
    y: limitar(o.y, 0, Y_MAX),
    w,
    h: limitar(o.h, 1, ALTURA_MAX),
  };
  if (o.oculto === true) item.oculto = true;
  return item;
}

// Arranjo guardado pode estar estragado, antigo ou ter quadros que sairam do catalogo: nunca quebra a pagina.
export function normalizarArranjo(entrada: unknown): Arranjo {
  if (typeof entrada !== 'object' || entrada === null) return ARRANJO_PADRAO;
  const o = entrada as Record<string, unknown>;
  if (o.versao !== 1 || !Array.isArray(o.itens)) return ARRANJO_PADRAO;

  const vistos = new Set<WidgetId>();
  const itens: Item[] = [];
  for (const bruto of o.itens) {
    const item = lerItem(bruto);
    if (!item || vistos.has(item.id)) continue;
    vistos.add(item.id);
    itens.push(item);
  }

  let fundo = itens.reduce((m, i) => Math.max(m, i.y + i.h), 0);
  for (const id of IDS_DO_CATALOGO) {
    if (vistos.has(id)) continue;
    const { w, h } = CATALOGO[id];
    itens.push({ id, x: 0, y: fundo, w, h });
    fundo += h;
  }
  return { versao: 1, itens };
}

// Uma coluna: fila primeiro, depois a faixa de numeros, depois o resto na ordem de leitura. Escondidos ficam de fora.
export function arranjoParaCelular(a: Arranjo): Item[] {
  const visiveis = a.itens.filter((i) => !i.oculto);
  const leitura = (x: Item, y: Item) => x.y - y.y || x.x - y.x;
  const fila = visiveis.filter((i) => i.id === 'fila');
  const faixa = visiveis.filter((i) => i.id.startsWith('kpi-')).sort(leitura);
  const resto = visiveis.filter((i) => i.id !== 'fila' && !i.id.startsWith('kpi-')).sort(leitura);
  let y = 0;
  return [...fila, ...faixa, ...resto].map((i) => {
    const posto = { ...i, x: 0, y, w: COLUNAS };
    y += i.h;
    return posto;
  });
}
