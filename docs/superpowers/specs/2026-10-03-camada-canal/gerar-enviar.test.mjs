import test from 'node:test';
import assert from 'node:assert/strict';
import { montarWorkflow, corpoNode, RODAPE_PREPARAR, RODAPE_CORPO_META, RODAPE_INTERPRETAR } from './gerar-enviar.mjs';

const wf = montarWorkflow();
const nomes = wf.nodes.map((n) => n.name);

test('nomes unicos e conexoes validas', () => {
  assert.equal(new Set(nomes).size, nomes.length);
  for (const [origem, saidas] of Object.entries(wf.connections)) {
    assert.ok(nomes.includes(origem), origem);
    for (const tipo of Object.values(saidas)) for (const g of tipo) for (const c of g) assert.ok(nomes.includes(c.node), c.node);
  }
});

test('todo no e alcancavel a partir do gatilho', () => {
  const alvo = new Set(['Execute Workflow Trigger']);
  let mudou = true;
  while (mudou) {
    mudou = false;
    for (const [o, s] of Object.entries(wf.connections)) {
      if (!alvo.has(o)) continue;
      for (const t of Object.values(s)) for (const g of t) for (const c of g) if (!alvo.has(c.node)) { alvo.add(c.node); mudou = true; }
    }
  }
  for (const n of nomes) assert.ok(alvo.has(n), 'inalcancavel: ' + n);
});

test('os Code nodes gerados sao JS valido e sem import/export', () => {
  for (const r of [RODAPE_PREPARAR, RODAPE_CORPO_META, RODAPE_INTERPRETAR]) {
    const c = corpoNode(r);
    assert.ok(!/^\s*(import|export)\s/m.test(c));
    assert.doesNotThrow(() => new Function('$input', '$', c));
  }
});

test('Preparar valida e Interpretar mantem o formato da Graph API', () => {
  const $ = () => ({ first: () => ({ json: { pedido: { tipo: 'texto' } } }) });
  const prep = new Function('$input', '$', corpoNode(RODAPE_PREPARAR))(
    { first: () => ({ json: { canalId: '1', para: '+55 14 99702-2609', tipo: 'texto', texto: 'Oi', identificarMayara: 'true', origem: 't' } }) }, $);
  assert.equal(prep[0].json.valido, true);
  assert.equal(prep[0].json.pedido.para, '5514997022609');
  const ruim = new Function('$input', '$', corpoNode(RODAPE_PREPARAR))({ first: () => ({ json: { canalId: '', para: '1', tipo: 'x' } }) }, $);
  assert.equal(ruim[0].json.valido, false);
  assert.equal(ruim[0].json.resultado.ok, false);
  const interp = new Function('$input', '$', corpoNode(RODAPE_INTERPRETAR))(
    { first: () => ({ json: { messages: [{ id: 'wamid.1' }] } }) }, $);
  assert.equal(interp[0].json.resultado.messages[0].id, 'wamid.1');
});

test('configuracao: credenciais, workflow de erro e provedor evolution sem envio real', () => {
  assert.equal(wf.settings.errorWorkflow, 'CQyjBKLX0UheNh1q');
  const json = JSON.stringify(wf);
  assert.ok(json.includes('nNpCUIhnDuVvTApU') && json.includes('SChAKcHay4ghJVwe'));
  const http = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.httpRequest');
  assert.deepEqual(http.map((n) => n.name), ['Enviar Meta'], 'a fase 1 so tem o envio da Meta');
  assert.ok(!JSON.stringify(http).includes('/message/sendText'), 'nenhum no HTTP envia para a Evolution');
  assert.ok(nomes.includes('Evolution Indisponivel'));
});
