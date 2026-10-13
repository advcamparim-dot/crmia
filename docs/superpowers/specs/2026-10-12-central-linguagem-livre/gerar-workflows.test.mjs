import test from 'node:test';
import assert from 'node:assert/strict';
import { montarInterpretarLivre } from './gerar-workflows.mjs';

const w = montarInterpretarLivre();
const no = (nome) => w.nodes.find((n) => n.name === nome);

test('nome, nos e ligacoes do sub-workflow', () => {
  assert.equal(w.name, 'Mayara — Central: Interpretar Livre [Sub-workflow]');
  assert.deepEqual(w.nodes.map((n) => n.name).sort(), ['Execute Workflow Trigger', 'Interpretar', 'Interpretar IA', 'Modelo Anthropic', 'Pedido Livre'].sort());
  assert.equal(w.connections['Execute Workflow Trigger'].main[0][0].node, 'Pedido Livre');
  assert.equal(w.connections['Pedido Livre'].main[0][0].node, 'Interpretar IA');
  assert.equal(w.connections['Interpretar IA'].main[0][0].node, 'Interpretar');
  assert.equal(w.connections['Modelo Anthropic'].ai_languageModel[0][0].node, 'Interpretar IA');
});

test('sem webhook, sem trigger publico, com workflow de erro e entrada so de texto', () => {
  for (const n of w.nodes) assert.ok(!/webhook|formTrigger|chatTrigger|scheduleTrigger/i.test(n.type), n.type);
  assert.equal(w.settings.errorWorkflow, 'CQyjBKLX0UheNh1q');
  const t = no('Execute Workflow Trigger');
  assert.equal(t.type, 'n8n-nodes-base.executeWorkflowTrigger');
  assert.deepEqual(t.parameters.workflowInputs.values, [{ name: 'texto', type: 'string' }]);
});

test('modelo igual ao do ensino atual e falha do modelo nao derruba o fluxo', () => {
  const m = no('Modelo Anthropic');
  assert.equal(m.parameters.model.value, 'claude-sonnet-4-5-20250929');
  assert.equal(m.parameters.options.temperature, 0);
  assert.equal(m.credentials.anthropicApi.id, '6U02h1ioNpD09Q99');
  assert.equal(no('Interpretar IA').onError, 'continueRegularOutput');
  assert.equal(no('Interpretar IA').parameters.text, '={{ $json.prompt }}');
});

test('o codigo dos nos nao tem import/export e le o texto da entrada do sub-workflow', () => {
  const pedido = no('Pedido Livre').parameters.jsCode;
  const interp = no('Interpretar').parameters.jsCode;
  assert.ok(pedido.includes("$('Execute Workflow Trigger').first().json.texto"));
  assert.ok(!pedido.includes("$('Classificar')"));
  assert.ok(interp.includes('interpretarResposta('));
  for (const js of [pedido, interp]) assert.equal(/^\s*(import|export)\s/m.test(js), false);
});
