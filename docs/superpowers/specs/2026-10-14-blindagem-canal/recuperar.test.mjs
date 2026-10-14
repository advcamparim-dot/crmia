import test from 'node:test';
import assert from 'node:assert/strict';
import { janelaBusca, corpoBusca, temMaisPaginas, statusBusca, extrairRegistros, registroParaEvento, prepararLote } from './recuperar.mjs';

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

test('corpo de busca nao filtra por data (a Evolution v2.3.7 ignora o filtro) e so pagina', () => {
  assert.deepEqual(corpoBusca(1, 200), { where: {}, page: 1, offset: 200 });
  assert.deepEqual(corpoBusca(3, 200), { where: {}, page: 3, offset: 200 });
});

test('busca mais paginas so se a pagina veio cheia e o registro mais antigo ainda esta na janela', () => {
  const j = janelaBusca('2026-10-20T14:00:00.000Z', AGORA);
  const cheia = (tsAntigo) => ({ messages: { records: [...Array(199).fill(0).map((_, i) => reg('N' + i, epoch(AGORA) - i)), reg('ANT', tsAntigo)] } });
  assert.equal(temMaisPaginas(cheia(j.gte + 60), j, 200), true);
  assert.equal(temMaisPaginas(cheia(j.gte - 60), j, 200), false);
  assert.equal(temMaisPaginas({ messages: { records: [reg('A', j.gte + 60)] } }, j, 200), false);
  assert.equal(temMaisPaginas({ messages: { records: [] } }, j, 200), false);
  assert.equal(temMaisPaginas(null, j, 200), false);
  assert.equal(temMaisPaginas({ error: 'x' }, j, 200), false);
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

test('status da busca: so e completa se nenhuma pagina falhou e a janela inteira foi coberta', () => {
  const j = janelaBusca('2026-10-20T14:00:00.000Z', AGORA);
  const cheia = (tsAntigo) => ({ messages: { records: [...Array(199).fill(0).map((_, i) => reg('N' + i, epoch(AGORA) - i)), reg('ANT', tsAntigo)] } });
  const curta = { messages: { records: [reg('A', j.gte + 60)] } };
  const vazia = { messages: { total: 0, records: [] } };
  // pagina curta ou vazia: acabou o historico
  assert.deepEqual(statusBusca([curta], j, 200, 4), { completo: true, motivo: 'ok' });
  assert.deepEqual(statusBusca([vazia], j, 200, 4), { completo: true, motivo: 'ok' });
  // pagina cheia que ja saiu da janela: coberta
  assert.deepEqual(statusBusca([cheia(j.gte - 60)], j, 200, 4), { completo: true, motivo: 'ok' });
  // varias paginas, a ultima fecha a janela
  assert.deepEqual(statusBusca([cheia(j.gte + 60), cheia(j.gte + 30), curta], j, 200, 4), { completo: true, motivo: 'ok' });
  // falha de busca: nenhuma pagina, erro, resposta sem records
  assert.deepEqual(statusBusca([], j, 200, 4), { completo: false, motivo: 'busca_falhou' });
  assert.deepEqual(statusBusca([{ error: { message: 'timeout' } }], j, 200, 4), { completo: false, motivo: 'busca_falhou' });
  assert.deepEqual(statusBusca([cheia(j.gte + 60), { error: {} }], j, 200, 4), { completo: false, motivo: 'busca_falhou' });
  assert.deepEqual(statusBusca([null], j, 200, 4), { completo: false, motivo: 'busca_falhou' });
  assert.deepEqual(statusBusca([{ messages: {} }], j, 200, 4), { completo: false, motivo: 'busca_falhou' });
  // no limite de paginas e ainda dentro da janela: truncada
  const quatro = [cheia(j.gte + 90), cheia(j.gte + 80), cheia(j.gte + 70), cheia(j.gte + 60)];
  assert.deepEqual(statusBusca(quatro, j, 200, 4), { completo: false, motivo: 'janela_truncada' });
  assert.deepEqual(statusBusca([cheia(j.gte + 90), cheia(j.gte + 80), cheia(j.gte + 70), cheia(j.gte - 5)], j, 200, 4), { completo: true, motivo: 'ok' });
});
