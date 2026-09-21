import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chaveTelefone, normalizarTelefone } from './lead-formulario.mjs';

test('chaveTelefone: mesma chave com e sem nono digito, e igual a funcao SQL', () => {
  assert.equal(chaveTelefone('+5514997022609'), '1497022609');
  assert.equal(chaveTelefone('+551497022609'), '1497022609');
  assert.equal(chaveTelefone('+55 (14) 99702-2609'), '1497022609');
  assert.equal(chaveTelefone('abc'), null);
  assert.equal(chaveTelefone('+14155552671'), null);
  assert.equal(chaveTelefone('+5514'), null);
  assert.equal(chaveTelefone(null), null);
});

test('normalizarTelefone: formas validas viram +55DDDNNNNNNNNN', () => {
  for (const entrada of ['(14) 99702-2609', '14997022609', '+55 14 99702-2609', '5514997022609', '014997022609', 5514997022609]) {
    const r = normalizarTelefone(entrada);
    assert.deepEqual(r, { ok: true, telefone: '+5514997022609', chave: '1497022609' }, String(entrada));
  }
});

test('normalizarTelefone: numero antigo de 8 digitos e aceito e tem a mesma chave', () => {
  const r = normalizarTelefone('+551497022609');
  assert.deepEqual(r, { ok: true, telefone: '+551497022609', chave: '1497022609' });
});

test('normalizarTelefone: recusa invalidos', () => {
  for (const entrada of ['+1 415 555 2671', '123', '', '   ', null, undefined, {}, '(14) 5970-2609', '(14) 89702-2609', '(10) 99702-2609', 'abcdef']) {
    assert.deepEqual(normalizarTelefone(entrada), { ok: false, motivo: 'telefone_invalido' }, String(entrada));
  }
});
