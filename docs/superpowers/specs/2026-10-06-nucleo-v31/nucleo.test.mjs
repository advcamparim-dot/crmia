import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ultimaPergunta, topicoPergunta, naoRespondeu, contarSeguidas, estadoPergunta,
  deveBloquearRepeticao, fallbackSemPergunta, primeiroNome,
} from './nucleo.mjs';

const Q_JUDICIAL = 'Você recebeu alguma notificação do banco ou já tem processo judicial em andamento?';
const Q_REFORMULADA = 'Santo, pra eu entender melhor sua situação: você recebeu alguma notificação do banco ou já tem processo judicial?';
const Q_REFORMULADA_2 = 'Essa dívida do cartão já virou processo judicial ou ainda é só cobrança do banco?';
const Q_BANCO = 'Qual banco emitiu esse cartão de crédito?';

test('ultimaPergunta: so existe quando a mensagem termina em pergunta', () => {
  assert.equal(ultimaPergunta('Oi Santo!\n\n' + Q_JUDICIAL), Q_JUDICIAL);
  assert.equal(ultimaPergunta('Beleza. ' + Q_BANCO + ' 😊'), Q_BANCO);
  assert.equal(ultimaPergunta('Perfeito, obrigado.'), null);
  assert.equal(ultimaPergunta('Você tem dúvida? Pode me contar.'), null);
  assert.equal(ultimaPergunta(''), null);
  assert.equal(ultimaPergunta(null), null);
});

test('topicoPergunta: agrupa perguntas por assunto, o judicial vem antes do banco', () => {
  assert.equal(topicoPergunta(Q_JUDICIAL), 'judicial');
  assert.equal(topicoPergunta(Q_REFORMULADA), 'judicial');
  assert.equal(topicoPergunta(Q_REFORMULADA_2), 'judicial');
  assert.equal(topicoPergunta(Q_BANCO), 'banco');
  assert.equal(topicoPergunta('Qual o valor aproximado dessa dívida?'), 'valor');
  assert.equal(topicoPergunta('Essa dívida está no CNPJ ou no CPF?'), 'documento');
  assert.equal(topicoPergunta('Já tentou renegociar com o banco?'), 'renegociacao');
  assert.equal(topicoPergunta('Como você prefere conversar?'), 'outro');
});

test('naoRespondeu: cumprimento, ok e mensagens vazias nao respondem a uma pergunta', () => {
  for (const m of ['Oi', 'oi!', 'Bom dia', 'boa tarde.', 'Ok', 'blz', 'Obrigado', '?', 'hum', 'Tudo bem?', 'Olá']) assert.equal(naoRespondeu(m), true, m);
  for (const m of ['Recebi uma notificação do banco semana passada', 'não', 'Sim, já tenho processo', 'Santander', '500 mil', 'cnpj']) assert.equal(naoRespondeu(m), false, m);
  assert.equal(naoRespondeu(''), true);
  assert.equal(naoRespondeu(null), true);
});

test('contarSeguidas: conta as ultimas mensagens da IA que repetem o mesmo assunto', () => {
  const ultimas = [Q_REFORMULADA, 'Oi Santo!\n\n' + Q_JUDICIAL, Q_JUDICIAL, 'Oi! Como posso ajudar?'];
  assert.equal(contarSeguidas(ultimas, 'judicial'), 3);
  assert.equal(contarSeguidas([Q_BANCO, Q_JUDICIAL], 'judicial'), 0);
  assert.equal(contarSeguidas([], 'judicial'), 0);
});

test('estadoPergunta: descreve a pergunta pendente, quantas vezes foi feita e a regra', () => {
  const sem = estadoPergunta(['Oi! Aqui é a Mayara.']);
  assert.match(sem, /Sem pergunta pendente/);
  const com = estadoPergunta([Q_REFORMULADA, Q_JUDICIAL]);
  assert.match(com, /PERGUNTA PENDENTE/);
  assert.ok(com.includes(Q_REFORMULADA));
  assert.match(com, /2 vezes seguidas/);
  assert.match(com, /não faça nenhuma pergunta/i);
  assert.match(estadoPergunta([Q_JUDICIAL]), /1 vez\b/);
  assert.match(estadoPergunta([]), /Sem pergunta pendente/);
});

test('deveBloquearRepeticao: reformular a mesma pergunta apos um nao-resposta e repeticao', () => {
  // caso real: lead diz "Bom dia" e a Mayara reformula a pergunta judicial
  assert.equal(deveBloquearRepeticao({ saida: Q_REFORMULADA_2, entrada: 'Bom dia', ultimasIa: [Q_JUDICIAL] }), true);
  assert.equal(deveBloquearRepeticao({ saida: 'Bom dia!\n\n' + Q_JUDICIAL, entrada: 'Bom dia', ultimasIa: [Q_JUDICIAL] }), true);
  // o lead respondeu algo: perguntar de novo sobre o mesmo assunto so e bloqueado na terceira vez seguida
  assert.equal(deveBloquearRepeticao({ saida: 'A notificação é do banco ou da Justiça?', entrada: 'Recebi uma notificação', ultimasIa: [Q_JUDICIAL] }), false);
  assert.equal(deveBloquearRepeticao({ saida: 'A notificação é do banco ou da Justiça?', entrada: 'Recebi uma notificação', ultimasIa: [Q_REFORMULADA, Q_JUDICIAL] }), true);
  // pergunta de outro assunto passa
  assert.equal(deveBloquearRepeticao({ saida: Q_BANCO, entrada: 'Bom dia', ultimasIa: [Q_JUDICIAL] }), false);
  // resposta sem pergunta passa sempre
  assert.equal(deveBloquearRepeticao({ saida: 'Bom dia, Santo!', entrada: 'Bom dia', ultimasIa: [Q_JUDICIAL] }), false);
  // sem historico passa
  assert.equal(deveBloquearRepeticao({ saida: Q_JUDICIAL, entrada: 'Oi', ultimasIa: [] }), false);
  // entrada hostil nao lanca excecao
  assert.doesNotThrow(() => deveBloquearRepeticao({ saida: null, entrada: undefined, ultimasIa: null }));
});

test('deveBloquearRepeticao: lembra da pergunta ignorada mesmo depois de uma pergunta social no meio', () => {
  const social = 'Tudo bem sim, obrigada!\n\nE você, como está?';
  const retomada = 'Que bom! Sobre a dívida do cartão: você recebeu alguma notificação do banco ou já tem processo judicial em andamento?';
  // mais recente primeiro: social, depois a pergunta judicial ignorada
  assert.equal(deveBloquearRepeticao({ saida: retomada, entrada: 'ok', ultimasIa: [social, Q_JUDICIAL] }), true);
  assert.equal(deveBloquearRepeticao({ saida: retomada, entrada: 'ok', ultimasIa: [social, 'Oi!', 'Certo, Santo!', 'Prazer!', Q_JUDICIAL] }), true);
  // a pergunta ignorada ficou longe demais (fora das ultimas 6): pode voltar a perguntar uma vez
  assert.equal(deveBloquearRepeticao({ saida: retomada, entrada: 'ok', ultimasIa: ['a', 'b', 'c', 'd', 'e', 'f', Q_JUDICIAL] }), false);
  // se a pessoa respondeu algo de verdade, nao bloqueia
  assert.equal(deveBloquearRepeticao({ saida: retomada, entrada: 'Santander', ultimasIa: [social, Q_JUDICIAL] }), false);
  // pergunta de agendamento (assunto outro) nunca e bloqueada, mesmo apos um "ok"
  assert.equal(deveBloquearRepeticao({ saida: 'Qual horário fica melhor para você?', entrada: 'ok', ultimasIa: ['Tenho amanhã às 9h ou às 15h, qual fica melhor?', Q_JUDICIAL] }), false);
});

test('fallbackSemPergunta: devolve o cumprimento com o primeiro nome e nunca faz pergunta', () => {
  const f1 = fallbackSemPergunta('Bom dia', { nomeCompleto: 'Santo Célio Camparim Júnior' });
  assert.equal(f1, 'Bom dia, Santo! Estou por aqui. Pode me contar com calma, no seu tempo.');
  assert.equal(fallbackSemPergunta('boa noite', {}), 'Boa noite! Estou por aqui. Pode me contar com calma, no seu tempo.');
  assert.equal(fallbackSemPergunta('oi', { nomeCompleto: 'Ana Lima' }), 'Oi, Ana! Estou por aqui. Pode me contar com calma, no seu tempo.');
  assert.equal(fallbackSemPergunta('ok', null), 'Certo! Estou por aqui. Pode me contar com calma, no seu tempo.');
  for (const e of ['Bom dia', 'ok', '?', '', null]) assert.ok(!fallbackSemPergunta(e, {}).includes('?'), String(e));
});

test('primeiroNome: so o primeiro nome, sem inventar', () => {
  assert.equal(primeiroNome({ nomeCompleto: 'santo Célio Camparim' }), 'Santo');
  assert.equal(primeiroNome({ nome: 'Ana' }), 'Ana');
  assert.equal(primeiroNome({}), '');
  assert.equal(primeiroNome(null), '');
});

test('o codigo-fonte nao tem caracteres invisiveis ou combinantes literais', () => {
  const fonte = readFileSync(new URL('./nucleo.mjs', import.meta.url), 'utf8');
  const proibido = (c) => (c >= 0x300 && c <= 0x36f) || (c >= 0x200b && c <= 0x200f) || c === 0x2028 || c === 0x2029 || c === 0xfeff;
  const achados = [];
  for (let i = 0; i < fonte.length; i++) if (proibido(fonte.charCodeAt(i))) achados.push(i);
  assert.deepEqual(achados, []);
});
