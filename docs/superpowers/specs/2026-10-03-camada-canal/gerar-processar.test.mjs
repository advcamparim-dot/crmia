import test from 'node:test';
import assert from 'node:assert/strict';
import { montarWorkflow } from './gerar-processar.mjs';

const wf = montarWorkflow('jNhj68Ee7i3w8dey');
const nomes = wf.nodes.map((n) => n.name);
const sai = (o, i) => (wf.connections[o]?.main?.[i] ?? []).map((c) => c.node);

test('nomes unicos, conexoes validas e tudo alcancavel', () => {
  assert.equal(new Set(nomes).size, nomes.length);
  const alvo = new Set(['Execute Workflow Trigger']);
  let mudou = true;
  while (mudou) {
    mudou = false;
    for (const [o, s] of Object.entries(wf.connections)) {
      assert.ok(nomes.includes(o), o);
      for (const g of s.main) for (const c of g) { assert.ok(nomes.includes(c.node), c.node); if (alvo.has(o) && !alvo.has(c.node)) { alvo.add(c.node); mudou = true; } }
    }
  }
  for (const n of nomes) assert.ok(alvo.has(n), 'inalcancavel: ' + n);
});

test('o gatilho aceita o item inteiro (passthrough)', () => {
  assert.equal(wf.nodes.find((n) => n.name === 'Execute Workflow Trigger').parameters.inputSource, 'passthrough');
});

test('nenhuma expressao depende de nos que so existem no Gateway', () => {
  assert.ok(!JSON.stringify(wf).includes('Normalizar e Filtrar Evento'));
});

test('fail-closed: erros da rota e do portao param com erro, e comando nunca cai no fluxo de lead', () => {
  assert.deepEqual(sai('Rota da Mensagem', 1), ['Falha da Rota']);
  assert.deepEqual(sai('Consultar Autorização', 1), ['Falha do Portão (fecha e alerta)']);
  assert.deepEqual(sai('Comando?', 0), ['Executar Central']);
  assert.deepEqual(sai('Comando?', 1), ['Consultar Autorização']);
  assert.deepEqual(sai('Liberado?', 1), ['Bloqueado em Silêncio']);
  assert.deepEqual(sai('Liberado?', 0), ['Restaurar Evento']);
});

test('eventos sem mensagem seguem para Evento Autorizado? sem consultar o banco', () => {
  assert.deepEqual(sai('Tem Mensagem?', 1), ['Evento Autorizado?']);
  assert.deepEqual(sai('Tem Mensagem?', 0), ['Rota da Mensagem']);
});

test('a Ponte e chamada com os mesmos oito campos de hoje', () => {
  const ponte = wf.nodes.find((n) => n.name === 'Chamar Mayara — Ponte WhatsApp');
  assert.deepEqual(Object.keys(ponte.parameters.workflowInputs.value).sort(),
    ['channel', 'message', 'messageId', 'phone', 'phoneNumberId', 'requiresHuman', 'sessionKey', 'timestamp']);
  assert.equal(ponte.parameters.workflowId.value, 'B1xdt1WotCQE3NOb');
  assert.equal(ponte.parameters.options.waitForSubWorkflow, true);
});

test('requiresHuman e booleano no contrato da Ponte (string quebra o envio)', () => {
  const ponte = wf.nodes.find((n) => n.name === 'Chamar Mayara — Ponte WhatsApp');
  const campo = ponte.parameters.workflowInputs.schema.find((c) => c.id === 'requiresHuman');
  assert.equal(campo.type, 'boolean');
  assert.equal(ponte.parameters.workflowInputs.convertFieldsToString, false);
  assert.equal(ponte.parameters.workflowInputs.attemptToConvertTypes, false);
});

test('a Central e chamada com o ID informado e le o evento do gatilho', () => {
  const c = wf.nodes.find((n) => n.name === 'Executar Central');
  assert.equal(c.parameters.workflowId.value, 'jNhj68Ee7i3w8dey');
  assert.ok(JSON.stringify(c.parameters.workflowInputs.value).includes("$('Execute Workflow Trigger').first().json.phone"));
  assert.equal(wf.nodes.find((n) => n.name === 'Restaurar Evento').parameters.jsCode, "return [{ json: $('Execute Workflow Trigger').first().json }];");
});

test('configuracao: credencial do banco e workflow de erro', () => {
  assert.equal(wf.settings.errorWorkflow, 'CQyjBKLX0UheNh1q');
  assert.ok(JSON.stringify(wf).includes('nNpCUIhnDuVvTApU'));
});
