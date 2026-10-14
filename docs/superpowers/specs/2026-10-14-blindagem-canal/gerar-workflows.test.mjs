import test from 'node:test';
import assert from 'node:assert/strict';
import { montarAlertarFora, montarRecuperar, montarVigia } from './gerar-workflows.mjs';

const nomes = (w) => w.nodes.map((n) => n.name);
const no = (w, nome) => w.nodes.find((n) => n.name === nome);
const destinos = (w, origem, saida = 0) => ((w.connections[origem] && w.connections[origem].main[saida]) || []).map((x) => x.node);
const PROC = { workflowId: { __rl: true, value: 'PROCESSAR_ID', mode: 'list' }, options: { waitForSubWorkflow: true }, workflowInputs: { value: {} } };

test('vigia: agendado a cada 2 min, sem webhook, com saidas corretas', () => {
  const w = montarVigia('ALERTAR_ID', 'RECUPERAR_ID');
  assert.equal(w.name, 'Mayara — Canal: Vigia');
  assert.equal(no(w, 'Agendar').type, 'n8n-nodes-base.scheduleTrigger');
  assert.deepEqual(no(w, 'Agendar').parameters.rule.interval, [{ field: 'minutes', minutesInterval: 2 }]);
  for (const n of w.nodes) assert.ok(!/webhook|formTrigger|chatTrigger/i.test(n.type), n.type);
  assert.equal(no(w, 'Estado Real').onError, 'continueRegularOutput');
  assert.equal(no(w, 'Estado Real').parameters.url, 'https://evolution.camparimadvogados.com.br/instance/connectionState/escritorio');
  assert.equal(no(w, 'Estado Real').credentials.httpHeaderAuth.id, 'vA1UKEhHVqwcLGWW');
  assert.equal(no(w, 'Reiniciar Instancia').parameters.method, 'PUT');
  assert.equal(no(w, 'Reiniciar Instancia').parameters.url, 'https://evolution.camparimadvogados.com.br/instance/restart/escritorio');
  assert.deepEqual(destinos(w, 'Acao', 0), ['Reiniciar Instancia']);
  assert.deepEqual(destinos(w, 'Acao', 1), ['Texto do Alerta']);
  assert.deepEqual(destinos(w, 'Acao', 2), ['Texto do Alerta']);
  assert.deepEqual(destinos(w, 'Acao', 3), ['Recuperar']);
  assert.equal(no(w, 'Alertar Fora do WhatsApp').parameters.workflowId.value, 'ALERTAR_ID');
  assert.equal(no(w, 'Recuperar').parameters.workflowId.value, 'RECUPERAR_ID');
  assert.equal(no(w, 'Recuperar').parameters.workflowInputs.value.simular, 'false');
  assert.equal(w.settings.errorWorkflow, 'CQyjBKLX0UheNh1q');
});

test('vigia: corpo do Code gerado e nenhum segredo no JSON', () => {
  const w = montarVigia('A', 'R');
  assert.ok(no(w, 'Normalizar Leitura').parameters.jsCode.includes('estadoReal('));
  assert.ok(no(w, 'Texto do Alerta').parameters.jsCode.includes('textoAlerta('));
  assert.doesNotMatch(JSON.stringify(w), /Bearer |"apikey"/i);
});

test('recuperar: laco por mensagem, idempotencia e simulacao', () => {
  const w = montarRecuperar(PROC);
  assert.equal(w.name, 'Mayara — Canal: Recuperar [Sub-workflow]');
  assert.deepEqual(no(w, 'Execute Workflow Trigger').parameters.workflowInputs.values.map((v) => v.name), ['desde', 'simular']);
  for (let n = 1; n <= 4; n++) {
    const b = no(w, 'Buscar ' + n);
    assert.equal(b.parameters.url, 'https://evolution.camparimadvogados.com.br/chat/findMessages/escritorio');
    assert.equal(b.onError, 'continueRegularOutput');
    assert.ok(b.parameters.jsonBody.includes('page: ' + n) && b.parameters.jsonBody.includes('where: {}'));
  }
  assert.deepEqual(destinos(w, 'Janela'), ['Buscar 1']);
  assert.deepEqual(destinos(w, 'Buscar 1'), ['Mais 1?']);
  assert.deepEqual(destinos(w, 'Mais 1?', 0), ['Buscar 2']);
  assert.deepEqual(destinos(w, 'Mais 2?', 0), ['Buscar 3']);
  assert.deepEqual(destinos(w, 'Mais 3?', 0), ['Buscar 4']);
  for (const n of ['Mais 1?', 'Mais 2?', 'Mais 3?']) assert.deepEqual(destinos(w, n, 1), ['Lote'], n);
  assert.deepEqual(destinos(w, 'Buscar 4'), ['Lote']);
  const expr = no(w, 'Mais 1?').parameters.conditions.conditions[0].leftValue.replace(/^=\{\{/, '').replace(/\}\}$/, '');
  const mais = (json, gte) => new Function('$json', '$', 'return ' + expr)(json, () => ({ first: () => ({ json: { gte } }) }));
  const cheia = (ts) => ({ messages: { records: [...Array(199).fill({ messageTimestamp: 9e9 }), { messageTimestamp: ts }] } });
  assert.equal(mais(cheia(2000), 1000), true);
  assert.equal(mais(cheia(500), 1000), false);
  assert.equal(mais({ messages: { records: [{ messageTimestamp: 2000 }] } }, 1000), false);
  assert.equal(mais({ error: {} }, 1000), false);
  assert.equal(no(w, 'Cada Mensagem').type, 'n8n-nodes-base.splitInBatches');
  assert.equal(no(w, 'Cada Mensagem').parameters.batchSize, 1);
  assert.deepEqual(destinos(w, 'Cada Mensagem', 0), ['Concluir?']);
  assert.deepEqual(destinos(w, 'Cada Mensagem', 1), ['Util?']);
  assert.ok(destinos(w, 'Util?', 1).includes('Cada Mensagem'));
  assert.ok(destinos(w, 'Novo?', 1).includes('Cada Mensagem'));
  assert.ok(destinos(w, 'Simular?', 0).includes('Cada Mensagem'));
  assert.ok(destinos(w, 'Tratar Humano', 0).includes('Cada Mensagem'));
  assert.ok(destinos(w, 'Processar Evento', 0).includes('Cada Mensagem'));
  assert.equal(no(w, 'Processar Evento').onError, 'continueRegularOutput');
  assert.equal(no(w, 'Processar Evento').parameters.workflowId.value, 'PROCESSAR_ID');
  const q = no(w, 'Marcar Vista').parameters.query;
  assert.ok(q.includes('mensagem_ja_vista') && q.includes('marcar_mensagem_vista') && q.includes("'recuperacao'"));
  assert.ok(no(w, 'Concluir').parameters.query.includes('concluir_recuperacao'));
  assert.ok(no(w, 'Tratar Humano').parameters.query.includes('tratar_mensagem_humana'));
  assert.ok(no(w, 'Registrar Aceito').parameters.query.includes('registrar_evento_canal'));
  for (const n of w.nodes) assert.ok(!/webhook|scheduleTrigger/i.test(n.type), n.type);
});

test('recuperar: nenhum caminho do laco fica sem voltar a Cada Mensagem', () => {
  const w = montarRecuperar(PROC);
  const fins = ['Util?:1', 'Novo?:1', 'Simular?:0', 'Tratar Humano:0', 'Processar Evento:0'];
  for (const f of fins) {
    const [n, i] = f.split(':');
    assert.ok(destinos(w, n, Number(i)).includes('Cada Mensagem'), f);
  }
  assert.deepEqual(destinos(w, 'Concluir?', 0), ['Concluir']);
});

test('alertar fora: e-mail com destino da configuracao e tarefa no CRM so quando pedido', () => {
  const w = montarAlertarFora({ id: 'GMAIL_ID', name: 'Gmail account' });
  assert.deepEqual(nomes(w), ['Execute Workflow Trigger', 'Destino', 'Enviar E-mail', 'Tarefa?', 'Criar Tarefa no CRM']);
  assert.ok(no(w, 'Destino').parameters.query.includes('alerta_email_destino'));
  assert.equal(no(w, 'Enviar E-mail').onError, 'continueRegularOutput');
  assert.equal(no(w, 'Enviar E-mail').credentials.gmailOAuth2.id, 'GMAIL_ID');
  assert.equal(no(w, 'Enviar E-mail').disabled, undefined);
  assert.equal(no(w, 'Criar Tarefa no CRM').credentials.httpHeaderAuth.id, '3CNvCGWMMDOyGD2n');
  assert.deepEqual(destinos(w, 'Tarefa?', 0), ['Criar Tarefa no CRM']);
  assert.doesNotMatch(JSON.stringify(w), /@gmail\.com|@[a-z0-9-]+\.com\.br/i);
  assert.equal(no(montarAlertarFora(null), 'Enviar E-mail').disabled, true);
});
