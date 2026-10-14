import test from 'node:test';
import assert from 'node:assert/strict';
import { operacoes } from './gerar-receber-patch.mjs';

const ops = operacoes();
const add = ops.filter((o) => o.type === 'addNode').map((o) => o.node);
const upd = ops.filter((o) => o.type === 'updateNode');
const lig = ops.filter((o) => o.type === 'addConnection');
const rem = ops.filter((o) => o.type === 'removeConnection');
const no = (n) => add.find((x) => x.name === n);

test('marca como vista toda mensagem aceita e toda mensagem humana, sem bloquear o fluxo', () => {
  assert.deepEqual(add.map((n) => n.name).sort(), ['Marcar Vista', 'Marcar Vista Humano']);
  for (const n of add) assert.equal(n.onError, 'continueRegularOutput');
  assert.match(no('Marcar Vista').parameters.query, /marcar_mensagem_vista\(\$1, \$2, 'entrada', 'webhook'\)/);
  assert.match(no('Marcar Vista Humano').parameters.query, /marcar_mensagem_vista\(\$1, \$2, 'saida_humana', 'webhook'\)/);
  assert.ok(rem.some((r) => r.source === 'Registrar Aceito' && r.target === 'Preparar Evento'));
  assert.ok(lig.some((l) => l.source === 'Registrar Aceito' && l.target === 'Marcar Vista'));
  assert.ok(lig.some((l) => l.source === 'Marcar Vista' && l.target === 'Preparar Evento'));
  assert.ok(rem.some((r) => r.source === 'Humano?' && r.target === 'Aguardar Registro de Envio'));
  assert.ok(lig.some((l) => l.source === 'Humano?' && l.target === 'Marcar Vista Humano' && l.branch === 'true'));
  assert.ok(lig.some((l) => l.source === 'Marcar Vista Humano' && l.target === 'Aguardar Registro de Envio'));
});

test('os nos novos leem do Normalizar Evento, porque o Postgres troca o item', () => {
  assert.ok(no('Marcar Vista').parameters.options.queryReplacement.includes("$('Normalizar Evento').first().json.evento.messageId"));
  assert.ok(no('Marcar Vista Humano').parameters.options.queryReplacement.includes("$('Normalizar Evento').first().json.messageId"));
  const u = upd.find((o) => o.nodeName === 'Registrar Humano');
  assert.ok(u.updates['parameters.options.queryReplacement'].includes("$('Normalizar Evento').first().json"));
});

test('registrar humano passa a usar tratar_mensagem_humana com texto e data', () => {
  const u = upd.find((o) => o.nodeName === 'Registrar Humano');
  assert.ok(u.updates['parameters.query'].includes('tratar_mensagem_humana'));
  assert.ok(u.updates['parameters.options.queryReplacement'].includes('.texto'));
  assert.ok(u.updates['parameters.options.queryReplacement'].includes('.timestamp'));
});

test('o normalizador do webhook devolve texto e data do evento humano', () => {
  const u = upd.find((o) => o.nodeName === 'Normalizar Evento');
  const corpo = u.updates['parameters.jsCode'];
  assert.ok(corpo.includes("acao: 'humano', canalId, phone, messageId, texto, timestamp: paraIso(data.messageTimestamp)"));
  assert.equal(/^\s*(import|export)\s/m.test(corpo), false);
});
