// evolucao.mjs
// Normaliza o webhook MESSAGES_UPSERT da Evolution API para o evento normalizado do Gateway.
// Sem import e sem dependencias: o corpo e copiado para um Code node do n8n (o "export " e removido).

const TIPOS_IGNORADOS = ['reactionMessage', 'protocolMessage', 'editedMessage', 'senderKeyDistributionMessage', 'messageContextInfo'];
const TIPOS_MIDIA = ['audioMessage', 'imageMessage', 'documentMessage', 'stickerMessage', 'videoMessage', 'ptvMessage', 'contactMessage', 'locationMessage'];

export function extrairTexto(message) {
  const m = message && typeof message === 'object' ? message : {};
  const texto = m.conversation
    || (m.extendedTextMessage && m.extendedTextMessage.text)
    || (m.buttonsResponseMessage && m.buttonsResponseMessage.selectedDisplayText)
    || (m.listResponseMessage && m.listResponseMessage.title)
    || (m.templateButtonReplyMessage && m.templateButtonReplyMessage.selectedDisplayText)
    || '';
  return String(texto).trim();
}

function nomeDoEvento(e) {
  return String(e ?? '').toLowerCase().replace(/_/g, '.');
}

function telefoneDoJid(jid) {
  const s = String(jid ?? '');
  if (!s.endsWith('@s.whatsapp.net')) return '';
  const digitos = s.split('@')[0].split(':')[0].replace(/\D/g, '');
  return digitos.length >= 10 && digitos.length <= 15 ? digitos : '';
}

function descartar(motivo) {
  return { acao: 'descartar', motivo };
}

function paraIso(ts) {
  const n = Number(ts && typeof ts === 'object' ? ts.low : ts);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : new Date().toISOString();
}

const EMBRULHOS = ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension', 'documentWithCaptionMessage'];
const PREFIXO_MAYARA = '*Mayara:*';

// Mensagens temporarias, de visualizacao unica e documento com legenda chegam embrulhadas em
// <embrulho>.message. Desembrulha ate 4 niveis (protecao contra payload ciclico ou absurdo).
function desembrulhar(message) {
  let atual = message && typeof message === 'object' ? message : {};
  for (let nivel = 0; nivel < 4; nivel++) {
    const chave = EMBRULHOS.find((k) => atual[k] && typeof atual[k] === 'object' && atual[k].message && typeof atual[k].message === 'object');
    if (!chave) break;
    atual = atual[chave].message;
  }
  return atual;
}

export function normalizarEvolution(corpo, instanciaEsperada = 'escritorio') {
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) return descartar('payload_incompleto');
  if (nomeDoEvento(corpo.event) !== 'messages.upsert') return descartar('evento_nao_mensagem');
  if (String(corpo.instance ?? '') !== instanciaEsperada) return descartar('instancia_inesperada');
  const data = corpo.data && typeof corpo.data === 'object' ? corpo.data : null;
  const key = data && data.key && typeof data.key === 'object' ? data.key : null;
  if (!key) return descartar('payload_incompleto');
  const jid = String(key.remoteJid ?? '');
  if (jid.endsWith('@g.us')) return descartar('grupo');
  if (jid === 'status@broadcast') return descartar('status');
  if (jid.endsWith('@newsletter')) return descartar('newsletter');
  const message = desembrulhar(data.message);
  const tipos = Object.keys(message);
  const texto = extrairTexto(message);
  const ehMidia = tipos.some((t) => TIPOS_MIDIA.includes(t));
  if (!texto && !ehMidia && tipos.some((t) => TIPOS_IGNORADOS.includes(t))) return descartar('tipo_ignorado');
  let digitos = telefoneDoJid(jid);
  if (!digitos && jid.endsWith('@lid')) {
    digitos = telefoneDoJid(key.remoteJidAlt);
    if (!digitos) return descartar('lid_sem_telefone');
  }
  const messageId = String(key.id ?? '');
  if (!digitos || !messageId) return descartar('payload_incompleto');
  const phone = '+' + digitos;
  const canalId = instanciaEsperada;
  if (key.fromMe === true) {
    // Enviada pelo numero do escritorio: se for da propria Mayara (prefixo), ignora; senao um humano respondeu.
    if (texto.startsWith(PREFIXO_MAYARA)) return descartar('enviada_por_mim');
    return { acao: 'humano', canalId, phone, messageId };
  }
  const requiresHuman = !texto && (ehMidia || tipos.length === 0 || !tipos.some((t) => TIPOS_IGNORADOS.includes(t)));
  if (!texto && !requiresHuman) return descartar('tipo_ignorado');
  const tipoMsg = texto ? 'text' : String(tipos.find((t) => TIPOS_MIDIA.includes(t)) || data.messageType || tipos[0] || 'unknown');
  return {
    acao: 'processar',
    evento: {
      accepted: true, reason: 'ACEITO', channel: 'WhatsApp', provedor: 'evolution',
      phone, profileName: String(data.pushName ?? ''), message: texto, messageType: tipoMsg,
      messageId, timestamp: paraIso(data.messageTimestamp),
      phoneNumberId: canalId, canalId, displayPhoneNumber: '',
      sessionKey: 'whatsapp:' + canalId + ':' + phone, dedupeKey: messageId,
      campaignSourceId: '', campaignSourceUrl: '', campaignHeadline: '',
      requiresHuman, processingBlocked: true,
    },
  };
}

export function ehEventoDeEstado(corpo) {
  return !!corpo && typeof corpo === 'object' && !Array.isArray(corpo) && nomeDoEvento(corpo.event) === 'connection.update';
}

export function extrairEstado(corpo, instanciaEsperada = 'escritorio') {
  if (!ehEventoDeEstado(corpo)) return { valido: false, motivo: 'evento_nao_estado' };
  if (String(corpo.instance ?? '') !== instanciaEsperada) return { valido: false, motivo: 'instancia_inesperada' };
  const data = corpo.data && typeof corpo.data === 'object' ? corpo.data : {};
  const estado = String(data.state ?? '').toLowerCase();
  if (estado !== 'open' && estado !== 'connecting' && estado !== 'close') return { valido: false, motivo: 'estado_desconhecido' };
  return { valido: true, canalId: instanciaEsperada, estado };
}
