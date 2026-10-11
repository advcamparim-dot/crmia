import test from 'node:test';
import assert from 'node:assert/strict';
import { montarWorker, montarResumo } from './gerar-workflows.mjs';

function verificar(wf) {
  const nomes = wf.nodes.map((n) => n.name);
  assert.equal(new Set(nomes).size, nomes.length, 'nomes duplicados');
  assert.equal(new Set(wf.nodes.map((n) => n.id)).size, wf.nodes.length, 'ids duplicados');
  for (const [origem, saidas] of Object.entries(wf.connections)) {
    assert.ok(nomes.includes(origem), 'origem inexistente: ' + origem);
    for (const porta of Object.values(saidas)) for (const lista of porta) for (const lig of lista) assert.ok(nomes.includes(lig.node), 'destino inexistente: ' + lig.node);
  }
  for (const n of wf.nodes) if (n.type === 'n8n-nodes-base.postgres') assert.equal(n.credentials.postgres.id, 'nNpCUIhnDuVvTApU');
  assert.equal(wf.settings.errorWorkflow, 'CQyjBKLX0UheNh1q');
}

test('Worker: estrutura valida e caminho seguro (reserva, contexto, revalida antes de enviar, simulacao nao envia)', () => {
  const wf = montarWorker();
  verificar(wf);
  const por = (n) => wf.nodes.find((x) => x.name === n);
  assert.deepEqual(por('A Cada 5 Minutos').parameters.rule.interval[0], { field: 'minutes', minutesInterval: 5 });
  assert.match(por('Reservar').parameters.query, /reservar_followups\(now\(\), 5\)/);
  assert.match(por('Reservar').parameters.query, /contexto_followup\(r\.log_id\)/);
  assert.match(por('Revalidar').parameters.query, /followup_ainda_valido/);
  // o envio so e alcancavel depois de Valido? (true) e Simulacao? (false)
  assert.deepEqual(wf.connections['Valido?'].main[0].map((l) => l.node), ['Simulacao?']);
  assert.deepEqual(wf.connections['Valido?'].main[1].map((l) => l.node), ['Cancelar']);
  assert.deepEqual(wf.connections['Simulacao?'].main[0].map((l) => l.node), ['Registrar Simulado']);
  assert.deepEqual(wf.connections['Simulacao?'].main[1].map((l) => l.node), ['Enviar Follow-up']);
  const aponta = Object.entries(wf.connections).filter(([, s]) => Object.values(s).some((p) => p.some((l) => l.some((x) => x.node === 'Enviar Follow-up')))).map(([o]) => o);
  assert.deepEqual(aponta, ['Simulacao?'], 'so Simulacao? leva ao envio');
  const envio = por('Enviar Follow-up');
  assert.equal(envio.parameters.workflowId.value, 'SHLZkNqfbCrs2OSQ');
  assert.equal(envio.parameters.workflowInputs.value.origem, 'followup');
  assert.equal(envio.parameters.workflowInputs.value.canalId, 'escritorio');
  assert.equal(envio.onError, 'continueRegularOutput');
  assert.match(por('Registrar Resultado').parameters.query, /'enviado'/);
  assert.match(por('Registrar Resultado').parameters.query, /'falhou'/);
  assert.match(por('Registrar Simulado').parameters.query, /'simulado'/);
  assert.match(por('Montar Pedido').parameters.jsCode, /function montarPedido/);
  assert.equal(/^\s*(import|export)\s/m.test(por('Escolher Texto').parameters.jsCode), false);
  assert.equal(por('Gerar Texto').onError, 'continueRegularOutput', 'falha do modelo nao derruba a rodada (cai no texto fixo)');
});

test('Resumo: dias uteis e sabado as 18:30, so com a regua ligada ou em simulacao', () => {
  const wf = montarResumo();
  verificar(wf);
  assert.equal(wf.nodes[0].parameters.rule.interval[0].expression, '30 18 * * 1-6');
  assert.equal(wf.settings.timezone, 'America/Sao_Paulo');
  assert.match(wf.nodes.find((n) => n.name === 'Ativo?').parameters.conditions.conditions[0].leftValue, /desligado/);
});
