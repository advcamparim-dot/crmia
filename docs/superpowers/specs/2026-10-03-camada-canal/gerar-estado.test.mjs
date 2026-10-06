import test from 'node:test';
import assert from 'node:assert/strict';
import { montarWorkflow, corpoNode, RODAPE_EXTRAIR } from './gerar-estado.mjs';

const wf = montarWorkflow();
const nomes = wf.nodes.map((n) => n.name);
const sai = (o, i = 0) => (wf.connections[o]?.main?.[i] ?? []).map((c) => c.node);
const no = (n) => wf.nodes.find((x) => x.name === n);

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

test('fluxo: extrai, valida, registra, e so cria a tarefa quando a funcao manda alertar', () => {
  assert.equal(no('Execute Workflow Trigger').parameters.inputSource, 'passthrough');
  assert.deepEqual(sai('Execute Workflow Trigger'), ['Extrair Estado']);
  assert.deepEqual(sai('Extrair Estado'), ['Estado Valido?']);
  assert.deepEqual(sai('Estado Valido?', 0), ['Registrar Estado']);
  assert.deepEqual(sai('Estado Valido?', 1), []);
  assert.deepEqual(sai('Registrar Estado'), ['Alertar?']);
  assert.deepEqual(sai('Alertar?', 0), ['Criar Tarefa no CRM']);
  assert.deepEqual(sai('Alertar?', 1), []);
  assert.match(no('Registrar Estado').parameters.query, /registrar_estado_canal\(\$1, \$2\)/);
  assert.match(no('Alertar?').parameters.conditions.conditions[0].leftValue, /\.r\.alertar === true/);
});

test('a tarefa do CRM usa a credencial de alertas, prioridade alta, e nao leva dados de conversa', () => {
  const t = no('Criar Tarefa no CRM');
  assert.equal(t.type, 'n8n-nodes-base.httpRequest');
  assert.equal(t.credentials.httpHeaderAuth.id, 'myYur8JVp4IuNL3w');
  assert.equal(t.parameters.url, 'https://crm.camparimadvogados.com.br/api/v1/Task');
  assert.equal(t.onError, 'continueRegularOutput');
  const corpo = t.parameters.jsonBody;
  assert.match(corpo, /priority: 'High'/);
  assert.match(corpo, /cAlertSeverity: 'Alta'/);
  assert.match(corpo, /cAlertKey: 'WHATSAPP_LINHA_CAIDA_V1:'/);
  assert.ok(!/message|mensagem/i.test(corpo.replace(/messageId|WhatsAppMessage/g, '')), 'sem conteudo de conversa');
});

test('o Code node gerado e JS valido e rejeita payload hostil sem lancar', () => {
  const c = corpoNode(RODAPE_EXTRAIR);
  assert.ok(!/^\s*(import|export)\s/m.test(c));
  const roda = (json) => new Function('$input', c)({ first: () => ({ json }) })[0].json;
  assert.equal(roda({ event: 'connection.update', instance: 'escritorio', data: { state: 'close' } }).estado, 'close');
  assert.equal(roda({ event: 'connection.update', instance: 'escritorio', data: { state: 'close' } }).valido, true);
  assert.equal(roda(null).valido, false);
  assert.equal(roda({}).valido, false);
});

test('configuracao: credenciais e workflow de erro', () => {
  assert.equal(wf.settings.errorWorkflow, 'CQyjBKLX0UheNh1q');
  assert.ok(JSON.stringify(wf).includes('nNpCUIhnDuVvTApU'));
});
