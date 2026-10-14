import test from 'node:test';
import assert from 'node:assert/strict';
import { corpoVigia, corpoJanela, corpoLote, corpoTextoAlerta } from './gerar-nodes.mjs';

const rodar = (corpo, entradas) => new Function('$', '$input', corpo)(
  (nome) => ({ first: () => ({ json: entradas[nome] || {} }), isExecuted: nome in entradas }),
  { first: () => ({ json: entradas.__input || {} }) });

test('nenhum corpo tem import/export', () => {
  for (const c of [corpoVigia, corpoJanela, corpoLote, corpoTextoAlerta]) assert.equal(/^\s*(import|export)\s/m.test(c), false);
});

test('vigia: converte a resposta da Evolution em estado', () => {
  assert.deepEqual(rodar(corpoVigia, { __input: { instance: { state: 'open' } } })[0].json, { estado: 'open' });
  assert.deepEqual(rodar(corpoVigia, { __input: { error: 'x' } })[0].json, { estado: 'inalcancavel' });
});

test('janela: usa o desde da entrada e a hora atual', () => {
  const desde = new Date(Date.now() - 3600 * 1000).toISOString();
  const j = rodar(corpoJanela, { 'Execute Workflow Trigger': { desde, simular: 'true' } })[0].json;
  assert.equal(typeof j.gte, 'number');
  assert.ok(j.lte >= j.gte + 300);
  assert.match(j.ateIso, /^\d{4}-\d\d-\d\dT/);
  assert.equal(j.simular, 'true');
  assert.equal(j.corpo, undefined);
});

test('lote: normaliza cada mensagem e termina com sentinela', () => {
  const janela = { gte: 1760972000, lte: 1760973000, ateIso: '2026-10-20T15:00:00.000Z', simular: 'false' };
  const resposta = { messages: { records: [
    { key: { id: 'IN1', fromMe: false, remoteJid: '5511999990403@s.whatsapp.net' }, messageTimestamp: 1760972500, message: { conversation: 'Quero ajuda' } },
    { key: { id: 'HUM1', fromMe: true, remoteJid: '5511999990403@s.whatsapp.net' }, messageTimestamp: 1760972600, message: { conversation: 'Já te respondo' } },
    { key: { id: 'GRP1', fromMe: false, remoteJid: '1203630@g.us' }, messageTimestamp: 1760972700, message: { conversation: 'grupo' } },
  ] } };
  const itens = rodar(corpoLote, { Janela: janela, 'Buscar 1': resposta }).map((i) => i.json);
  assert.equal(itens[itens.length - 1].fim, true);
  assert.equal(itens[itens.length - 1].simular, 'false');
  const por = Object.fromEntries(itens.filter((i) => !i.fim).map((i) => [i.messageId, i]));
  assert.equal(por.IN1.norm.acao, 'processar');
  assert.equal(por.HUM1.norm.acao, 'humano');
  assert.equal(por.HUM1.norm.texto, 'Já te respondo');
  assert.equal(por.GRP1.norm.acao, 'descartar');
});

test('texto do alerta usa a leitura do vigia', () => {
  const r = rodar(corpoTextoAlerta, { 'Registrar Leitura': { r: { acao: 'alertar', minutos_fora: 14, tentativas: 3 } } })[0].json;
  assert.match(r.assunto, /fora do ar/);
  assert.match(r.texto, /14 minutos/);
});

test('lote junta as paginas que foram buscadas e ignora as que nao rodaram', () => {
  const janela = { gte: 1760972000, lte: 1760973000, ateIso: '2026-10-20T15:00:00.000Z', simular: 'false' };
  const msg = (id, ts) => ({ key: { id, fromMe: false, remoteJid: '5511999990403@s.whatsapp.net' }, messageTimestamp: ts, message: { conversation: 'oi' } });
  const itens = rodar(corpoLote, { Janela: janela, 'Buscar 1': { messages: { records: [msg('B', 1760972600)] } }, 'Buscar 2': { messages: { records: [msg('A', 1760972100)] } } }).map((i) => i.json);
  assert.deepEqual(itens.filter((i) => !i.fim).map((i) => i.messageId), ['A', 'B']);
  const vazio = rodar(corpoLote, { Janela: janela }).map((i) => i.json);
  assert.deepEqual(vazio, [{ fim: true, ateIso: janela.ateIso, simular: 'false', completo: false, motivo: 'busca_falhou' }]);
});

test('sentinela do lote diz se a busca foi completa', () => {
  const janela = { gte: 1760972000, lte: 1760973000, ateIso: '2026-10-20T15:00:00.000Z', simular: 'false' };
  const msg = (id, ts) => ({ key: { id, fromMe: false, remoteJid: '5511999990403@s.whatsapp.net' }, messageTimestamp: ts, message: { conversation: 'oi' } });
  const fim = (entradas) => rodar(corpoLote, entradas).map((i) => i.json).find((i) => i.fim);
  assert.deepEqual([fim({ Janela: janela, 'Buscar 1': { messages: { records: [msg('A', 1760972500)] } } }).completo, fim({ Janela: janela, 'Buscar 1': { messages: { records: [msg('A', 1760972500)] } } }).motivo], [true, 'ok']);
  const falha = fim({ Janela: janela, 'Buscar 1': { error: { message: 'timeout' } } });
  assert.deepEqual([falha.completo, falha.motivo], [false, 'busca_falhou']);
  const semBusca = fim({ Janela: janela });
  assert.deepEqual([semBusca.completo, semBusca.motivo], [false, 'busca_falhou']);
});
