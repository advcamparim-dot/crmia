import test from 'node:test';
import assert from 'node:assert/strict';
import { operacoes } from './gerar-processar-patch.mjs';

const ops = operacoes();
const add = ops.filter((o) => o.type === 'addNode').map((o) => o.node);
const lig = ops.filter((o) => o.type === 'addConnection');
const rem = ops.filter((o) => o.type === 'removeConnection');
const no = (n) => add.find((x) => x.name === n);

test('resolve a sessao do lead antes da portaria nos dois caminhos de entrada', () => {
  assert.deepEqual(add.map((n) => n.name).sort(), ['Aplicar Sessão', 'Resolver Sessão']);
  assert.ok(rem.some((r) => r.source === 'Restaurar Evento' && r.target === 'Evento Autorizado?'));
  assert.ok(rem.some((r) => r.source === 'Tem Mensagem?' && r.target === 'Evento Autorizado?' && r.sourceIndex === 1));
  assert.ok(lig.some((l) => l.source === 'Restaurar Evento' && l.target === 'Resolver Sessão'));
  assert.ok(lig.some((l) => l.source === 'Tem Mensagem?' && l.target === 'Resolver Sessão' && l.sourceIndex === 1));
  assert.ok(lig.some((l) => l.source === 'Resolver Sessão' && l.target === 'Aplicar Sessão'));
  assert.ok(lig.some((l) => l.source === 'Aplicar Sessão' && l.target === 'Evento Autorizado?'));
});

test('a consulta usa a funcao do banco e falha sem derrubar o fluxo', () => {
  const r = no('Resolver Sessão');
  assert.equal(r.onError, 'continueRegularOutput');
  assert.ok(r.parameters.query.includes('mayara.com_sessao_canonica($1::jsonb)'));
  assert.equal(r.parameters.options.queryReplacement, '={{ [JSON.stringify($json)] }}');
});

test('aplicar sessao devolve o evento reescrito, ou o evento original se a consulta falhou', () => {
  const corpo = no('Aplicar Sessão').parameters.jsCode;
  const rodar = (json, original) => new Function('$json', '$', corpo)(json, () => ({ first: () => ({ json: original }) }))[0].json;
  const original = { phone: '+555195621357', sessionKey: 'whatsapp:escritorio:+555195621357', message: 'oi' };
  assert.deepEqual(rodar({ evento: { ...original, sessionKey: 'whatsapp:escritorio:+5551995621357' } }, original),
    { ...original, sessionKey: 'whatsapp:escritorio:+5551995621357' });
  assert.deepEqual(rodar({ error: { message: 'falhou' } }, original), original);
  assert.deepEqual(rodar({}, original), original);
  assert.deepEqual(rodar({ evento: null }, original), original);
});
