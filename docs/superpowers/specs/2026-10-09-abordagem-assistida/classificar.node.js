// central-comando.mjs
// Biblioteca da Central de Comando. Sem import e sem dependencias: o corpo e copiado
// para Code nodes do n8n (gerar-node.mjs remove o "export ").

const MARCAS_COMBINANTES = new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g');

function semAcento(s) {
  return String(s ?? '').normalize('NFD').replace(MARCAS_COMBINANTES, '');
}

function normalizarTelefone(texto) {
  const d = String(texto ?? '').replace(/\D/g, '');
  if (/^55\d{10,11}$/.test(d)) return '+' + d;
  if (/^\d{10,11}$/.test(d)) return '+55' + d;
  return null;
}

const AJUDA = [
  'Comandos:',
  '/status: situação da Mayara',
  '/ligar e /desligar: liga ou desliga a Mayara para todos os leads',
  '/assumir +5514999990000: a Mayara para de responder esse lead',
  '/devolver +5514999990000: a Mayara volta a atender esse lead',
  '/regras: instruções ativas',
  '/desfazer 3: desativa a instrução 3',
  '/reativar 3: reativa a instrução 3',
  '/ajuda: esta lista',
  'No modo exclusivo, escreva livremente para ensinar a Mayara e responda sim ou não para confirmar.',
].join('\n');

const COMANDOS = ['status', 'ligar', 'desligar', 'assumir', 'devolver', 'regras', 'desfazer', 'reativar', 'ajuda'];
const SIM = ['sim', 's', 'confirmo', 'confirma', 'confirmar', 'pode', 'isso'];
const NAO = ['nao', 'n', 'cancela', 'cancelar', 'descarta', 'descartar'];

function sql(acao, arg = '') {
  return { tipo: 'sql', acao, fn: acao, arg, arg2: '' };
}

function comando(cmd, args) {
  switch (cmd) {
    case 'ajuda': return { tipo: 'texto', acao: 'ajuda', resposta: AJUDA };
    case 'status': return { tipo: 'status', acao: 'status' };
    case 'ligar': return { tipo: 'modo', acao: 'ligar', aiMode: 'active' };
    case 'desligar': return { tipo: 'modo', acao: 'desligar', aiMode: 'paused' };
    case 'regras': return sql('regras');
    case 'assumir':
    case 'devolver': {
      const tel = normalizarTelefone(args);
      if (!tel) return { tipo: 'texto', acao: cmd + '_invalido', resposta: 'Número inválido. Use /' + cmd + ' +5514999990000 (com DDD).' };
      return sql(cmd, tel);
    }
    case 'desfazer':
    case 'reativar': {
      if (!/^\d{1,9}$/.test(args)) return { tipo: 'texto', acao: cmd + '_invalido', resposta: 'Use /' + cmd + ' <número>. Veja os números em /regras.' };
      return sql(cmd, args);
    }
    default: return { tipo: 'texto', acao: 'comando_desconhecido', resposta: 'Não conheci esse comando.\n\n' + AJUDA };
  }
}

function classificarMensagem(texto, { exclusivo = false, ctx = {} } = {}) {
  const t = String(texto ?? '').trim();
  if (t.startsWith('/')) {
    const m = t.match(/^\/([^\s]*)\s*([\s\S]*)$/);
    const cmd = semAcento(m ? m[1] : '').toLowerCase();
    const args = m ? m[2].trim() : '';
    if (!COMANDOS.includes(cmd)) {
      return { tipo: 'texto', acao: 'comando_desconhecido', resposta: 'Não conheci esse comando.\n\n' + AJUDA };
    }
    return comando(cmd, args);
  }
  const norm = semAcento(t).toLowerCase().replace(/[^a-z\s]/g, '').trim();
  const base = semAcento(t).toLowerCase().trim();
  const proposta = (op, id, texto = '') => ({ tipo: 'proposta', acao: 'proposta_' + op, op, id, texto });

  const aprovar = base.match(/^(?:sim|s)\s+#?(\d{1,9})$/);
  if (aprovar) return proposta('aprovar', Number(aprovar[1]));
  const descartar = base.match(/^(?:nao|n)\s+#?(\d{1,9})$/);
  if (descartar) return proposta('descartar', Number(descartar[1]));
  const editar = t.match(/^editar\s+#?(\d{1,9})\s*[:\-]\s*([\s\S]+)$/i);
  if (editar) return proposta('editar', Number(editar[1]), editar[2].trim());
  if (/^propostas?$/.test(base)) return proposta('listar', null);

  const confirmacao = SIM.includes(norm) ? 'aprovar' : NAO.includes(norm) ? 'descartar' : '';
  const contexto = ctx && typeof ctx === 'object' ? ctx : {};
  if (confirmacao && !contexto.pendente && !contexto.acao_pendente) {
    if (contexto.proposta_unica) return proposta(confirmacao, Number(contexto.proposta_unica));
    if (Number(contexto.propostas_abertas) > 1) {
      return { tipo: 'texto', acao: 'proposta_ambigua',
        resposta: 'Há ' + contexto.propostas_abertas + ' propostas abertas. Responda sim <número> ou não <número>. Para ver a lista, envie: propostas' };
    }
  }
  if (SIM.includes(norm)) return sql('confirmar_sim');
  if (NAO.includes(norm)) return sql('confirmar_nao');
  if (exclusivo && t) return { tipo: 'livre', acao: 'ensino', texto: t };
  return { tipo: 'texto', acao: 'ignorado', resposta: 'Esse canal aceita comandos que começam com /. Envie /ajuda.' };
}

const CONFLITOS = [
  { motivo: 'prometer resultado, desconto ou êxito',
    re: /\b(prometa|garanta|assegure)\b|desconto\s+(de\s+)?\d+\s*%|\d+\s*%\s+de\s+desconto|garantia\s+de\s+(resultado|[eê]xito)/i },
  { motivo: 'dar opinião jurídica sobre o caso',
    re: /opini[aã]o\s+jur[ií]dica|diga\s+(ao|para\s+o|pro)\s+cliente\s+que\s+(ele\s+)?(tem|vai\s+ter)\s+(direito|chance)|cl[aá]usulas?\s+abusivas?|juros\s+abusivos/i },
  { motivo: 'esconder que é um atendimento automático',
    re: /\bfinja\b|diga\s+que\s+(voc[eê]\s+)?(é|e)\s+(uma\s+)?(pessoa|humana|humano|advogada|advogado)|n[aã]o\s+(diga|revele|conte)\s+que\s+(voc[eê]\s+)?(é|e)\s+(uma\s+)?(ia|rob[oô]|intelig[eê]ncia\s+artificial)/i },
  { motivo: 'contrariar as regras fixas de segurança',
    re: /\b(ignore|desconsidere|esque[cç]a)\b\s+(todas\s+)?(as\s+)?(regras|proibi[cç][oõ]es|instru[cç][oõ]es|orienta[cç][oõ]es)/i },
  { motivo: 'orientar movimentação de patrimônio',
    re: /\b(oriente|ajude|sugira|ensine|aconselhe)\b.{0,60}\b(ocultar|esconder|transferir|passar)\b.{0,40}\b(bens|patrim[oô]nio)/i },
  { motivo: 'pedir documentos sensíveis na triagem',
    re: /\b(pe[cç]a|solicite|exija)\b.{0,40}\b(contrato|extratos?|cnpj\s+completo|senha)/i },
  { motivo: 'orientar sobre recuperação judicial ou falência',
    re: /\b(oriente|aconselhe|explique|ensine)\b.{0,60}\b(recupera[cç][aã]o\s+judicial|fal[eê]ncia)/i },
  { motivo: 'ignorar o protocolo de risco pessoal',
    re: /\b(ignore|desconsidere|n[aã]o\s+(fale|mencione))\b.{0,40}\b(cvv|risco\s+pessoal|suic[ií]dio)/i },
];

function negadoAntes(texto, idx) {
  // A negacao so vale se estiver colada ao verbo (no maximo uma palavra no meio) e na mesma frase.
  const antes = texto.slice(0, idx);
  return /(?:^|[\s,;:.!?])(?:n[aã]o|nunca|jamais|evite|proibido|nem)\s+(?:[^\s,;:.!?]+\s+)?$/i.test(antes);
}

function checarConflito(regra) {
  const t = String(regra ?? '');
  for (const c of CONFLITOS) {
    const re = new RegExp(c.re.source, 'gi');
    let m;
    while ((m = re.exec(t)) !== null) {
      if (!negadoAntes(t, m.index)) return { conflito: true, motivo: c.motivo };
      if (m[0].length === 0) re.lastIndex++;
    }
  }
  return { conflito: false };
}

function limparRegra(texto) {
  return String(texto ?? '').replace(/\{\{|\}\}/g, '').replace(/\s+/g, ' ').trim();
}

function interpretarRespostaIA(texto) {
  const duvida = { tipo: 'duvida', pergunta: 'Não consegui entender. Pode escrever a instrução de outro jeito?' };
  const bruto = String(texto ?? '').replace(/```(?:json)?/gi, '').trim();
  const ini = bruto.indexOf('{');
  const fim = bruto.lastIndexOf('}');
  if (ini < 0 || fim <= ini) return duvida;
  try {
    const o = JSON.parse(bruto.slice(ini, fim + 1));
    if (['instrucao', 'duvida', 'pergunta'].includes(o.tipo)) return o;
  } catch (e) { /* cai na duvida */ }
  return duvida;
}

function recusarEnsino(motivo) {
  return { tipo: 'texto', acao: 'ensino_recusado',
    resposta: 'Não posso ativar isso: ' + motivo + '. Essas regras ficam fixas por segurança. Se quiser, reescreva a instrução sem esse ponto.' };
}

function montarResultadoEnsino(saida, original) {
  const orig = String(original ?? '').trim();
  const previo = checarConflito(orig);
  if (previo.conflito) return recusarEnsino(previo.motivo);
  if (saida.tipo === 'instrucao') {
    const regra = limparRegra(saida.regra);
    if (!regra) {
      return { tipo: 'texto', acao: 'ensino_duvida', resposta: 'Não consegui entender a instrução. Pode escrever de outro jeito?' };
    }
    const c = checarConflito(regra + ' ' + orig);
    if (c.conflito) return recusarEnsino(c.motivo);
    return { tipo: 'sql', acao: 'ensino', fn: 'criar_pendente', arg: regra, arg2: orig.slice(0, 1000) };
  }
  if (saida.tipo === 'duvida') {
    return { tipo: 'texto', acao: 'ensino_duvida', resposta: String(saida.pergunta || 'Pode explicar melhor o que você quer que eu mude?') };
  }
  return { tipo: 'texto', acao: 'ensino_ignorado', resposta: 'Por enquanto só entendo comandos e instruções de atendimento. Envie /ajuda.' };
}


const entrada = $('Execute Workflow Trigger').first().json;
const ctx = $input.first().json.ctx || {};
const r = classificarMensagem(entrada.message, { exclusivo: ctx.exclusivo === true, ctx });
return [{ json: { ...r, phone: entrada.phone, message: entrada.message, messageId: entrada.messageId, phoneNumberId: entrada.phoneNumberId } }];
