import test from 'node:test';
import assert from 'node:assert/strict';
import { estadoReal, textoAlerta } from './vigia.mjs';

test('estadoReal le o estado da Evolution e trata falha como inalcancavel', () => {
  assert.equal(estadoReal({ instance: { instanceName: 'escritorio', state: 'open' } }), 'open');
  assert.equal(estadoReal({ state: 'connecting' }), 'connecting');
  assert.equal(estadoReal({ instance: { state: 'close' } }), 'close');
  assert.equal(estadoReal({ instance: { state: 'refused' } }), 'close');
  assert.equal(estadoReal({ error: 'timeout' }), 'inalcancavel');
  assert.equal(estadoReal({ message: 'Not Found', statusCode: 404 }), 'inalcancavel');
  assert.equal(estadoReal(null), 'inalcancavel');
  assert.equal(estadoReal(undefined), 'inalcancavel');
  assert.equal(estadoReal('texto'), 'inalcancavel');
});

test('textoAlerta explica o que fazer sem inventar o motivo', () => {
  const a = textoAlerta('alertar', 12, 3);
  assert.match(a.assunto, /WhatsApp do escritório fora do ar/);
  assert.match(a.texto, /12 minutos/);
  assert.match(a.texto, /3 tentativas de reinício/);
  assert.match(a.texto, /Conectar/);
  assert.match(a.texto, /podem não ser recuperadas/);
  const l = textoAlerta('lembrar', 135, 3);
  assert.match(l.assunto, /continua fora do ar/);
  assert.match(l.texto, /2 horas e 15 minutos/);
  assert.doesNotMatch(l.texto, /senha|token|chave/i);
});
