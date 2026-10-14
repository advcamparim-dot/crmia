import test from 'node:test';
import assert from 'node:assert/strict';
import { janelaBusca, corpoBusca, extrairRegistros, registroParaEvento, prepararLote } from './recuperar.mjs';

const AGORA = '2026-10-20T15:00:00.000Z';
const reg = (id, ts, extra = {}) => ({ key: { id, fromMe: false, remoteJid: '5511999990401@s.whatsapp.net' }, messageTimestamp: ts, message: { conversation: 'oi ' + id }, ...extra });
const epoch = (iso) => Math.floor(Date.parse(iso) / 1000);

test('janela: respeita o desde, o minimo de 5 min e o teto de 48 h', () => {
  const j = janelaBusca('2026-10-20T14:00:00.000Z', AGORA);
  assert.equal(j.gte, epoch('2026-10-20T14:00:00.000Z'));
  assert.equal(j.lte, epoch(AGORA));
  assert.equal(j.ateIso, AGORA);
  assert.equal(janelaBusca('2026-10-20T14:59:00.000Z', AGORA).gte, epoch(AGORA) - 300);
  assert.equal(janelaBusca('2026-10-01T00:00:00.000Z', AGORA).gte, epoch(AGORA) - 48 * 3600);
  assert.equal(janelaBusca('lixo', AGORA).gte, epoch(AGORA) - 1800);
});

test('corpo de busca usa a janela e a paginacao', () => {
  const j = janelaBusca('2026-10-20T14:00:00.000Z', AGORA);
  assert.deepEqual(corpoBusca(j, 1, 200), { where: { messageTimestamp: { gte: j.gte, lte: j.lte } }, page: 1, offset: 200 });
});

test('extrai registros de array, de messages.records e de records', () => {
  const a = [reg('A', 1)];
  assert.deepEqual(extrairRegistros(a), a);
  assert.deepEqual(extrairRegistros({ messages: { records: a } }), a);
  assert.deepEqual(extrairRegistros({ records: a }), a);
  assert.deepEqual(extrairRegistros({ messages: { total: 0 } }), []);
  assert.deepEqual(extrairRegistros(null), []);
  assert.deepEqual(extrairRegistros({ error: 'x' }), []);
});

test('registro vira evento de webhook messages.upsert', () => {
  const e = registroParaEvento(reg('A', 10), 'escritorio');
  assert.equal(e.event, 'messages.upsert');
  assert.equal(e.instance, 'escritorio');
  assert.equal(e.data.key.id, 'A');
});

test('lote: cronologico, so dentro da janela, corta no limite e termina com sentinela', () => {
  const j = janelaBusca('2026-10-20T14:00:00.000Z', AGORA);
  const dentro = (min) => epoch('2026-10-20T14:00:00.000Z') + min * 60;
  const resp = { messages: { records: [reg('C', dentro(30)), reg('FORA', epoch('2026-10-20T13:00:00.000Z')), reg('A', dentro(5)), reg('B', dentro(10))] } };
  const lote = prepararLote(resp, 'escritorio', j, 100);
  assert.deepEqual(lote.map((i) => (i.fim ? 'FIM' : i.evento.data.key.id)), ['A', 'B', 'C', 'FIM']);
  assert.equal(lote[3].ateIso, AGORA);
  assert.deepEqual(prepararLote(resp, 'escritorio', j, 2).map((i) => (i.fim ? 'FIM' : i.evento.data.key.id)), ['A', 'B', 'FIM']);
  const vazio = prepararLote({ messages: { records: [] } }, 'escritorio', j, 100);
  assert.deepEqual(vazio, [{ fim: true, ateIso: AGORA }]);
  assert.deepEqual(prepararLote(null, 'escritorio', j, 100), [{ fim: true, ateIso: AGORA }]);
});

test('timestamp em objeto {low} tambem entra na janela', () => {
  const j = janelaBusca('2026-10-20T14:00:00.000Z', AGORA);
  const r = reg('L', { low: 0 });
  r.messageTimestamp = { low: epoch('2026-10-20T14:30:00.000Z'), high: 0 };
  const lote = prepararLote([r], 'escritorio', j, 100);
  assert.equal(lote.length, 2);
});
