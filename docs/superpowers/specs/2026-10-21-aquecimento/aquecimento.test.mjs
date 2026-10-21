import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MINIMO_RESPOSTAS, textoAquecimento, ofereceConsulta, pediuOuAceitou, sinalJudicialDuro, deveSegurarOferta, tirarOferta,
} from './aquecimento.mjs';

const OFERTA_REAL = 'Entendi. Como já existe processo judicial, o Dr. Santo precisa analisar o processo e os documentos antes de qualquer orientação.\n\nPosso verificar um horário pra vocês conversarem? A consulta é gratuita e online.';

test('o mínimo é 4 respostas do lead', () => assert.equal(MINIMO_RESPOSTAS, 4));

test('ofereceConsulta reconhece a oferta real do último atendimento e variações', () => {
  assert.equal(ofereceConsulta(OFERTA_REAL), true);
  assert.equal(ofereceConsulta('Tenho amanhã às 9h ou às 15h, qual fica melhor?'), true);
  assert.equal(ofereceConsulta('Posso agendar uma consulta para você?'), true);
  assert.equal(ofereceConsulta('Certo. Essa dívida já foi para cobrança judicial, ou ainda está só na fase de cobrança do banco?'), false);
  assert.equal(ofereceConsulta('Entendi. O que levou a empresa a atrasar as parcelas?'), false);
});

test('pediuOuAceitou: o lead pedir para marcar ou falar com advogado libera a oferta', () => {
  for (const f of ['Quero marcar uma consulta', 'pode ser amanhã', 'Quero falar com o advogado', 'Qual o horário?']) assert.equal(pediuOuAceitou(f), true, f);
  for (const f of ['Sicoob', 'Judicial', 'Foi por causa da queda no faturamento', 'Ainda não', 'Sim']) assert.equal(pediuOuAceitou(f), false, f);
});

test('sinalJudicialDuro: só execução, penhora, bloqueio, citação e afins; "judicial" sozinho não', () => {
  for (const f of ['Estou sendo executado', 'Já tem execução', 'penhoraram a conta', 'bloqueio no Bacenjud', 'fui citado ontem', 'oficial de justiça veio aqui', 'vai a leilão', 'recuperação judicial']) assert.equal(sinalJudicialDuro(f), true, f);
  for (const f of ['Judicial', 'tem processo', 'cobrança do banco']) assert.equal(sinalJudicialDuro(f), false, f);
});

test('deveSegurarOferta: o caso real (2ª resposta, "Judicial") é segurado', () => {
  assert.equal(deveSegurarOferta({ saida: OFERTA_REAL, entrada: 'Judicial', respostasAnteriores: 1, ultimasIa: ['Certo. Essa dívida já foi para cobrança judicial, ou ainda está só na fase de cobrança do banco mesmo?'] }), true);
});

test('deveSegurarOferta: libera quando o mínimo foi atingido', () => {
  assert.equal(deveSegurarOferta({ saida: OFERTA_REAL, entrada: 'Foi por causa do faturamento', respostasAnteriores: 3, ultimasIa: ['x?'] }), false);
});

test('deveSegurarOferta: libera com pedido do lead, sinal duro ou oferta já feita antes', () => {
  assert.equal(deveSegurarOferta({ saida: OFERTA_REAL, entrada: 'Quero falar com o advogado', respostasAnteriores: 0, ultimasIa: [] }), false);
  assert.equal(deveSegurarOferta({ saida: OFERTA_REAL, entrada: 'Já penhoraram minha conta', respostasAnteriores: 1, ultimasIa: [] }), false);
  assert.equal(deveSegurarOferta({ saida: 'Tenho amanhã às 9h ou 15h, qual fica melhor?', entrada: 'ok', respostasAnteriores: 1, ultimasIa: ['Posso verificar um horário pra vocês conversarem?'] }), false);
});

test('deveSegurarOferta: sinal duro dito antes pelo lead libera a oferta da mensagem seguinte', () => {
  assert.equal(deveSegurarOferta({ saida: 'Posso verificar um horário pra vocês conversarem?', entrada: 'ok', respostasAnteriores: 1, ultimasIa: ['Entendi. O Dr. Santo precisa analisar o processo.'], ultimasLead: ['Ok', 'Já tem execução e o oficial veio'] }), false);
  assert.equal(deveSegurarOferta({ saida: 'Posso verificar um horário pra vocês conversarem?', entrada: 'ok', respostasAnteriores: 1, ultimasIa: ['Você já foi citado nesse processo?'], ultimasLead: ['Judicial'] }), true);
});

test('deveSegurarOferta: resposta sem oferta nunca é segurada', () => {
  assert.equal(deveSegurarOferta({ saida: 'Entendi. O que levou a empresa a atrasar?', entrada: 'Sicoob', respostasAnteriores: 0, ultimasIa: [] }), false);
});

test('tirarOferta no caso real: tira a oferta, mantém o acolhimento e pergunta a fase do processo', () => {
  const r = tirarOferta(OFERTA_REAL, 'Judicial', {});
  assert.equal(ofereceConsulta(r), false);
  assert.match(r, /^Entendi\./);
  assert.match(r, /citado/i);
  assert.equal((r.match(/\?/g) || []).length, 1);
});

test('tirarOferta: sem sinal judicial pergunta a próxima lacuna', () => {
  assert.match(tirarOferta('Posso verificar um horário pra vocês conversarem?', 'Sicoob', {}), /levou|motivo|causa/i);
  assert.match(tirarOferta('Posso verificar um horário pra vocês conversarem?', 'Sicoob', { causaEconomica: 'queda' }), /renegociar/i);
  assert.match(tirarOferta('Posso verificar um horário pra vocês conversarem?', 'Sicoob', { causaEconomica: 'x', tentativaRenegociacao: false }), /outro contrato|outras? d[ií]vidas?/i);
});

test('tirarOferta: mantém a pergunta que o modelo já fez e não acrescenta outra', () => {
  const r = tirarOferta('Entendi. Posso ver um horário? Aliás, qual o valor aproximado?', 'ok', {});
  assert.equal((r.match(/\?/g) || []).length, 1);
  assert.match(r, /valor/);
});

test('textoAquecimento: antes e depois do mínimo', () => {
  const antes = textoAquecimento(1);
  assert.match(antes, /2 de 4/);
  assert.match(antes, /não (ofereça|proponha)/i);
  assert.match(textoAquecimento(3), /mínimo atingido/i);
});
