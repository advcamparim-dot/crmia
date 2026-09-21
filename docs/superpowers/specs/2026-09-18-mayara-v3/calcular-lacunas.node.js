// Corpo do Code node "Calcular Lacunas" (n8n) — colar como esta, sem export nem import.
// Espelho de calcular-lacunas.mjs; calcular-lacunas.node.test.mjs guarda contra divergencia entre os dois.
const MAX_CARACTERES_FATO = 80;
const MAX_BANCOS = 5;

function sanitizarFato(valor) {
  let texto;
  if (typeof valor === 'string') {
    texto = valor;
  } else if (typeof valor === 'number' && Number.isFinite(valor)) {
    texto = String(valor);
  } else {
    return '';
  }
  const colapsado = texto.replace(/[\s\u0000-\u001f\u007f-\u009f]+/g, ' ').trim();
  return Array.from(colapsado).slice(0, MAX_CARACTERES_FATO).join('').trim();
}

function normalizarBancos(bancos) {
  const lista = typeof bancos === 'string' ? [bancos] : Array.isArray(bancos) ? bancos : [];
  return lista
    .filter((b) => typeof b === 'string')
    .map(sanitizarFato)
    .filter((b) => b.length > 0)
    .slice(0, MAX_BANCOS);
}

function desconhecido(valor) {
  return valor === undefined || valor === null;
}

const item = $input.first().json;
let fatosBrutos = {};
try {
  fatosBrutos = item.fatosJson ? JSON.parse(item.fatosJson) : {};
} catch (e) {
  fatosBrutos = {};
}
const f = fatosBrutos !== null && typeof fatosBrutos === 'object' && !Array.isArray(fatosBrutos) ? fatosBrutos : {};

const tipoDivida = sanitizarFato(f.tipoDivida);
const bancos = normalizarBancos(f.bancos);
const valorAproximado = sanitizarFato(f.valorAproximado);
const documento = sanitizarFato(f.documento);

const fatosConhecidosPares = [];
if (tipoDivida) fatosConhecidosPares.push(`tipo=${tipoDivida}`);
if (bancos.length) fatosConhecidosPares.push(`banco=${bancos.join(', ')}`);
if (valorAproximado) fatosConhecidosPares.push(`valor=${valorAproximado}`);
if (documento) fatosConhecidosPares.push(`documento=${documento}`);

const linhaFatos = fatosConhecidosPares.length
  ? `FATOS JÁ CONHECIDOS: ${fatosConhecidosPares.join('; ')}`
  : 'FATOS JÁ CONHECIDOS: (nenhum ainda)';

const lacunasEmOrdem = [];
if (!f.situacaoJudicial || !f.urgencia) {
  lacunasEmOrdem.push('situação judicial vs. cobrança informal');
}
if (!bancos.length) {
  lacunasEmOrdem.push('banco(s) envolvido(s) na dívida');
}
if (f.notificacaoOrigem === 'desconhecida') {
  lacunasEmOrdem.push('origem da notificação recebida (banco ou judicial)');
}
if (!f.causaEconomica) {
  lacunasEmOrdem.push('causa econômica do atraso/dificuldade');
}
if (desconhecido(f.outrosContratosOuDividas)) {
  lacunasEmOrdem.push('existência de outros contratos ou dívidas bancárias');
}
if (desconhecido(f.tentativaRenegociacao)) {
  lacunasEmOrdem.push('tentativa anterior de renegociação com o banco');
}

let lacunas;
if (lacunasEmOrdem.length === 0) {
  lacunas = [
    linhaFatos,
    'LACUNA PRIORITÁRIA EM ABERTO: nenhuma — todas as lacunas conhecidas foram resolvidas',
    'NUNCA PERGUNTE O QUE JÁ ESTÁ EM "FATOS JÁ CONHECIDOS"',
  ].join('\n');
} else {
  const [prioritaria, ...outras] = lacunasEmOrdem;
  const linhas = [linhaFatos, `LACUNA PRIORITÁRIA EM ABERTO: ${prioritaria}`];
  if (outras.length) {
    linhas.push(`OUTRAS LACUNAS (só considerar se a prioritária já foi resolvida): ${outras.join('; ')}`);
  }
  linhas.push('NUNCA PERGUNTE O QUE JÁ ESTÁ EM "FATOS JÁ CONHECIDOS"');
  lacunas = linhas.join('\n');
}

return [{ json: { ...item, lacunas } }];
