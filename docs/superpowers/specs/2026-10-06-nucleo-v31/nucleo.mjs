// nucleo.mjs
// Logica deterministica da trava de perguntas repetidas do Nucleo V3.1.
// Sem import e sem dependencias: o corpo e copiado para Code nodes do n8n (o "export " e removido).

// Classe de combinantes montada por codigo (sem escape barra-u nem caractere invisivel literal).
const MARCAS = new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g');

function limpar(texto) {
  return String(texto ?? '').normalize('NFD').replace(MARCAS, '').toLowerCase();
}

export function ultimaPergunta(texto) {
  const t = String(texto ?? '').trim();
  const i = t.lastIndexOf('?');
  if (i < 0) return null;
  if (/[\p{L}\p{N}]/u.test(t.slice(i + 1))) return null;
  const antes = t.slice(0, i);
  const inicio = Math.max(antes.lastIndexOf('.'), antes.lastIndexOf('!'), antes.lastIndexOf('\n')) + 1;
  const pergunta = t.slice(inicio, i + 1).trim();
  return pergunta.length > 1 ? pergunta : null;
}

const TOPICOS = [
  ['judicial', /(process|judicial|execuc|citac|intimac|notificac|protest|negativ|cobranca)/],
  ['renegociacao', /(renegoci|negoci)/],
  ['documento', /(cnpj|cpf)/],
  ['valor', /(valor|quanto)/],
  ['outros_contratos', /outros (contratos|dividas)/],
  ['causa', /(por que|motivo|causa|faturamento)/],
  ['banco', /(banco|instituicao)/],
];

export function topicoPergunta(pergunta) {
  const t = limpar(pergunta);
  for (const [nome, re] of TOPICOS) if (re.test(t)) return nome;
  return 'outro';
}

const NAO_RESPOSTA = new Set(['oi', 'ola', 'opa', 'e', 'ai', 'bom', 'dia', 'boa', 'tarde', 'noite', 'ok', 'okay', 'certo', 'blz', 'beleza', 'tudo', 'bem', 'obrigado', 'obrigada', 'valeu', 'hum', 'hmm', 'ahn']);

export function naoRespondeu(mensagem) {
  const palavras = limpar(mensagem).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  return palavras.every((p) => NAO_RESPOSTA.has(p));
}

export function contarSeguidas(ultimasIa, topico) {
  const lista = Array.isArray(ultimasIa) ? ultimasIa : [];
  let n = 0;
  for (const msg of lista) {
    const p = ultimaPergunta(msg);
    if (p && topicoPergunta(p) === topico) n++;
    else break;
  }
  return n;
}

export function estadoPergunta(ultimasIa) {
  const lista = Array.isArray(ultimasIa) ? ultimasIa : [];
  const p = ultimaPergunta(lista[0]);
  if (!p) return 'Sem pergunta pendente: sua última mensagem não terminou com uma pergunta (ou ainda não houve mensagem sua).';
  const n = contarSeguidas(lista, topicoPergunta(p));
  const vezes = n === 1 ? 'já foi feita 1 vez.' : 'já foi feita ' + n + ' vezes seguidas.';
  return 'PERGUNTA PENDENTE: sua última mensagem terminou com: «' + p + '»\n'
    + 'Essa pergunta (ou uma sobre o mesmo assunto) ' + vezes + '\n'
    + 'Se a mensagem atual da pessoa não respondeu a essa pergunta, não faça nenhuma pergunta nesta resposta: responda só ao que ela disse, em uma frase curta, e pare.';
}

export function deveBloquearRepeticao({ saida, entrada, ultimasIa }) {
  const lista = Array.isArray(ultimasIa) ? ultimasIa : [];
  const nova = ultimaPergunta(saida);
  if (!nova) return false;
  const topico = topicoPergunta(nova);
  if (topico === 'outro') return false;
  if (naoRespondeu(entrada)) {
    // a pessoa nao respondeu: nao volta a um assunto ja perguntado nas ultimas 6 mensagens
    const recentes = lista.slice(0, 6).filter((m) => {
      const p = ultimaPergunta(m);
      return p !== null && topicoPergunta(p) === topico;
    }).length;
    return recentes >= 1;
  }
  return contarSeguidas(lista, topico) >= 2;
}

export function primeiroNome(fatos) {
  const f = fatos && typeof fatos === 'object' ? fatos : {};
  const nome = String(f.nomeCompleto || f.nomeLead || f.nome || '').trim().split(/\s+/)[0] || '';
  return nome ? nome.charAt(0).toUpperCase() + nome.slice(1) : '';
}

export function fallbackSemPergunta(entrada, fatos) {
  const t = limpar(entrada);
  let saudacao = 'Certo';
  if (t.includes('bom dia')) saudacao = 'Bom dia';
  else if (t.includes('boa tarde')) saudacao = 'Boa tarde';
  else if (t.includes('boa noite')) saudacao = 'Boa noite';
  else if (/^(oi|ola|opa)\b/.test(t)) saudacao = 'Oi';
  const nome = primeiroNome(fatos);
  return saudacao + (nome ? ', ' + nome : '') + '! Estou por aqui. Pode me contar com calma, no seu tempo.';
}
