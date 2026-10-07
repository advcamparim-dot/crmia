// lead-grupo.mjs
// Le o cartao "Novo Lead" que a agencia posta no grupo e devolve os campos normalizados.
// Sem import e sem dependencias: o corpo e copiado para um Code node do n8n (o "export " e removido).

const ROTULOS = {
  campanha: 'campanha',
  ondeDivida: 'onde esta a divida',
  valorDivida: 'valor da divida',
  situacao: 'situacao',
  tipo: 'tipo',
};

// Classe de combinantes montada por codigo (sem escape barra-u nem caractere invisivel literal).
const MARCAS = new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g');

function simplificar(texto) {
  return String(texto ?? '').normalize('NFD').replace(MARCAS, '').toLowerCase();
}

function limparEspacos(texto) {
  return String(texto ?? '').replace(/\s+/g, ' ').trim();
}

// Valor depois do primeiro ":" de uma linha cujo rotulo (sem emoji, acento e caixa) e o esperado.
function valorDoRotulo(linhas, rotulo) {
  for (const linha of linhas) {
    const i = linha.indexOf(':');
    if (i < 0) continue;
    const antes = simplificar(linha.slice(0, i)).replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
    if (antes === rotulo) return limparEspacos(linha.slice(i + 1));
  }
  return '';
}

export function normalizarTelefone(bruto) {
  let d = String(bruto ?? '').replace(/\D/g, '');
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) return '+' + d;
  if (d.length === 10 || d.length === 11) return '+55' + d;
  return '';
}

function nomeDoCartao(linhas) {
  for (const linha of linhas) {
    const t = linha.trim();
    if (!t.startsWith('\u{1F464}')) continue; // pessoa
    return limparEspacos(t.replace(/^\u{1F464}️?/u, ''));
  }
  return '';
}

export function lerCartaoLead(mensagem) {
  const texto = typeof mensagem === 'string' ? mensagem : '';
  if (!simplificar(texto).includes('novo lead')) return { valido: false, motivo: 'nao_e_lead' };
  const linhas = texto.split(/\r?\n/);

  const lead = { campanha: '', nome: nomeDoCartao(linhas), ondeDivida: '', valorDivida: '', situacao: '', tipo: '', telefone: '' };
  for (const [campo, rotulo] of Object.entries(ROTULOS)) lead[campo] = valorDoRotulo(linhas, rotulo);

  const brutoTel = valorDoRotulo(linhas, 'telefone');
  const link = (texto.match(/wa\.me\/(\+?\d+)/i) || [])[1] || '';
  if (!brutoTel && !link) return { valido: false, motivo: 'sem_telefone' };
  lead.telefone = normalizarTelefone(brutoTel) || normalizarTelefone(link);
  if (!lead.telefone) return { valido: false, motivo: 'telefone_invalido' };
  return { valido: true, lead };
}
