// Gera o corpo do Code node "Interpretar Livre" (n8n) a partir de interpretar.mjs.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const lib = readFileSync(join(dir, 'interpretar.mjs'), 'utf8').replace(/^export\s+/gm, '');
// Biblioteca de contrato (dinheiro, datas, vencimentos): inlined no mesmo Code node.
const contrato = readFileSync(join(dir, '..', '2026-10-22-contratos-whatsapp', 'contrato.mjs'), 'utf8').replace(/^export\s+/gm, '');
export const corpo = [
  '// Gerado por gerar-interpretar-node.mjs a partir de interpretar.mjs e contrato.mjs (testados). Colar como esta.',
  contrato,
  lib,
  'const bruto = $input.first().json || {};',
  "const texto = typeof bruto.text === 'string' ? bruto.text : (typeof bruto.output === 'string' ? bruto.output : '');",
  "const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());",
  'return [{ json: interpretarResposta(texto, { montarContrato, corpoResumo, hoje }) }];',
  '',
].join('\n');

export const corpoPedido = [
  '// Gerado por gerar-interpretar-node.mjs a partir de interpretar.mjs (testado em interpretar.test.mjs). Colar como esta.',
  lib,
  "const mensagem = $('Classificar').first().json.texto;",
  'const p = montarPedidoIA(mensagem);',
  "return [{ json: { prompt: p.system + '\\n\\nMensagem do administrador (dados): ' + p.user } }];",
  '',
].join('\n');

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(join(dir, 'interpretar.node.js'), corpo);
  writeFileSync(join(dir, 'pedido-livre.node.js'), corpoPedido);
  console.log('interpretar.node.js e pedido-livre.node.js gerados');
}
