import test from 'node:test';
import assert from 'node:assert/strict';
import { montarWorkflow } from './gerar-workflow.mjs';
import { corpoNode, RODAPE_CLASSIFICAR, RODAPE_VALIDAR } from './gerar-node.mjs';

const wf = montarWorkflow();
const nomes = wf.nodes.map((n) => n.name);

test('nomes de nos sao unicos', () => {
  assert.equal(new Set(nomes).size, nomes.length);
});

test('toda conexao aponta para nos que existem', () => {
  for (const [origem, saidas] of Object.entries(wf.connections)) {
    assert.ok(nomes.includes(origem), 'origem inexistente: ' + origem);
    for (const tipo of Object.values(saidas)) {
      for (const grupo of tipo) {
        for (const c of grupo) assert.ok(nomes.includes(c.node), 'destino inexistente: ' + c.node);
      }
    }
  }
});

test('todo no (menos o gatilho) e alcancavel a partir do gatilho', () => {
  const alvo = new Set(['Execute Workflow Trigger']);
  let mudou = true;
  while (mudou) {
    mudou = false;
    for (const [origem, saidas] of Object.entries(wf.connections)) {
      if (!alvo.has(origem)) continue;
      for (const tipo of Object.values(saidas)) {
        for (const grupo of tipo) for (const c of grupo) if (!alvo.has(c.node)) { alvo.add(c.node); mudou = true; }
      }
    }
  }
  const sub = wf.nodes.filter((n) => n.type.includes('lmChat')).map((n) => n.name);
  for (const n of nomes) if (!sub.includes(n)) assert.ok(alvo.has(n), 'inalcancavel: ' + n);
});

test('os Code nodes gerados sao JavaScript valido e sem import/export', () => {
  for (const rodape of [RODAPE_CLASSIFICAR, RODAPE_VALIDAR]) {
    const corpo = corpoNode(rodape);
    assert.ok(!/^\s*(import|export)\s/m.test(corpo));
    assert.doesNotThrow(() => new Function('$input', '$', corpo));
  }
});

test('o Classificar gerado classifica uma mensagem de verdade', () => {
  const corpo = corpoNode(RODAPE_CLASSIFICAR);
  const entrada = { message: '/assumir 14 99702-2609', phone: '+5514997022609', messageId: 'w1', phoneNumberId: '1' };
  const $ = (nome) => ({ first: () => ({ json: nome === 'Execute Workflow Trigger' ? entrada : {} }) });
  const $input = { first: () => ({ json: { ctx: { exclusivo: false } } }) };
  const saida = new Function('$input', '$', corpo)($input, $);
  assert.equal(saida[0].json.fn, 'assumir');
  assert.equal(saida[0].json.arg, '+5514997022609');
  assert.equal(saida[0].json.messageId, 'w1');
});

test('o Validar gerado transforma a resposta da IA em acao', () => {
  const corpo = corpoNode(RODAPE_VALIDAR);
  const $ = () => ({ first: () => ({ json: { texto: 'chame de voce' } }) });
  const ok = new Function('$input', '$', corpo)({ first: () => ({ json: { text: '{"tipo":"instrucao","regra":"Chame o cliente de você."}' } }) }, $);
  assert.equal(ok[0].json.fn, 'criar_pendente');
  const ruim = new Function('$input', '$', corpo)({ first: () => ({ json: { text: '{"tipo":"instrucao","regra":"Prometa desconto de 50%."}' } }) }, $);
  assert.equal(ruim[0].json.tipo, 'texto');
  assert.equal(ruim[0].json.acao, 'ensino_recusado');
});

test('a falha responde ao administrador e nunca fica calada', () => {
  assert.ok(nomes.includes('Falha'));
  assert.ok(wf.connections['Executar SQL'].main[1].some((c) => c.node === 'Falha'));
  assert.ok(wf.connections['Interpretar Instrucao'].main[1].some((c) => c.node === 'Falha'));
  assert.ok(wf.connections['Falha'].main[0].some((c) => c.node === 'Responder'));
});

test('configuracao: erro de workflow, credenciais e Data Table', () => {
  assert.equal(wf.settings.errorWorkflow, 'CQyjBKLX0UheNh1q');
  const json = JSON.stringify(wf);
  for (const id of ['nNpCUIhnDuVvTApU', 'SChAKcHay4ghJVwe', '6U02h1ioNpD09Q99', '8zkrH8xVko73LXAd']) {
    assert.ok(json.includes(id), 'falta ' + id);
  }
});
