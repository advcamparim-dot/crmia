// gerar-patch.mjs: aplica a regra de aquecimento ao Nucleo V3.1 (workflow vivo yWPXunb0uMWjFaDz) e ao prompt em texto.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));

function trocar(texto, de, para, rotulo) {
  if (!texto.includes(de)) throw new Error('trecho nao encontrado: ' + (rotulo || de.slice(0, 60)));
  if (texto.split(de).length > 2) throw new Error('trecho repetido: ' + (rotulo || de.slice(0, 60)));
  return texto.replace(de, () => para);
}

export function corpoAquecimento() {
  const src = readFileSync(join(dir, 'aquecimento.mjs'), 'utf8');
  const i = src.indexOf('// <<corpo>>');
  if (i < 0) throw new Error('marcador <<corpo>> ausente');
  return src.slice(i + '// <<corpo>>'.length).replace(/^export\s+/gm, '').trim();
}

export function novoPrompt(prompt) {
  let p = prompt;
  p = trocar(p,
    'Exemplo errado: cliente parou de responder → não grave que ele perdeu o interesse. A ausência de resposta não é um fato sobre a opinião dele.',
    'Exemplo errado: cliente parou de responder → não grave que ele perdeu o interesse. A ausência de resposta não é um fato sobre a opinião dele.\nExemplo errado: cliente disse apenas "judicial" ou "tem processo" → não grave `situacaoJudicial: execução` nem `urgencia: alta`. Grave `notificacaoOrigem: judicial` e pergunte em que fase está (por exemplo, se já foi citado). Só grave execução, penhora, bloqueio ou citação quando o cliente disser isso com essas palavras ou equivalentes.',
    'fato-inferencia');
  p = trocar(p,
    '- execução judicial confirmada, citação, intimação, oficial de justiça, bloqueio, penhora, apreensão/busca de bens, leilão, recuperação judicial, falência, ou situação patrimonial concreta ligada a processo;',
    '- execução judicial, citação, intimação, oficial de justiça, bloqueio, penhora, apreensão/busca de bens, leilão, recuperação judicial, falência, ou situação patrimonial concreta ligada a processo, SEMPRE confirmados pelo próprio cliente com essas palavras ou equivalentes. Dizer apenas "judicial" ou "tem processo" NÃO é sinal duro: nesse caso acolha em uma frase e pergunte a fase (por exemplo, "Você já foi citado nesse processo?");',
    'stop-lista');
  p = trocar(p, '- já existe informação suficiente para propor a consulta.\n', '', 'stop-informacao-suficiente');
  p = trocar(p,
    'Exemplo: "Entendi. Como já existe execução e o oficial de justiça chegou a comparecer, o Dr. Santo precisa analisar o processo e os documentos antes de qualquer orientação. Posso verificar um horário para vocês conversarem?"',
    'Faça em dois tempos. Primeira mensagem, só acolhe, sem oferta e sem pergunta: "Entendi. Como já existe execução e o oficial de justiça chegou a comparecer, o Dr. Santo precisa analisar o processo e os documentos antes de qualquer orientação." Na mensagem seguinte, depois que o cliente responder, ofereça: "Posso verificar um horário para vocês conversarem?"',
    'stop-exemplo');
  p = trocar(p,
    'NÃO AGENDE CEDO DEMAIS\n\n',
    'NÃO AGENDE CEDO DEMAIS\n\nO sistema conta quantas vezes o lead respondeu e informa em AQUECIMENTO (dentro de LACUNAS DE DECISÃO). Enquanto o mínimo de 4 respostas não for atingido, você NÃO oferece a consulta por iniciativa própria, mesmo com banco, tipo de dívida e atraso já conhecidos. Use essas conversas para entender o que está pesando: a causa do atraso, há quanto tempo, se já tentou renegociar, se há outras dívidas, o que isso causa na operação. As exceções são só o pedido do próprio lead (marcar, falar com o advogado) e o sinal jurídico duro confirmado (seção STOP QUALIFICATION). Depois do mínimo, a regra abaixo continua valendo.\n\n',
    'agende-cedo');
  return p;
}

export function novaConsultaEstado(query) {
  return trocar(query,
    ' as "ultimasIa" from (select 1) x',
    ' as "ultimasIa", (select count(*) from public.n8n_chat_histories where session_id = $1 and message->>\'type\' = \'human\') as "respostasLead", (select coalesce(json_agg(c order by i desc), \'[]\'::json)::text from (select id as i, message->>\'content\' as c from public.n8n_chat_histories where session_id = $1 and message->>\'type\' = \'human\' order by id desc limit 8) t) as "ultimasLead" from (select 1) x',
    'query-estado');
}

export function novoCalcularLacunas(codigo) {
  let c = trocar(codigo,
    'const estadoDaPergunta = estadoPergunta(ultimasIa);',
    corpoAquecimento() + '\n\nconst estadoDaPergunta = estadoPergunta(ultimasIa);',
    'lacunas-corpo');
  c = trocar(c,
    'return [{ json: { ...item, lacunas, estadoPergunta: estadoDaPergunta } }];',
    "lacunas = lacunas + '\\n' + textoAquecimento(item.respostasLead);\n\nreturn [{ json: { ...item, lacunas, estadoPergunta: estadoDaPergunta } }];",
    'lacunas-retorno');
  return c;
}

export function novoGuardrail(codigo) {
  let c = trocar(codigo,
    'const bannedPatterns = [',
    corpoAquecimento() + '\n\nconst bannedPatterns = [',
    'guardrail-corpo');
  c = trocar(c,
    'if (deveBloquearRepeticao({ saida: text, entrada: entradaAtual, ultimasIa })) {',
    `let respostasAnteriores = 0;
let ultimasLead = [];
try { const ci = $('Calcular Lacunas').first().json; respostasAnteriores = Number(ci.respostasLead || 0); ultimasLead = JSON.parse(ci.ultimasLead || '[]'); } catch (e) { respostasAnteriores = 99; ultimasLead = []; }
if (deveSegurarOferta({ saida: text, entrada: entradaAtual, respostasAnteriores, ultimasIa, ultimasLead })) {
  return [{
    json: {
      ...item,
      output: tirarOferta(text, entradaAtual, fatosAtuais),
      guardrailTriggered: true,
      guardrailReason: "oferta_cedo_demais",
      guardrailOriginalOutput: text
    }
  }];
}
if (deveBloquearRepeticao({ saida: text, entrada: entradaAtual, ultimasIa })) {`,
    'guardrail-uso');
  return c;
}
