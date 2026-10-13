import test from 'node:test';
import assert from 'node:assert/strict';
import { operacoes } from './gerar-central-patch.mjs';

const ops = operacoes('SUBWORKFLOW_ID');
const nos = ops.filter((o) => o.type === 'addNode').map((o) => o.node);
const lig = ops.filter((o) => o.type === 'addConnection');
const no = (nome) => nos.find((n) => n.name === nome);

test('nos novos e nomes', () => {
  assert.deepEqual(nos.map((n) => n.name).sort(), ['Atualizar Modo Livre', 'Efeito Valido?', 'Efeito?', 'Ensino do Livre', 'Interpretar Livre', 'Ler Efeito', 'Livre Ligado?', 'Saída Livre', 'Texto do Efeito'].sort());
  assert.equal(new Set(nos.map((n) => n.id)).size, nos.length);
});

test('o ramo livre da Central so desvia atras da chave', () => {
  assert.ok(no('Livre Ligado?').parameters.conditions.conditions[0].leftValue.includes("$('Contexto').first().json.ctx.livre === true"));
  assert.ok(ops.some((o) => o.type === 'removeConnection' && o.source === 'Roteador' && o.target === 'Interpretar Instrucao'));
  assert.ok(lig.some((l) => l.source === 'Roteador' && l.target === 'Livre Ligado?' && l.sourceIndex === 4));
  assert.ok(lig.some((l) => l.source === 'Livre Ligado?' && l.target === 'Interpretar Livre' && l.branch === 'true'));
  assert.ok(lig.some((l) => l.source === 'Livre Ligado?' && l.target === 'Interpretar Instrucao' && l.branch === 'false'));
});

test('o sub-workflow recebe so o texto do administrador', () => {
  const n = no('Interpretar Livre');
  assert.equal(n.parameters.workflowId.value, 'SUBWORKFLOW_ID');
  assert.deepEqual(Object.keys(n.parameters.workflowInputs.value), ['texto']);
  assert.equal(n.parameters.workflowInputs.value.texto, "={{ $('Classificar').first().json.texto }}");
  assert.equal(n.onError, 'continueRegularOutput');
});

test('saida livre: status, sql, texto e ensino; o resto vai para Falha', () => {
  const regras = no('Saída Livre').parameters.rules.values.map((r) => r.outputKey);
  assert.deepEqual(regras, ['status', 'sql', 'texto', 'ensinar']);
  assert.equal(no('Saída Livre').parameters.rules.values[0].conditions.conditions[0].leftValue, '={{ $json.acao }}');
  assert.equal(no('Saída Livre').parameters.rules.values[0].conditions.conditions[0].rightValue, 'livre_status');
  assert.ok(lig.some((l) => l.source === 'Saída Livre' && l.target === 'Ler Modo' && l.sourceIndex === 0));
  assert.ok(lig.some((l) => l.source === 'Saída Livre' && l.target === 'Executar SQL' && l.sourceIndex === 1));
  assert.ok(lig.some((l) => l.source === 'Saída Livre' && l.target === 'Finalizar' && l.sourceIndex === 2));
  assert.ok(lig.some((l) => l.source === 'Saída Livre' && l.target === 'Ensino do Livre' && l.sourceIndex === 3));
  assert.ok(lig.some((l) => l.source === 'Saída Livre' && l.target === 'Falha' && l.sourceIndex === 4));
  assert.ok(lig.some((l) => l.source === 'Ensino do Livre' && l.target === 'Validar Ensino'));
  assert.equal(no('Saída Livre').parameters.options.fallbackOutput, 'extra');
});

test('o marcador @efeito e aplicado uma vez e so com aiMode valido', () => {
  assert.ok(ops.some((o) => o.type === 'removeConnection' && o.source === 'Executar SQL' && o.target === 'Finalizar'));
  assert.ok(lig.some((l) => l.source === 'Executar SQL' && l.target === 'Efeito?' && l.sourceIndex === 0));
  assert.ok(lig.some((l) => l.source === 'Efeito?' && l.target === 'Finalizar' && l.branch === 'false'));
  assert.ok(lig.some((l) => l.source === 'Efeito?' && l.target === 'Ler Efeito' && l.branch === 'true'));
  const ler = new Function('$input', no('Ler Efeito').parameters.jsCode);
  const rodar = (resposta) => ler({ first: () => ({ json: { resposta } }) })[0].json;
  assert.deepEqual(rodar('@efeito {"tipo":"modo","aiMode":"paused"}\nPausando a Mayara para todos os leads.'), { aiMode: 'paused', resposta: 'Pausando a Mayara para todos os leads.', erro: false });
  assert.deepEqual(rodar('@efeito {"tipo":"modo","aiMode":"active"}\nLigando a Mayara.'), { aiMode: 'active', resposta: 'Ligando a Mayara.', erro: false });
  for (const ruim of ['@efeito {"tipo":"modo","aiMode":"apagar"}\nx', '@efeito nao-json\nx', '@efeito {"tipo":"sql"}\nx']) {
    const r = rodar(ruim);
    assert.equal(r.erro, true, ruim);
    assert.equal(r.resposta, 'Não consegui aplicar o efeito. Nada foi alterado.');
  }
  const atualizar = no('Atualizar Modo Livre');
  assert.equal(atualizar.parameters.columns.value.aiMode, '={{ $json.aiMode }}');
  assert.equal(atualizar.parameters.dataTableId.value, '8zkrH8xVko73LXAd');
  assert.ok(lig.some((l) => l.source === 'Efeito Valido?' && l.target === 'Atualizar Modo Livre' && l.branch === 'true'));
  assert.ok(lig.some((l) => l.source === 'Efeito Valido?' && l.target === 'Texto do Efeito' && l.branch === 'false'));
  assert.ok(lig.some((l) => l.source === 'Atualizar Modo Livre' && l.target === 'Texto do Efeito'));
  assert.ok(lig.some((l) => l.source === 'Texto do Efeito' && l.target === 'Finalizar'));
});

test('texto do efeito: aviso so ao pausar e mensagem de erro preservada', () => {
  const corpo = no('Texto do Efeito').parameters.jsCode;
  const rodar = (e) => new Function('$', corpo)(() => ({ first: () => ({ json: e }) }))[0].json.resposta;
  assert.match(rodar({ aiMode: 'paused', resposta: 'Pausando a Mayara para todos os leads.', erro: false }), /Pausando a Mayara.*aviso de pausa/);
  assert.equal(rodar({ aiMode: 'active', resposta: 'Ligando a Mayara.', erro: false }), 'Ligando a Mayara.');
  assert.equal(rodar({ aiMode: '', resposta: 'Não consegui aplicar o efeito. Nada foi alterado.', erro: true }), 'Não consegui aplicar o efeito. Nada foi alterado.');
});

test('ensino do livre repassa a regra ao Validar Ensino existente', () => {
  const f = new Function('$json', no('Ensino do Livre').parameters.jsCode);
  const r = f({ regra: 'Trate o lead pelo primeiro nome.' })[0].json;
  assert.deepEqual(JSON.parse(r.text), { tipo: 'instrucao', regra: 'Trate o lead pelo primeiro nome.' });
});
