// Gera o corpo do Code node "Interpretar Livre" (n8n) a partir de interpretar.mjs.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const lib = readFileSync(join(dir, 'interpretar.mjs'), 'utf8').replace(/^export\s+/gm, '');
export const corpo = [
  '// Gerado por gerar-interpretar-node.mjs a partir de interpretar.mjs (testado em interpretar.test.mjs). Colar como esta.',
  lib,
  'const bruto = $input.first().json || {};',
  "const texto = typeof bruto.text === 'string' ? bruto.text : (typeof bruto.output === 'string' ? bruto.output : '');",
  'return [{ json: interpretarResposta(texto) }];',
  '',
].join('\n');

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(join(dir, 'interpretar.node.js'), corpo);
  console.log('interpretar.node.js gerado (' + corpo.length + ' caracteres)');
}
