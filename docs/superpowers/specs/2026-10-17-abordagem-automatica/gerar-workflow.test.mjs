// docs/superpowers/specs/2026-10-17-abordagem-automatica/gerar-workflow.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { montarWorkflow } from './gerar-workflow.mjs';

const wf = montarWorkflow();
const porNome = (n) => wf.nodes.find((x) => x.name === n);

test('tem os nos esperados e um unico gatilho de agenda a cada 2 minutos', () => {
  for (const n of ['Agendar', 'Próximo', 'Enviar?', 'Enviar Primeiro Contato', 'Montar Resultado', 'Registrar', 'Pausada?', 'Montar Alerta', 'Alertar Escritório']) {
    assert.ok(porNome(n), 'falta o no ' + n);
  }
  const gatilhos = wf.nodes.filter((x) => x.type === 'n8n-nodes-base.scheduleTrigger');
  assert.equal(gatilhos.length, 1);
  assert.equal(gatilhos[0].parameters.rule.interval[0].minutesInterval, 2);
});

test('o envio usa a origem abordagem_automatica e identifica a Mayara', () => {
  const v = porNome('Enviar Primeiro Contato').parameters.workflowInputs.value;
  assert.equal(v.origem, 'abordagem_automatica');
  assert.equal(v.identificarMayara, 'true');
  assert.equal(v.canalId, 'escritorio');
  assert.equal(porNome('Enviar Primeiro Contato').onError, 'continueRegularOutput');
});

test('o no Próximo roda uma vez e chama a funcao do banco', () => {
  const n = porNome('Próximo');
  assert.equal(n.executeOnce, true);
  assert.match(n.parameters.query, /mayara\.abordagem_auto_proximo\(now\(\)\)/);
});

test('o resultado do envio vai para o registro e a pausa gera alerta', () => {
  assert.match(porNome('Registrar').parameters.query, /mayara\.abordagem_auto_registrar\(\$1::bigint, \$2::boolean, \$3\)/);
  assert.deepEqual(wf.connections['Enviar?'].main[0].map((c) => c.node), ['Enviar Primeiro Contato']);
  assert.deepEqual(wf.connections['Pausada?'].main[0].map((c) => c.node), ['Montar Alerta']);
  assert.deepEqual(wf.connections['Montar Alerta'].main[0].map((c) => c.node), ['Alertar Escritório']);
});

test('usa o workflow de erro padrao e nao tem credencial embutida alem do Postgres', () => {
  assert.equal(wf.settings.errorWorkflow, 'CQyjBKLX0UheNh1q');
  const comCredencial = wf.nodes.filter((x) => x.credentials).map((x) => Object.keys(x.credentials).join());
  assert.ok(comCredencial.every((c) => c === 'postgres'));
  assert.ok(!JSON.stringify(wf).match(/apikey|api_key|password|token/i));
});

test('Montar Resultado so considera sucesso quando ok e exatamente true (igual ao Casar Envio da Central)', () => {
  const codigo = wf.nodes.find((x) => x.name === 'Montar Resultado').parameters.jsCode;
  const rodar = (saida) => new Function('$', '$input', codigo)(
    () => ({ first: () => ({ json: { r: { proposta_id: 7 } } }) }),
    { first: () => ({ json: saida }) },
  )[0].json;
  assert.deepEqual(rodar({ ok: true }), { id: 7, ok: true, erro: '' });
  assert.deepEqual(rodar({ ok: false, error: { message: 'numero invalido' } }), { id: 7, ok: false, erro: 'numero invalido' });
  assert.equal(rodar({}).ok, false);
  assert.equal(rodar({ ok: 'true' }).ok, false);
  assert.equal(rodar({ message: 'x'.repeat(500) }).erro.length, 200);
});
