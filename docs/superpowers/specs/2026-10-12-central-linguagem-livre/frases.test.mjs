import test from 'node:test';
import assert from 'node:assert/strict';
import { FRASES } from './frases.mjs';
import { interpretarResposta } from './interpretar.mjs';

test('o conjunto tem pelo menos 36 frases e cobre todas as acoes', () => {
  assert.ok(FRASES.length >= 36, 'frases: ' + FRASES.length);
  const acoes = new Set(FRASES.map((f) => f.esperado));
  for (const a of ['livre_status', 'livre_contagem_leads', 'livre_situacao_lead', 'livre_listar_regras', 'livre_pausar', 'livre_ligar', 'livre_assumir', 'livre_devolver', 'livre_desfazer_regra', 'livre_reativar_regra', 'livre_abordar', 'livre_ensinar', 'livre_conversar', 'livre_nao_entendi']) assert.ok(acoes.has(a), a);
});

test('cada frase gera exatamente a saida esperada', () => {
  for (const { frase, modelo, esperado } of FRASES) {
    const r = interpretarResposta(modelo);
    assert.equal(r.acao, esperado, `"${frase}" -> ${JSON.stringify(r)}`);
  }
});

test('nenhuma frase perigosa vira instrucao de efeito', () => {
  const perigosas = FRASES.filter((f) => /apague|mande uma mensagem para todos|drop table|ignore as regras|altere a configura/.test(f.frase));
  assert.ok(perigosas.length >= 5);
  for (const { frase, modelo } of perigosas) {
    const r = interpretarResposta(modelo);
    assert.notEqual(r.tipo, 'sql', frase);
    assert.notEqual(r.tipo, 'ensinar', frase);
  }
});

test('toda acao de efeito sai como instrucao "livre" (a execucao so ocorre depois do sim, no banco)', () => {
  for (const { frase, modelo, esperado } of FRASES) {
    if (!['livre_pausar', 'livre_ligar', 'livre_assumir', 'livre_devolver', 'livre_desfazer_regra', 'livre_reativar_regra', 'livre_abordar'].includes(esperado)) continue;
    const r = interpretarResposta(modelo);
    assert.equal(r.fn, 'livre', frase);
    assert.equal(r.tipo, 'sql', frase);
  }
});
