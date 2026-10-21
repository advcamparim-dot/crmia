// aquecimento.mjs
// Regra de aquecimento do Nucleo V3.1: a Mayara so oferece a consulta por iniciativa propria depois de
// MINIMO_RESPOSTAS respostas do lead, salvo pedido do lead ou sinal judicial duro (execucao, penhora, bloqueio...).
// Sem import e sem dependencias: o corpo e copiado para Code nodes do n8n (o "export " e removido).

const MARCAS = new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g');

function limpar(texto) {
  return String(texto ?? '').normalize('NFD').replace(MARCAS, '').toLowerCase();
}
// <<corpo>>
export const MINIMO_RESPOSTAS = 4;

const OFERTA = /(posso (verificar|ver|checar|agendar|marcar)|verificar um horario|ver um horario|tenho (amanha|hoje|segunda|terca|quarta|quinta|sexta)|(agendar|marcar) (uma |a )?consulta|consulta (e |eh )?(online e )?gratuita|horario (pra|para) voces)/;
const PEDIDO = /(marcar|agendar|agenda|horario|consulta|reuniao|advogado|doutor|dr\.? ?santo|falar com|conversar com|quero|pode ser|topo|vamos|bora)/;
const SINAL_DURO = /(execuc|executad|penhor|bloque|citad|citac|intimac|oficial de justica|leilao|recuperacao judicial|falencia|busca e apreensao)/;

export function ofereceConsulta(texto) {
  return OFERTA.test(limpar(texto));
}

export function pediuOuAceitou(entrada) {
  return PEDIDO.test(limpar(entrada));
}

export function sinalJudicialDuro(entrada) {
  return SINAL_DURO.test(limpar(entrada));
}

export function textoAquecimento(respostasAnteriores) {
  const n = Number(respostasAnteriores || 0) + 1;
  if (n >= MINIMO_RESPOSTAS) {
    return 'AQUECIMENTO: mínimo atingido (' + n + ' respostas do lead). Você pode propor a consulta se, pela regra NÃO AGENDE CEDO DEMAIS, o Dr. Santo já entenderia por que a pessoa busca ajuda agora.';
  }
  return 'AQUECIMENTO: o lead respondeu ' + n + ' de ' + MINIMO_RESPOSTAS + ' vezes. Não ofereça nem proponha horário ou consulta nesta resposta, salvo se o lead pedir para marcar, pedir para falar com o advogado, aceitar, ou disser literalmente que há execução, penhora, bloqueio ou citação. Continue a conversa: reconheça o fato que ele disse e faça UMA pergunta da lacuna prioritária.';
}

export function deveSegurarOferta({ saida, entrada, respostasAnteriores, ultimasIa, ultimasLead }) {
  if (Number(respostasAnteriores || 0) + 1 >= MINIMO_RESPOSTAS) return false;
  if (!ofereceConsulta(saida)) return false;
  if (pediuOuAceitou(entrada) || sinalJudicialDuro(entrada)) return false;
  // o lead ja disse, em mensagem anterior, que ha execucao/penhora/bloqueio: a Mayara ja acolheu, agora pode oferecer
  if ((Array.isArray(ultimasLead) ? ultimasLead : []).some((m) => sinalJudicialDuro(m))) return false;
  const lista = Array.isArray(ultimasIa) ? ultimasIa : [];
  if (lista.length > 0 && ofereceConsulta(lista[0])) return false;
  return true;
}

function frases(texto) {
  return String(texto ?? '')
    .replace(/\bDr\.\s/g, 'Dr§ ')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.replace(/Dr§ /g, 'Dr. ').trim())
    .filter(Boolean);
}

function proximaPergunta(entrada, fatos) {
  const f = fatos && typeof fatos === 'object' ? fatos : {};
  const e = limpar(entrada);
  if (/(judicial|process)/.test(e) && !sinalJudicialDuro(e)) return 'Você já foi citado nesse processo?';
  if (!f.causaEconomica) return 'O que levou a empresa a essa situação com o banco?';
  if (typeof f.tentativaRenegociacao === 'undefined') return 'Vocês já tentaram renegociar com o banco?';
  if (typeof f.outrosContratosOuDividas === 'undefined') return 'Existe algum outro contrato ou dívida com banco além desse?';
  return 'Tem mais alguma coisa pesando nessa situação que você queira me contar?';
}

export function tirarOferta(saida, entrada, fatos) {
  const resto = frases(saida).filter((s) => !ofereceConsulta(s));
  const texto = resto.join(' ').trim();
  if (texto.includes('?')) return texto;
  const pergunta = proximaPergunta(entrada, fatos);
  return texto ? texto + ' ' + pergunta : pergunta;
}
