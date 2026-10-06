import test from 'node:test';
import assert from 'node:assert/strict';
import { montarWorkflow, corpoNode, RODAPE_PREPARAR, RODAPE_CORPO_META, RODAPE_INTERPRETAR, RODAPE_CORPO_EVOLUTION, RODAPE_INTERPRETAR_EVOLUTION } from './gerar-enviar.mjs';

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
  for (const r of [RODAPE_PREPARAR, RODAPE_CORPO_META, RODAPE_INTERPRETAR, RODAPE_CORPO_EVOLUTION, RODAPE_INTERPRETAR_EVOLUTION]) {
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

const no = (n) => wf.nodes.find((x) => x.name === n);
const sai = (o, i = 0) => (wf.connections[o]?.main?.[i] ?? []).map((c) => c.node);
const pedido = (extra = {}) => ({ canalId: 'escritorio', para: '5514997022609', tipo: 'texto', texto: 'Oi', templateNome: '', templateVariaveis: [], identificar: true, origem: 't', ...extra });
const rodaEvo = (p, corpoTpl) => new Function('$input', '$', corpoNode(RODAPE_CORPO_EVOLUTION))(
  { first: () => ({ json: { corpo: corpoTpl } }) }, () => ({ first: () => ({ json: { pedido: p } }) }))[0].json;

test('ramo evolution: template, corpo, envio, interpretacao e registro', () => {
  assert.deepEqual(sai('Roteador', 1), ['Texto do Template']);
  assert.deepEqual(sai('Texto do Template'), ['Corpo Evolution']);
  assert.deepEqual(sai('Corpo Evolution'), ['Evolution Pronto?']);
  assert.deepEqual(sai('Evolution Pronto?', 0), ['Enviar Evolution']);
  assert.deepEqual(sai('Evolution Pronto?', 1), ['Registrar Envio']);
  assert.deepEqual(sai('Enviar Evolution'), ['Interpretar Evolution']);
  assert.deepEqual(sai('Interpretar Evolution'), ['Registrar Envio']);
  assert.ok(!nomes.includes('Evolution Indisponivel'));
});

test('Corpo Evolution: texto sai com delay; template sem texto cadastrado nao envia', () => {
  const ok = rodaEvo(pedido(), null);
  assert.equal(ok.evo.caminho, '/message/sendText/escritorio');
  assert.equal(ok.evo.corpo.text, '*Mayara:*\nOi');
  assert.ok(ok.evo.corpo.delay >= 1000 && ok.evo.corpo.delay <= 4000);
  assert.equal(ok.resultado, undefined);
  const semTpl = rodaEvo(pedido({ tipo: 'template', texto: '', templateNome: 'lembrete', templateVariaveis: ['Ana'] }), null);
  assert.equal(semTpl.evo, undefined);
  assert.equal(semTpl.resultado.ok, false);
  assert.match(semTpl.resultado.error.message, /template/);
  const comTpl = rodaEvo(pedido({ tipo: 'template', texto: '', templateNome: 'lembrete', templateVariaveis: ['Ana'], identificar: false }), 'Ola {{1}}');
  assert.equal(comTpl.evo.corpo.text, 'Ola Ana');
});

test('Enviar Evolution: credencial, URL do servico e unico no ramo', () => {
  const e = no('Enviar Evolution');
  assert.equal(e.parameters.method, 'POST');
  assert.ok(e.parameters.url.includes('https://evolution.camparimadvogados.com.br'));
  assert.ok(e.parameters.url.includes('$json.evo.caminho'));
  assert.equal(e.credentials.httpHeaderAuth.id, 'vA1UKEhHVqwcLGWW');
  assert.equal(e.onError, 'continueRegularOutput');
  assert.ok(e.parameters.options.timeout >= 25000, 'o delay de ate 4 s cabe no timeout');
});

test('configuracao: credenciais, workflow de erro e envios por provedor', () => {
  assert.equal(wf.settings.errorWorkflow, 'CQyjBKLX0UheNh1q');
  const json = JSON.stringify(wf);
  assert.ok(json.includes('nNpCUIhnDuVvTApU') && json.includes('SChAKcHay4ghJVwe') && json.includes('vA1UKEhHVqwcLGWW'));
  const http = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.httpRequest');
  assert.deepEqual(http.map((n) => n.name).sort(), ['Enviar Evolution', 'Enviar Meta']);
});
