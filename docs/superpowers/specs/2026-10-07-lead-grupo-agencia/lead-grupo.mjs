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
    if (!t.startsWith(String.fromCodePoint(0x1F464))) continue; // pessoa
    // Remove o emoji e qualquer seletor de variacao que venha depois, sem escrever caractere especial no codigo.
    return limparEspacos(t.replace(/^[^\p{L}\p{N}]+/u, ''));
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

const EMBRULHOS = ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension', 'documentWithCaptionMessage'];

// Mensagens temporarias e similares chegam embrulhadas em <embrulho>.message (ate 4 niveis).
function desembrulhar(message) {
  let atual = message && typeof message === 'object' ? message : {};
  for (let nivel = 0; nivel < 4; nivel++) {
    const chave = EMBRULHOS.find((k) => atual[k] && typeof atual[k] === 'object' && atual[k].message && typeof atual[k].message === 'object');
    if (!chave) break;
    atual = atual[chave].message;
  }
  return atual;
}

function textoDaMensagem(message) {
  const m = desembrulhar(message);
  return String(m.conversation || (m.extendedTextMessage && m.extendedTextMessage.text) || '').trim();
}

// Decide o que fazer com um evento bruto da Evolution: ignorar, criar o lead ou alertar o escritorio.
// So olha o grupo da agencia (grupoJid); qualquer outra coisa, inclusive conversa da equipe, e ignorada em silencio.
export function decidirAcao(corpo, grupoJid, instancia = 'escritorio') {
  const ignorar = (motivo) => ({ acao: 'ignorar', motivo });
  if (!corpo || typeof corpo !== 'object') return ignorar('payload_incompleto');
  if (String(corpo.event ?? '').toLowerCase().replace(/_/g, '.') !== 'messages.upsert') return ignorar('evento_nao_mensagem');
  if (String(corpo.instance ?? '') !== instancia) return ignorar('instancia_inesperada');
  const data = corpo.data && typeof corpo.data === 'object' ? corpo.data : null;
  const key = data && data.key && typeof data.key === 'object' ? data.key : null;
  if (!key) return ignorar('payload_incompleto');
  if (String(key.remoteJid ?? '') !== grupoJid) return ignorar('outro_chat');
  const leitura = lerCartaoLead(textoDaMensagem(data.message));
  const messageId = String(key.id ?? '');
  if (leitura.valido) return { acao: 'criar', messageId, lead: leitura.lead };
  if (leitura.motivo === 'nao_e_lead') return ignorar('nao_e_lead');
  return { acao: 'alertar', motivo: leitura.motivo, messageId };
}
