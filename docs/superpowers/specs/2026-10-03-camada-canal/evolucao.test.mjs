import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizarEvolution, extrairTexto, extrairEstado, ehEventoDeEstado } from './evolucao.mjs';

const base = (data = {}, extra = {}) => ({
  event: 'messages.upsert',
  instance: 'escritorio',
  data: {
    key: { remoteJid: '5514997022609@s.whatsapp.net', fromMe: false, id: 'ABC123' },
    pushName: 'Joao',
    message: { conversation: 'Oi, preciso de ajuda' },
    messageType: 'conversation',
    messageTimestamp: 1790000000,
    ...data,
  },
  ...extra,
});

test('mensagem de texto vira o evento normalizado igual ao da Meta', () => {
  const r = normalizarEvolution(base());
  assert.equal(r.acao, 'processar');
  assert.deepEqual(r.evento, {
    accepted: true, reason: 'ACEITO', channel: 'WhatsApp', provedor: 'evolution',
    phone: '+5514997022609', profileName: 'Joao', message: 'Oi, preciso de ajuda', messageType: 'text',
    messageId: 'ABC123', timestamp: new Date(1790000000 * 1000).toISOString(),
    phoneNumberId: 'escritorio', canalId: 'escritorio', displayPhoneNumber: '',
    sessionKey: 'whatsapp:escritorio:+5514997022609', dedupeKey: 'ABC123',
    campaignSourceId: '', campaignSourceUrl: '', campaignHeadline: '',
    requiresHuman: false, processingBlocked: true,
  });
});

test('o nome do evento aceita maiusculas e underscore', () => {
  assert.equal(normalizarEvolution(base({}, { event: 'MESSAGES_UPSERT' })).acao, 'processar');
});

test('extrairTexto cobre os formatos de texto, botao e lista', () => {
  assert.equal(extrairTexto({ conversation: ' a ' }), 'a');
  assert.equal(extrairTexto({ extendedTextMessage: { text: 'b' } }), 'b');
  assert.equal(extrairTexto({ buttonsResponseMessage: { selectedDisplayText: 'c' } }), 'c');
  assert.equal(extrairTexto({ listResponseMessage: { title: 'd' } }), 'd');
  assert.equal(extrairTexto({ templateButtonReplyMessage: { selectedDisplayText: 'e' } }), 'e');
  assert.equal(extrairTexto({ imageMessage: { caption: 'foto' } }), '');
  assert.equal(extrairTexto(null), '');
});

test('descartes que nao tocam o banco: grupo, status, newsletter, outra instancia, outro evento', () => {
  const casos = [
    [base({ key: { remoteJid: '120363@g.us', fromMe: false, id: 'X', participant: '5514997022609@s.whatsapp.net' } }), 'grupo'],
    [base({ key: { remoteJid: '120363@g.us', fromMe: true, id: 'X' } }), 'grupo'],
    [base({ key: { remoteJid: 'status@broadcast', fromMe: false, id: 'X' } }), 'status'],
    [base({ key: { remoteJid: '1203@newsletter', fromMe: false, id: 'X' } }), 'newsletter'],
    [base({}, { instance: 'outra' }), 'instancia_inesperada'],
    [base({}, { event: 'connection.update' }), 'evento_nao_mensagem'],
  ];
  for (const [corpo, motivo] of casos) {
    const r = normalizarEvolution(corpo);
    assert.equal(r.acao, 'descartar', motivo);
    assert.equal(r.motivo, motivo);
  }
});

test('mensagem enviada pelo escritorio: a da propria Mayara e descartada; a de um humano vira acao humano', () => {
  const doHumano = normalizarEvolution(base({ key: { remoteJid: '5514997022609@s.whatsapp.net', fromMe: true, id: 'H1' }, message: { conversation: 'Oi, aqui e o Dr. Santo' } }));
  assert.deepEqual(doHumano, { acao: 'humano', canalId: 'escritorio', phone: '+5514997022609', messageId: 'H1', texto: 'Oi, aqui e o Dr. Santo', timestamp: new Date(1790000000 * 1000).toISOString() });
  const daMayara = normalizarEvolution(base({ key: { remoteJid: '5514997022609@s.whatsapp.net', fromMe: true, id: 'M1' }, message: { conversation: '*Mayara:*\nOi!' } }));
  assert.deepEqual([daMayara.acao, daMayara.motivo], ['descartar', 'enviada_por_mim']);
  const midiaDoHumano = normalizarEvolution(base({ key: { remoteJid: '5514997022609@s.whatsapp.net', fromMe: true, id: 'H2' }, message: { imageMessage: {} }, messageType: 'imageMessage' }));
  assert.equal(midiaDoHumano.acao, 'humano');
  assert.equal(midiaDoHumano.texto, '');
  const lid = normalizarEvolution(base({ key: { remoteJid: '99887766@lid', remoteJidAlt: '5514997022609@s.whatsapp.net', fromMe: true, id: 'H3' }, message: { conversation: 'oi' } }));
  assert.equal(lid.phone, '+5514997022609');
  const lidSem = normalizarEvolution(base({ key: { remoteJid: '99887766@lid', fromMe: true, id: 'H4' }, message: { conversation: 'oi' } }));
  assert.deepEqual([lidSem.acao, lidSem.motivo], ['descartar', 'lid_sem_telefone']);
  const reacao = normalizarEvolution(base({ key: { remoteJid: '5514997022609@s.whatsapp.net', fromMe: true, id: 'H5' }, message: { reactionMessage: { text: 'ok' } }, messageType: 'reactionMessage' }));
  assert.deepEqual([reacao.acao, reacao.motivo], ['descartar', 'tipo_ignorado']);
});

const emb = (message) => base({ message, messageType: Object.keys(message || {})[0] });

test('mensagens embrulhadas (temporaria, visualizacao unica, documento com legenda) sao desembrulhadas', () => {
  const texto = normalizarEvolution(emb({ ephemeralMessage: { message: { conversation: 'oi, preciso de ajuda' } } }));
  assert.equal(texto.acao, 'processar');
  assert.equal(texto.evento.message, 'oi, preciso de ajuda');
  assert.equal(texto.evento.requiresHuman, false);
  assert.equal(texto.evento.messageType, 'text');
  const estendido = normalizarEvolution(emb({ ephemeralMessage: { message: { extendedTextMessage: { text: 'com link' } } } }));
  assert.equal(estendido.evento.message, 'com link');
  const foto = normalizarEvolution(emb({ viewOnceMessage: { message: { imageMessage: {} } } }));
  assert.equal(foto.evento.requiresHuman, true);
  assert.equal(foto.evento.messageType, 'imageMessage');
  const v2 = normalizarEvolution(emb({ viewOnceMessageV2: { message: { videoMessage: {} } } }));
  assert.equal(v2.evento.messageType, 'videoMessage');
  const doc = normalizarEvolution(emb({ documentWithCaptionMessage: { message: { documentMessage: { caption: 'contrato' } } } }));
  assert.equal(doc.evento.requiresHuman, true);
  assert.equal(doc.evento.messageType, 'documentMessage');
  const duplo = normalizarEvolution(emb({ ephemeralMessage: { message: { viewOnceMessage: { message: { conversation: 'fundo' } } } } }));
  assert.equal(duplo.evento.message, 'fundo');
  const reacaoTemp = normalizarEvolution(emb({ ephemeralMessage: { message: { reactionMessage: { text: 'x' } } } }));
  assert.deepEqual([reacaoTemp.acao, reacaoTemp.motivo], ['descartar', 'tipo_ignorado']);
});

test('embrulhos hostis nao entram em laco nem lancam excecao', () => {
  let ciclo = { conversation: 'x' };
  for (let i = 0; i < 50; i++) ciclo = { ephemeralMessage: { message: ciclo } };
  assert.doesNotThrow(() => normalizarEvolution(emb(ciclo)));
  assert.doesNotThrow(() => normalizarEvolution(emb({ ephemeralMessage: null })));
  assert.doesNotThrow(() => normalizarEvolution(emb({ ephemeralMessage: { message: 'texto' } })));
});

test('reacao, edicao e exclusao sao descartadas', () => {
  for (const message of [{ reactionMessage: { text: '👍' } }, { protocolMessage: { type: 0 } }, { editedMessage: {} }]) {
    const r = normalizarEvolution(base({ message, messageType: Object.keys(message)[0] }));
    assert.equal(r.acao, 'descartar');
    assert.equal(r.motivo, 'tipo_ignorado');
  }
});

test('identificador @lid usa o telefone alternativo; sem ele, descarta e registra', () => {
  const comAlt = normalizarEvolution(base({ key: { remoteJid: '99887766@lid', remoteJidAlt: '5514997022609@s.whatsapp.net', fromMe: false, id: 'L1' } }));
  assert.equal(comAlt.acao, 'processar');
  assert.equal(comAlt.evento.phone, '+5514997022609');
  const sem = normalizarEvolution(base({ key: { remoteJid: '99887766@lid', fromMe: false, id: 'L2' } }));
  assert.deepEqual([sem.acao, sem.motivo], ['descartar', 'lid_sem_telefone']);
});

test('sufixo de dispositivo no JID e removido', () => {
  const r = normalizarEvolution(base({ key: { remoteJid: '5514997022609:12@s.whatsapp.net', fromMe: false, id: 'D1' } }));
  assert.equal(r.evento.phone, '+5514997022609');
});

test('audio, imagem, documento e figurinha exigem humano, como hoje', () => {
  for (const [tipo, message] of [['audioMessage', { audioMessage: {} }], ['imageMessage', { imageMessage: {} }], ['documentMessage', { documentMessage: {} }], ['stickerMessage', { stickerMessage: {} }], ['videoMessage', { videoMessage: {} }]]) {
    const r = normalizarEvolution(base({ message, messageType: tipo }));
    assert.equal(r.acao, 'processar', tipo);
    assert.equal(r.evento.requiresHuman, true, tipo);
    assert.equal(r.evento.message, '', tipo);
    assert.equal(r.evento.messageType, tipo);
  }
});

test('payload incompleto e entradas hostis nao lancam excecao', () => {
  for (const corpo of [null, undefined, 5, 'x', [], {}, { event: 'messages.upsert' }, base({ key: null }), base({ key: { remoteJid: 'lixo', id: 'X' } }), base({ key: { remoteJid: '5514997022609@s.whatsapp.net' } })]) {
    const r = normalizarEvolution(corpo);
    assert.equal(r.acao, 'descartar', JSON.stringify(corpo));
    assert.ok(r.motivo);
  }
});

test('timestamp invalido cai para agora e numero de texto grande e aceito', () => {
  const r = normalizarEvolution(base({ messageTimestamp: undefined }));
  assert.ok(!Number.isNaN(Date.parse(r.evento.timestamp)));
  const longo = normalizarEvolution(base({ message: { conversation: 'x'.repeat(5000) } }));
  assert.equal(longo.evento.message.length, 5000);
});

test('connection.update: extrai o estado da conexao e reconhece o tipo de evento', () => {
  const ev = (state, extra = {}) => ({ event: 'connection.update', instance: 'escritorio', data: { instance: 'escritorio', state, statusReason: 200 }, ...extra });
  assert.equal(ehEventoDeEstado(ev('open')), true);
  assert.equal(ehEventoDeEstado({ event: 'CONNECTION_UPDATE' }), true);
  assert.equal(ehEventoDeEstado(base()), false);
  assert.equal(ehEventoDeEstado(null), false);
  assert.deepEqual(extrairEstado(ev('open')), { valido: true, canalId: 'escritorio', estado: 'open' });
  assert.deepEqual(extrairEstado(ev('CLOSE')), { valido: true, canalId: 'escritorio', estado: 'close' });
  assert.deepEqual(extrairEstado(ev('connecting')), { valido: true, canalId: 'escritorio', estado: 'connecting' });
  for (const ruim of [ev('open', { instance: 'outra' }), ev(undefined), ev('qualquer'), { event: 'connection.update', instance: 'escritorio' }, null, 'x', [], base()]) {
    assert.equal(extrairEstado(ruim).valido, false, JSON.stringify(ruim));
  }
});

test('o codigo-fonte nao tem caracteres invisiveis ou combinantes literais', () => {
  const fonte = readFileSync(new URL('./evolucao.mjs', import.meta.url), 'utf8');
  const proibido = (c) => (c >= 0x300 && c <= 0x36f) || (c >= 0x200b && c <= 0x200f) || c === 0x2028 || c === 0x2029 || c === 0xfeff;
  const achados = [];
  for (let i = 0; i < fonte.length; i++) if (proibido(fonte.charCodeAt(i))) achados.push(i);
  assert.deepEqual(achados, []);
});
