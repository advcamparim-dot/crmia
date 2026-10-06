import test from 'node:test';
import assert from 'node:assert/strict';
import { montarWorkflow, corpoNode, RODAPE_NORMALIZAR } from './gerar-receber.mjs';

const PROCESSAR_ID = '1ciEX4HqgbaS3Gqx';
const ESTADO_ID = 'uRxJRPeu9axfmzAd';
const wf = montarWorkflow(PROCESSAR_ID, ESTADO_ID);
const nomes = wf.nodes.map((n) => n.name);
const sai = (o, i = 0) => (wf.connections[o]?.main?.[i] ?? []).map((c) => c.node);
const no = (n) => wf.nodes.find((x) => x.name === n);

test('nomes unicos, conexoes validas e tudo alcancavel a partir do webhook', () => {
  assert.equal(new Set(nomes).size, nomes.length);
  const alvo = new Set(['Webhook Evolution']);
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

test('o webhook responde na hora e o segredo e conferido antes de qualquer outra coisa', () => {
  assert.equal(no('Webhook Evolution').parameters.httpMethod, 'POST');
  assert.equal(no('Webhook Evolution').parameters.responseMode, 'onReceived');
  assert.deepEqual(sai('Webhook Evolution'), ['Conferir Segredo']);
  assert.deepEqual(sai('Conferir Segredo'), ['Segredo OK?']);
  assert.deepEqual(sai('Segredo OK?', 0), ['Evento de Estado?']);
  assert.deepEqual(sai('Segredo OK?', 1), ['Descartar em Silencio']);
  assert.equal(no('Conferir Segredo').parameters.query, 'select mayara.conferir_segredo_canal($1) as ok');
  assert.match(no('Conferir Segredo').parameters.options.queryReplacement, /x-canal-segredo/);
});

test('eventos de conexao vao para o Canal Estado; os demais seguem para a normalizacao', () => {
  assert.deepEqual(sai('Evento de Estado?', 0), ['Preparar Estado']);
  assert.deepEqual(sai('Evento de Estado?', 1), ['Normalizar Evento']);
  assert.deepEqual(sai('Preparar Estado'), ['Chamar Estado']);
  assert.equal(no('Preparar Estado').parameters.jsCode, "return [{ json: $('Webhook Evolution').first().json.body }];");
  assert.equal(no('Chamar Estado').parameters.workflowId.value, ESTADO_ID);
  assert.equal(no('Chamar Estado').onError, 'continueRegularOutput');
  assert.match(no('Evento de Estado?').parameters.conditions.conditions[0].leftValue, /connection\.update/);
});

test('so Processar Evento e Chamar Estado sao chamados, e nenhum no envia mensagem por conta propria', () => {
  const tipos = wf.nodes.map((n) => n.type);
  assert.ok(!tipos.includes('n8n-nodes-base.httpRequest'));
  assert.ok(!JSON.stringify(wf).includes('graph.facebook.com'));
  const chamadas = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.executeWorkflow');
  assert.deepEqual(chamadas.map((n) => n.name).sort(), ['Chamar Estado', 'Processar Evento']);
  const proc = chamadas.find((n) => n.name === 'Processar Evento');
  assert.equal(proc.parameters.workflowId.value, PROCESSAR_ID);
  assert.equal(proc.parameters.options.waitForSubWorkflow, true);
});

test('o aceito e registrado antes de ser processado, e o item enviado e o evento normalizado', () => {
  assert.deepEqual(sai('Registrar Aceito'), ['Preparar Evento']);
  assert.deepEqual(sai('Preparar Evento'), ['Processar Evento']);
  assert.equal(no('Preparar Evento').parameters.jsCode, "return [{ json: $('Normalizar Evento').first().json.evento }];");
  assert.equal(no('Processar Evento').parameters.workflowInputs, undefined);
  assert.equal(no('Processar Evento').parameters.options.waitForSubWorkflow, true);
});

test('o registro de auditoria nunca bloqueia o processamento da mensagem', () => {
  for (const n of ['Registrar Aceito', 'Registrar Descartado', 'Registrar Humano']) {
    assert.equal(no(n).onError, 'continueRegularOutput', n);
  }
});

test('mensagem enviada por humano pelo numero do escritorio: espera o log de envios e pausa o lead', () => {
  assert.deepEqual(sai('Aceito?', 1), ['Humano?']);
  assert.deepEqual(sai('Humano?', 0), ['Aguardar Registro de Envio']);
  assert.deepEqual(sai('Humano?', 1), ['Registrar Descartado']);
  assert.deepEqual(sai('Aguardar Registro de Envio'), ['Registrar Humano']);
  assert.equal(no('Aguardar Registro de Envio').type, 'n8n-nodes-base.wait');
  assert.equal(no('Aguardar Registro de Envio').parameters.amount, 5);
  assert.equal(no('Aguardar Registro de Envio').parameters.unit, 'seconds');
  assert.match(no('Humano?').parameters.conditions.conditions[0].leftValue, /acao === 'humano'/);
  assert.equal(no('Registrar Humano').parameters.query, 'select mayara.humano_assumiu($1, $2, $3) as r');
  assert.match(no('Registrar Humano').parameters.options.queryReplacement, /\$json\.canalId.*\$json\.phone.*\$json\.messageId/);
  assert.deepEqual(sai('Registrar Humano'), []);
});

test('aceitos e descartados terminam no registro, sem consultar autorizacao', () => {
  assert.deepEqual(sai('Normalizar Evento'), ['Aceito?']);
  assert.deepEqual(sai('Aceito?', 0), ['Registrar Aceito']);
  assert.match(no('Registrar Aceito').parameters.query, /registrar_evento_canal/);
  assert.match(no('Registrar Descartado').parameters.query, /registrar_evento_canal/);
});

test('o registro nunca grava o texto da mensagem, so o tamanho', () => {
  const q = JSON.stringify([no('Registrar Aceito').parameters, no('Registrar Descartado').parameters]);
  assert.ok(!/\.message\b/.test(q.replace(/messageType/g, '')) || /\.message\.length/.test(q));
  assert.match(no('Registrar Aceito').parameters.options.queryReplacement, /message\.length/);
});

test('o Code node gerado e JS valido, sem import/export, e descarta payload hostil sem lancar', () => {
  const c = corpoNode(RODAPE_NORMALIZAR);
  assert.ok(!/^\s*(import|export)\s/m.test(c));
  const wh = (body) => () => ({ first: () => ({ json: { body } }) });
  const roda = (body) => new Function('$input', '$', c)({ first: () => ({ json: { body } }) }, wh(body))[0].json;
  assert.equal(roda(null).acao, 'descartar');
  assert.equal(roda({ event: 'messages.upsert', instance: 'escritorio', data: { key: { remoteJid: '5514997022609@s.whatsapp.net', fromMe: false, id: 'A' }, message: { conversation: 'oi' } } }).acao, 'processar');
});

test('configuracao: credencial do banco, workflow de erro e caminho do webhook', () => {
  assert.equal(wf.settings.errorWorkflow, 'CQyjBKLX0UheNh1q');
  assert.ok(JSON.stringify(wf).includes('nNpCUIhnDuVvTApU'));
  assert.equal(no('Webhook Evolution').parameters.path, 'canal-evolution');
});
