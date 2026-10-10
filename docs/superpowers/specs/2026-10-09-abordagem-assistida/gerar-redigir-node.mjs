// gerar-redigir-node.mjs: monta o corpo do Code node a partir de calcular-lacunas.mjs e redigir.mjs (codigo testado).
// Uso: node gerar-redigir-node.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const limpar = (codigo) => codigo.replace(/^import .*$/gm, '').replace(/^export\s+/gm, '');
const lacunas = limpar(readFileSync(join(dir, '..', '2026-09-18-mayara-v3', 'calcular-lacunas.mjs'), 'utf8'));
const redigir = limpar(readFileSync(join(dir, 'redigir.mjs'), 'utf8'));

const corpo = [
  '// Corpo do Code node "Redigir Abordagem" (n8n): colar como esta, sem export nem import.',
  '// Gerado por gerar-redigir-node.mjs a partir de calcular-lacunas.mjs e redigir.mjs; redigir.node.test.mjs guarda contra divergencia.',
  lacunas,
  redigir,
  'const entrada = $input.first().json;',
  'return [{ json: resolverRascunho(entrada.lead, entrada.textoIA, new Date()) }];',
  '',
].join('\n');

writeFileSync(join(dir, 'redigir.node.js'), corpo);
console.log('redigir.node.js gerado (' + corpo.length + ' caracteres)');
