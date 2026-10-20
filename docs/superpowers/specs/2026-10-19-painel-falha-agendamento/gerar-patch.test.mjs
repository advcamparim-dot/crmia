import test from 'node:test';
import assert from 'node:assert/strict';
import { aplicarPatch, NOME_NO } from './gerar-patch.mjs';

// Estado vivo do workflow "Avisar Falha de Agendamento" (4 nos), reduzido ao que o patch toca.
const vivo = () => ({
  name: 'Mayara — Avisar Falha de Agendamento [Sub-workflow]',
  nodes: [
    { id: 'a', name: 'Execute Workflow Trigger', type: 'n8n-nodes-base.executeWorkflowTrigger', position: [0, 0], parameters: {} },
    { id: 'b', name: 'Falha Tecnica?', type: 'n8n-nodes-base.if', position: [224, 0], parameters: {} },
    { id: 'c', name: 'Avisar Administrador', type: 'n8n-nodes-base.executeWorkflow', position: [480, -100], onError: 'continueRegularOutput', parameters: { x: 1 } },
    { id: 'd', name: 'Criar Task de Reserva', type: 'n8n-nodes-base.httpRequest', position: [480, 100], onError: 'continueRegularOutput', parameters: { y: 2 } },
  ],
  connections: {
    'Execute Workflow Trigger': { main: [[{ node: 'Falha Tecnica?', type: 'main', index: 0 }]] },
    'Falha Tecnica?': { main: [[{ node: 'Avisar Administrador', type: 'main', index: 0 }, { node: 'Criar Task de Reserva', type: 'main', index: 0 }], []] },
  },
  settings: { executionOrder: 'v1', errorWorkflow: 'CQyjBKLX0UheNh1q' },
});

test('acrescenta um no Postgres que registra a falha no painel', () => {
  const wf = aplicarPatch(vivo());
  const no = wf.nodes.find((n) => n.name === NOME_NO);
  assert.ok(no, 'no novo existe');
  assert.equal(no.type, 'n8n-nodes-base.postgres');
  assert.match(no.parameters.query, /painel\.registrar_falha_agendamento\(\$1, \$2\)/);
  assert.equal(no.credentials.postgres.id, 'nNpCUIhnDuVvTApU');
});

test('o telefone vem do sessionId e o motivo do motivoFalha', () => {
  const no = aplicarPatch(vivo()).nodes.find((n) => n.name === NOME_NO);
  const expr = no.parameters.options.queryReplacement;
  assert.match(expr, /sessionId/);
  assert.match(expr, /split\(':'\)\[2\]/);
  assert.match(expr, /motivoFalha/);
});

test('nunca atrapalha o aviso ao administrador: erro do no segue em frente', () => {
  const no = aplicarPatch(vivo()).nodes.find((n) => n.name === NOME_NO);
  assert.equal(no.onError, 'continueRegularOutput');
});

test('entra no ramo de falha tecnica, em paralelo, sem remover as ligacoes existentes', () => {
  const wf = aplicarPatch(vivo());
  const verdadeiro = wf.connections['Falha Tecnica?'].main[0].map((c) => c.node);
  assert.deepEqual(verdadeiro, ['Avisar Administrador', 'Criar Task de Reserva', NOME_NO]);
  assert.deepEqual(wf.connections['Falha Tecnica?'].main[1], []);
  assert.deepEqual(wf.connections['Execute Workflow Trigger'], vivo().connections['Execute Workflow Trigger']);
  assert.equal(wf.connections[NOME_NO], undefined, 'o novo no nao liga a mais nada');
});

test('nao altera os nos existentes nem as configuracoes do workflow', () => {
  const antes = vivo();
  const wf = aplicarPatch(vivo());
  for (const n of antes.nodes) assert.deepEqual(wf.nodes.find((x) => x.name === n.name), n);
  assert.deepEqual(wf.settings, antes.settings);
  assert.equal(wf.nodes.length, antes.nodes.length + 1);
});

test('e idempotente: aplicar duas vezes nao duplica o no nem a ligacao', () => {
  const uma = aplicarPatch(vivo());
  const duas = aplicarPatch(structuredClone(uma));
  assert.equal(duas.nodes.filter((n) => n.name === NOME_NO).length, 1);
  assert.equal(duas.connections['Falha Tecnica?'].main[0].filter((c) => c.node === NOME_NO).length, 1);
});

test('recusa aplicar em um workflow que nao tem o ramo esperado', () => {
  const quebrado = vivo();
  delete quebrado.connections['Falha Tecnica?'];
  assert.throws(() => aplicarPatch(quebrado), /Falha Tecnica\?/);
});

test('nao leva segredos nem telefones reais', () => {
  const texto = JSON.stringify(aplicarPatch(vivo()));
  assert.doesNotMatch(texto, /apikey|api_key|password|token|\+55\d{10,11}/i);
});
