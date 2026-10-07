import test from 'node:test';
import assert from 'node:assert/strict';
import { lerCartaoLead } from './lead-grupo.mjs';

const CARTAO = `🆕 *Novo Lead — Dr. Santo Camparim*
📋 Campanha: [MF] GESTÃO DE PASSIVO
👤 Fulano Teste

🏢 Onde está a dívida: Pessoa Jurídica (CNPJ)
💸 Valor da dívida: Entre R$100.000,00 e R$200.000,00
⏱️ Situação: Já estou em atraso.
📁 Tipo: Pronampe

📞 Telefone: +556199391304
👉 Falar agora: wa.me/556199391304`;

test('le todos os campos do cartao completo', () => {
  const r = lerCartaoLead(CARTAO);
  assert.equal(r.valido, true);
  assert.deepEqual(r.lead, {
    campanha: '[MF] GESTÃO DE PASSIVO',
    nome: 'Fulano Teste',
    ondeDivida: 'Pessoa Jurídica (CNPJ)',
    valorDivida: 'Entre R$100.000,00 e R$200.000,00',
    situacao: 'Já estou em atraso.',
    tipo: 'Pronampe',
    telefone: '+556199391304',
  });
});

test('normaliza o telefone para +55 e so digitos, venha como vier', () => {
  const com = (tel) => lerCartaoLead(CARTAO.replace('+556199391304', tel).replace('wa.me/556199391304', 'wa.me/x'));
  assert.equal(com('+55 (61) 99939-1304').lead.telefone, '+5561999391304');
  assert.equal(com('61999391304').lead.telefone, '+5561999391304');
  assert.equal(com('5561999391304').lead.telefone, '+5561999391304');
});

test('usa o link wa.me quando a linha de telefone nao existe', () => {
  const sem = CARTAO.replace(/📞 Telefone:.*\n/, '');
  assert.equal(lerCartaoLead(sem).lead.telefone, '+556199391304');
});

test('ignora mensagem que nao e cartao de lead', () => {
  assert.deepEqual(lerCartaoLead('Bom dia pessoal, tudo certo?'), { valido: false, motivo: 'nao_e_lead' });
  assert.deepEqual(lerCartaoLead(''), { valido: false, motivo: 'nao_e_lead' });
  assert.deepEqual(lerCartaoLead(null), { valido: false, motivo: 'nao_e_lead' });
});

test('cartao sem telefone nenhum e rejeitado com motivo', () => {
  const sem = CARTAO.replace(/📞 Telefone:.*\n/, '').replace(/👉.*/, '');
  assert.deepEqual(lerCartaoLead(sem), { valido: false, motivo: 'sem_telefone' });
});

test('telefone curto demais e rejeitado', () => {
  const r = lerCartaoLead(CARTAO.replace('+556199391304', '1234').replace('wa.me/556199391304', ''));
  assert.deepEqual(r, { valido: false, motivo: 'telefone_invalido' });
});

test('aceita quebra de linha do Windows e campos opcionais ausentes', () => {
  const r = lerCartaoLead(CARTAO.replace(/\n/g, '\r\n').replace(/📁 Tipo:.*\r\n/, ''));
  assert.equal(r.valido, true);
  assert.equal(r.lead.tipo, '');
  assert.equal(r.lead.nome, 'Fulano Teste');
});

test('nome ausente nao invalida o lead', () => {
  const r = lerCartaoLead(CARTAO.replace('👤 Fulano Teste\n', ''));
  assert.equal(r.valido, true);
  assert.equal(r.lead.nome, '');
});

test('nao confunde o nome com outras linhas e corta espacos', () => {
  const r = lerCartaoLead(CARTAO.replace('👤 Fulano Teste', '👤   Maria  da   Silva  '));
  assert.equal(r.lead.nome, 'Maria da Silva');
});

// ---- decidirAcao: do evento bruto da Evolution para ignorar / criar / alertar ----
import { decidirAcao } from './lead-grupo.mjs';

const GRUPO = '120363429995424499@g.us';
const evento = (message, extra = {}) => ({
  event: 'messages.upsert',
  instance: 'escritorio',
  data: { key: { remoteJid: GRUPO, fromMe: false, id: 'MSG1', participant: '5511999990001@s.whatsapp.net' }, message, ...extra },
});

test('cartao no grupo vira criar, com o id da mensagem', () => {
  const r = decidirAcao(evento({ conversation: CARTAO }), GRUPO);
  assert.equal(r.acao, 'criar');
  assert.equal(r.messageId, 'MSG1');
  assert.equal(r.lead.telefone, '+556199391304');
});

test('aceita texto estendido e mensagem temporaria embrulhada', () => {
  assert.equal(decidirAcao(evento({ extendedTextMessage: { text: CARTAO } }), GRUPO).acao, 'criar');
  assert.equal(decidirAcao(evento({ ephemeralMessage: { message: { conversation: CARTAO } } }), GRUPO).acao, 'criar');
});

test('conversa da equipe no grupo e ignorada em silencio', () => {
  assert.deepEqual(decidirAcao(evento({ conversation: 'Pessoal, bom dia! Alguem viu o lead?' }), GRUPO), { acao: 'ignorar', motivo: 'nao_e_lead' });
  assert.equal(decidirAcao(evento({ imageMessage: {} }), GRUPO).acao, 'ignorar');
});

test('outro grupo, conversa privada ou instancia diferente sao ignorados mesmo com cartao', () => {
  const outro = evento({ conversation: CARTAO });
  outro.data.key.remoteJid = '999@g.us';
  assert.equal(decidirAcao(outro, GRUPO).acao, 'ignorar');
  const privado = evento({ conversation: CARTAO });
  privado.data.key.remoteJid = '5511999990001@s.whatsapp.net';
  assert.equal(decidirAcao(privado, GRUPO).acao, 'ignorar');
  const inst = evento({ conversation: CARTAO });
  inst.instance = 'outra';
  assert.equal(decidirAcao(inst, GRUPO).acao, 'ignorar');
});

test('evento que nao e mensagem e payload quebrado sao ignorados', () => {
  assert.equal(decidirAcao({ event: 'connection.update', instance: 'escritorio', data: {} }, GRUPO).acao, 'ignorar');
  assert.equal(decidirAcao(null, GRUPO).acao, 'ignorar');
  assert.equal(decidirAcao({ event: 'messages.upsert', instance: 'escritorio' }, GRUPO).acao, 'ignorar');
});

test('cartao ilegivel gera alerta com o motivo e o id da mensagem', () => {
  const semTel = CARTAO.replace(/📞 Telefone:.*\n/, '').replace(/👉.*/, '');
  assert.deepEqual(decidirAcao(evento({ conversation: semTel }), GRUPO), { acao: 'alertar', motivo: 'sem_telefone', messageId: 'MSG1' });
  const curto = CARTAO.replace('+556199391304', '12').replace('wa.me/556199391304', '');
  assert.deepEqual(decidirAcao(evento({ conversation: curto }), GRUPO), { acao: 'alertar', motivo: 'telefone_invalido', messageId: 'MSG1' });
});

test('aceita messages.upsert escrito como MESSAGES_UPSERT', () => {
  const e = evento({ conversation: CARTAO });
  e.event = 'MESSAGES_UPSERT';
  assert.equal(decidirAcao(e, GRUPO).acao, 'criar');
});
