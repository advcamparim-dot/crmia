export function chaveTelefone(telefone) {
  const d = String(telefone ?? '').replace(/\D/g, '');
  return /^55\d{10,11}$/.test(d) ? d.slice(2, 4) + d.slice(-8) : null;
}

export function normalizarTelefone(bruto) {
  const invalido = { ok: false, motivo: 'telefone_invalido' };
  if (typeof bruto !== 'string' && typeof bruto !== 'number') return invalido;
  const texto = String(bruto).trim();
  let d = texto.replace(/\D/g, '').replace(/^0+/, '');
  if (texto.startsWith('+') && !d.startsWith('55')) return invalido;
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) d = d.slice(2);
  else if (d.length !== 10 && d.length !== 11) return invalido;
  const ddd = d.slice(0, 2);
  const numero = d.slice(2);
  if (!/^[1-9][1-9]$/.test(ddd)) return invalido;
  if (numero.length === 9 && !numero.startsWith('9')) return invalido;
  if (numero.length === 8 && !/^[6-9]/.test(numero)) return invalido;
  const telefone = '+55' + d;
  return { ok: true, telefone, chave: chaveTelefone(telefone) };
}
