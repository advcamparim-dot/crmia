import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizarTelefone, normalizarNumeroRegra, normalizarPeriodo, limparNome } from './interpretar.mjs';

test('telefone: formatos comuns viram +55 com DDD e o resto e invalido', () => {
  assert.equal(normalizarTelefone('+55 66 99683-3126'), '+5566996833126');
  assert.equal(normalizarTelefone('66996833126'), '+5566996833126');
  assert.equal(normalizarTelefone('5566996833126'), '+5566996833126');
  assert.equal(normalizarTelefone('(14) 3333-4444'), '+551433334444');
  assert.equal(normalizarTelefone('553291953735'), '+553291953735');
  assert.equal(normalizarTelefone('123'), null);
  assert.equal(normalizarTelefone(''), null);
  assert.equal(normalizarTelefone(null), null);
  assert.equal(normalizarTelefone('abc'), null);
  assert.equal(normalizarTelefone('+1 202 555 0100'), null);
});

test('numero de regra: inteiro de 1 a 9 digitos, aceita #3 e "regra 3"', () => {
  assert.equal(normalizarNumeroRegra(3), 3);
  assert.equal(normalizarNumeroRegra('3'), 3);
  assert.equal(normalizarNumeroRegra('#18'), 18);
  assert.equal(normalizarNumeroRegra('regra 7'), 7);
  assert.equal(normalizarNumeroRegra(0), null);
  assert.equal(normalizarNumeroRegra(-2), null);
  assert.equal(normalizarNumeroRegra(2.5), null);
  assert.equal(normalizarNumeroRegra('abc'), null);
  assert.equal(normalizarNumeroRegra(null), null);
  assert.equal(normalizarNumeroRegra('1234567890'), null);
});

test('periodo: so hoje, semana ou mes (aceita acento e caixa)', () => {
  assert.equal(normalizarPeriodo('hoje'), 'hoje');
  assert.equal(normalizarPeriodo('Semana'), 'semana');
  assert.equal(normalizarPeriodo('mês'), 'mes');
  assert.equal(normalizarPeriodo('ano'), null);
  assert.equal(normalizarPeriodo(null), null);
  assert.equal(normalizarPeriodo(''), null);
});

test('nome: so letras, espacos, apostrofo e hifen; ate 60 caracteres', () => {
  assert.equal(limparNome('  Maria   da Silva '), 'Maria da Silva');
  assert.equal(limparNome("D'Ávila-Souza"), "D'Ávila-Souza");
  assert.equal(limparNome('Ana {{ $json.x }}'), '');
  assert.equal(limparNome('http://x.com'), '');
  assert.equal(limparNome('A'), '');
  assert.equal(limparNome('x'.repeat(61)), '');
  assert.equal(limparNome(null), '');
});
