// gerar-nucleo.mjs: monta o codigo dos Code nodes alterados no Nucleo V3.1
// (Calcular Lacunas e Guardrail) a partir do codigo ORIGINAL do Nucleo V3 e de nucleo.mjs.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));

export function corpoLib() {
  return readFileSync(join(dir, 'nucleo.mjs'), 'utf8').replace(/^export\s+/gm, '');
}

export const ORIGINAL_LACUNAS = String.raw`const item = $input.first().json;
let fatosJson = {};
try {
  fatosJson = item.fatosJson ? JSON.parse(item.fatosJson) : {};
} catch (e) {
  fatosJson = {};
}

const fatosConhecidosPares = [];
if (fatosJson.tipoDivida) fatosConhecidosPares.push(${'`'}tipo=${'${'}fatosJson.tipoDivida}${'`'});
if (fatosJson.bancos && fatosJson.bancos.length) fatosConhecidosPares.push(${'`'}banco=${'${'}fatosJson.bancos.join(', ')}${'`'});
if (fatosJson.valorAproximado) fatosConhecidosPares.push(${'`'}valor=${'${'}fatosJson.valorAproximado}${'`'});
if (fatosJson.documento) fatosConhecidosPares.push(${'`'}documento=${'${'}fatosJson.documento}${'`'});

const lacunasEmOrdem = [];
if (!fatosJson.situacaoJudicial || !fatosJson.urgencia) {
  lacunasEmOrdem.push('situação judicial vs. cobrança informal');
}
if (!fatosJson.bancos || !fatosJson.bancos.length) {
  lacunasEmOrdem.push('banco(s) envolvido(s) na dívida');
}
if (fatosJson.notificacaoOrigem === 'desconhecida') {
  lacunasEmOrdem.push('origem da notificação recebida (banco ou judicial)');
}
if (!fatosJson.causaEconomica) {
  lacunasEmOrdem.push('causa econômica do atraso/dificuldade');
}
if (typeof fatosJson.outrosContratosOuDividas === 'undefined') {
  lacunasEmOrdem.push('existência de outros contratos ou dívidas bancárias');
}
if (typeof fatosJson.tentativaRenegociacao === 'undefined') {
  lacunasEmOrdem.push('tentativa anterior de renegociação com o banco');
}

const linhaFatos = fatosConhecidosPares.length
  ? ${'`'}FATOS JÁ CONHECIDOS: ${'${'}fatosConhecidosPares.join('; ')}${'`'}
  : 'FATOS JÁ CONHECIDOS: (nenhum ainda)';

let lacunas;
if (lacunasEmOrdem.length === 0) {
  lacunas = [
    linhaFatos,
    'LACUNA PRIORITÁRIA EM ABERTO: nenhuma — todas as lacunas conhecidas foram resolvidas',
    'NUNCA PERGUNTE O QUE JÁ ESTÁ EM "FATOS JÁ CONHECIDOS"',
  ].join('\n');
} else {
  const [prioritaria, ...outras] = lacunasEmOrdem;
  const linhas = [linhaFatos, ${'`'}LACUNA PRIORITÁRIA EM ABERTO: ${'${'}prioritaria}${'`'}];
  if (outras.length) {
    linhas.push(${'`'}OUTRAS LACUNAS (só considerar se a prioritária já foi resolvida): ${'${'}outras.join('; ')}${'`'});
  }
  linhas.push('NUNCA PERGUNTE O QUE JÁ ESTÁ EM "FATOS JÁ CONHECIDOS"');
  lacunas = linhas.join('\n');
}

return [{ json: { ...item, lacunas } }];`;

function trocar(texto, de, para) {
  if (!texto.includes(de)) throw new Error('trecho nao encontrado: ' + de.slice(0, 60));
  return texto.replace(de, para);
}

export function codigoCalcularLacunas() {
  let c = ORIGINAL_LACUNAS;
  c = trocar(c, "if (fatosJson.documento) fatosConhecidosPares.push(`documento=${fatosJson.documento}`);",
    "if (fatosJson.documento) fatosConhecidosPares.push(`documento=${fatosJson.documento}`);\nif (fatosJson.nomeCompleto) fatosConhecidosPares.push(`nome=${fatosJson.nomeCompleto}`);");
  c = trocar(c, 'return [{ json: { ...item, lacunas } }];', `let ultimasIa = [];
try {
  ultimasIa = item.ultimasIa ? JSON.parse(item.ultimasIa) : [];
} catch (e) {
  ultimasIa = [];
}
const estadoDaPergunta = estadoPergunta(ultimasIa);
if (estadoDaPergunta.startsWith('PERGUNTA PENDENTE')) {
  lacunas = lacunas + '\\n(Há pergunta pendente: veja ESTADO DA PERGUNTA antes de perguntar qualquer lacuna.)';
}

return [{ json: { ...item, lacunas, estadoPergunta: estadoDaPergunta } }];`);
  return corpoLib() + '\n' + c;
}

export const ORIGINAL_GUARDRAIL = String.raw`const bannedPatterns = [
  /cl[aá]usulas?\s+abusivas?/i,
  /revisional/i,
  /juros\s+abusivos/i,
  /capitaliza[cç][aã]o\s+irregular/i,
  /tarifas?\s+ilegal/i,
  /excesso\s+de\s+execu[cç][aã]o/i,
  /impenhorabilidade/i,
  /nulidades?/i,
  /direito\s+a\s+(desconto|redu[cç][aã]o)/i,
  /embargos/i
];

const item = $input.first().json;
let text = item.output || '';

const violated = bannedPatterns.some(p => p.test(text));
if (violated) {
  return [{
    json: {
      ...item,
      output: "Isso e uma analise que so o Dr. Santo consegue fazer olhando o contrato. Vou verificar um horario pra voces conversarem, pode ser?",
      guardrailTriggered: true,
      guardrailReason: "opiniao_juridica",
      guardrailOriginalOutput: text
    }
  }];
}

// Detecta vazamento de trace tecnico (chamada de ferramenta, JSON cru) na resposta.
const technicalLeakPatterns = [
  /calling\s+\w+\s+with\s+input/i,
  /\{"[a-zA-Z_]+"\s*:/,
  /function_calls|tool_call|intermediateStep/i
];
const hasTechnicalLeak = technicalLeakPatterns.some(p => p.test(text));
if (hasTechnicalLeak) {
  return [{
    json: {
      ...item,
      output: "Tive uma instabilidade agora ao confirmar isso. So um momento que eu reviso e te retorno.",
      guardrailTriggered: true,
      guardrailReason: "vazamento_tecnico",
      guardrailOriginalOutput: text
    }
  }];
}

// Valida qualquer data DD/MM mencionada no texto contra a janela real dos proximos 14 dias.
const validDatesDDMM = [];
for (let i = 0; i <= 14; i++) {
  validDatesDDMM.push($now.plus({ days: i }).setZone('America/Sao_Paulo').toFormat('dd/MM'));
}

const dateMatches = text.match(/\b(\d{1,2})\/(\d{1,2})\b/g) || [];
const normalizedMatches = dateMatches.map(m => {
  const [d, mo] = m.split('/');
  return d.padStart(2, '0') + '/' + mo.padStart(2, '0');
});
const hasBadDate = normalizedMatches.some(m => !validDatesDDMM.includes(m));

if (hasBadDate) {
  return [{
    json: {
      ...item,
      output: "Deixa eu confirmar certinho na agenda antes de seguir. Pode me dizer de novo o dia que prefere (ex: amanha, ou um dia da semana)?",
      guardrailTriggered: true,
      guardrailReason: "data_invalida_no_texto",
      guardrailOriginalOutput: text
    }
  }];
}

return [{ json: item }];`;

export function codigoGuardrail() {
  let c = ORIGINAL_GUARDRAIL;
  c = trocar(c, 'return [{ json: item }];', `// Trava de pergunta repetida: se a Mayara voltar a perguntar o mesmo assunto sem a pessoa ter respondido,
// troca a resposta por uma sem pergunta (a pergunta pendente continua valendo).
let ultimasIa = [];
let entradaAtual = '';
let fatosAtuais = {};
try { ultimasIa = JSON.parse($('Calcular Lacunas').first().json.ultimasIa || '[]'); } catch (e) { ultimasIa = []; }
try { entradaAtual = String($('Montar Contexto').first().json.chatInput || ''); } catch (e) { entradaAtual = ''; }
try { fatosAtuais = JSON.parse($('Montar Contexto').first().json.fatosJson || '{}'); } catch (e) { fatosAtuais = {}; }
if (deveBloquearRepeticao({ saida: text, entrada: entradaAtual, ultimasIa })) {
  return [{
    json: {
      ...item,
      output: fallbackSemPergunta(entradaAtual, fatosAtuais),
      guardrailTriggered: true,
      guardrailReason: "pergunta_repetida",
      guardrailOriginalOutput: text
    }
  }];
}

return [{ json: item }];`);
  return corpoLib() + '\n' + c;
}
