// Transforma a resposta da IA (formulario fechado) em uma decisao segura para a Central. Funcoes puras.
// O corpo (sem export) e gerado para o Code node do n8n por gerar-interpretar-node.mjs.

export function normalizarTelefone(t) {
  const bruto = String(t ?? '').trim();
  const d = bruto.replace(/\D/g, '');
  if (bruto.startsWith('+') && !d.startsWith('55')) return null;
  if (/^55\d{10,11}$/.test(d)) return '+' + d;
  if (/^\d{10,11}$/.test(d)) return '+55' + d;
  return null;
}

export function normalizarNumeroRegra(v) {
  if (typeof v === 'number') return Number.isInteger(v) && v >= 1 && v <= 999999999 ? v : null;
  const m = String(v ?? '').trim().match(/^(?:regra\s*)?#?\s*(\d{1,9})$/i);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 ? n : null;
}

export function normalizarPeriodo(v) {
  const t = String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  return ['hoje', 'semana', 'mes'].includes(t) ? t : null;
}

export function limparNome(v) {
  const t = String(v ?? '').replace(/\s+/g, ' ').trim();
  if (t.length < 2 || t.length > 60) return '';
  return /^[\p{L}][\p{L}' -]*$/u.test(t) ? t : '';
}
