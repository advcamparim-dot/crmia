import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FRASES } from './frases.mjs';
import { interpretarResposta } from './interpretar.mjs';
import { corpo as corpoEsperado } from './gerar-interpretar-node.mjs';

const corpo = readFileSync(fileURLToPath(new URL('./interpretar.node.js', import.meta.url)), 'utf8');
const rodar = (json) => new Function('$input', corpo)({ first: () => ({ json }) })[0].json;

test('o arquivo gerado esta em dia com a biblioteca', () => {
  assert.equal(corpo, corpoEsperado);
});

test('o corpo do node produz a mesma saida da biblioteca, lendo text ou output do modelo', () => {
  for (const { modelo } of FRASES) {
    assert.deepEqual(rodar({ text: modelo }), interpretarResposta(modelo));
    assert.deepEqual(rodar({ output: modelo }), interpretarResposta(modelo));
  }
});

test('entrada vazia ou estranha do modelo cai em "nao entendi" e nao ha import/export', () => {
  for (const ruim of [{}, { text: 5 }, { text: '' }, null]) assert.equal(rodar(ruim).acao, 'livre_nao_entendi');
  assert.equal(/^\s*(import|export)\s/m.test(corpo), false);
});
