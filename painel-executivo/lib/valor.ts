// Valor em reais digitado no formato brasileiro ("50.000,50", "R$ 1.234,56", "12,5", "50000").
export function lerValorBR(texto: string | null | undefined): number | null {
  if (typeof texto !== 'string') return null;
  const t = texto.replace(/r\$/gi, '').replace(/\s+/g, '');
  if (!t) return null;
  let n: number;
  if (t.includes(',')) {
    if (!/^\d{1,3}(\.\d{3})*,\d{1,2}$|^\d+,\d{1,2}$/.test(t)) return null;
    n = Number(t.replace(/\./g, '').replace(',', '.'));
  } else if (t.includes('.')) {
    if (!/^\d{1,3}(\.\d{3})+$/.test(t)) return null;
    n = Number(t.replace(/\./g, ''));
  } else {
    if (!/^\d+$/.test(t)) return null;
    n = Number(t);
  }
  return Number.isFinite(n) ? n : null;
}
