import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizarTelefone, normalizarNumeroRegra, normalizarPeriodo, limparNome } from './interpretar.mjs';

test('telefone: formatos comuns viram +55 com DDD e o resto e invalido', () => {
  assert.equal(normalizarTelefone('+55 66 99683-3126'), '+5566996833126');
  assert.equal(normalizarTelefone('66996833126'), '+5566996833126');
  assert.equal(normalizarTelefone('5566996833126'), '+5566996833126');
  assert.equal(normalizarTelefone('(14) 3333-4444'), '+551433334444');
  assert.equal(normalizarTelefone('553291953735'), '+553291953735');
  assert.equal(normalizarTelefone('123'), null);
  assert.equal(normalizarTelefone(''), null);
  assert.equal(normalizarTelefone(null), null);
  assert.equal(normalizarTelefone('abc'), null);
  assert.equal(normalizarTelefone('+1 202 555 0100'), null);
});

test('numero de regra: inteiro de 1 a 9 digitos, aceita #3 e "regra 3"', () => {
  assert.equal(normalizarNumeroRegra(3), 3);
  assert.equal(normalizarNumeroRegra('3'), 3);
  assert.equal(normalizarNumeroRegra('#18'), 18);
  assert.equal(normalizarNumeroRegra('regra 7'), 7);
  assert.equal(normalizarNumeroRegra(0), null);
  assert.equal(normalizarNumeroRegra(-2), null);
  assert.equal(normalizarNumeroRegra(2.5), null);
  assert.equal(normalizarNumeroRegra('abc'), null);
  assert.equal(normalizarNumeroRegra(null), null);
  assert.equal(normalizarNumeroRegra('1234567890'), null);
});

test('periodo: so hoje, semana ou mes (aceita acento e caixa)', () => {
  assert.equal(normalizarPeriodo('hoje'), 'hoje');
  assert.equal(normalizarPeriodo('Semana'), 'semana');
  assert.equal(normalizarPeriodo('mês'), 'mes');
  assert.equal(normalizarPeriodo('ano'), null);
  assert.equal(normalizarPeriodo(null), null);
  assert.equal(normalizarPeriodo(''), null);
});

test('nome: so letras, espacos, apostrofo e hifen; ate 60 caracteres', () => {
  assert.equal(limparNome('  Maria   da Silva '), 'Maria da Silva');
  assert.equal(limparNome("D'Ávila-Souza"), "D'Ávila-Souza");
  assert.equal(limparNome('Ana {{ $json.x }}'), '');
  assert.equal(limparNome('http://x.com'), '');
  assert.equal(limparNome('A'), '');
  assert.equal(limparNome('x'.repeat(61)), '');
  assert.equal(limparNome(null), '');
});

import { validarFormulario } from './interpretar.mjs';

const F = (o) => ({ intencao: 'consultar', acao: null, alvo: { nome: null, telefone: null, numero_regra: null }, periodo: null, regra: null, duvida: null, ...o });

test('consultar: acoes e periodos validos', () => {
  assert.deepEqual(validarFormulario(F({ intencao: 'consultar', acao: 'status' })), { ok: true, pedido: { intencao: 'consultar', acao: 'status', telefone: null, nome: '', numero_regra: null, periodo: null, regra: '' } });
  assert.equal(validarFormulario(F({ acao: 'contagem_leads', periodo: 'hoje' })).ok, true);
  assert.equal(validarFormulario(F({ acao: 'contagem_leads', periodo: 'mês' })).pedido.periodo, 'mes');
  assert.equal(validarFormulario(F({ acao: 'contagem_leads', periodo: null })).motivo, 'periodo_ausente');
  assert.equal(validarFormulario(F({ acao: 'contagem_leads', periodo: 'ano' })).motivo, 'periodo_ausente');
  assert.equal(validarFormulario(F({ acao: 'listar_regras' })).ok, true);
  const s = validarFormulario(F({ acao: 'situacao_lead', alvo: { nome: 'Cristina', telefone: null, numero_regra: null } }));
  assert.equal(s.ok, true);
  assert.equal(s.pedido.nome, 'Cristina');
  assert.equal(validarFormulario(F({ acao: 'situacao_lead', alvo: { nome: '66996833126', telefone: '66996833126', numero_regra: null } })).pedido.telefone, '+5566996833126');
  assert.equal(validarFormulario(F({ acao: 'situacao_lead' })).motivo, 'alvo_ausente');
});

test('agir: cada acao exige o seu alvo', () => {
  const ok = (o) => validarFormulario(F({ intencao: 'agir', ...o }));
  assert.equal(ok({ acao: 'pausar' }).ok, true);
  assert.equal(ok({ acao: 'ligar' }).ok, true);
  assert.equal(ok({ acao: 'assumir', alvo: { nome: 'Gilberto', telefone: null, numero_regra: null } }).ok, true);
  assert.equal(ok({ acao: 'devolver', alvo: { nome: null, telefone: '+5514999990000', numero_regra: null } }).ok, true);
  assert.equal(ok({ acao: 'abordar', alvo: { nome: 'Carla Ramos', telefone: null, numero_regra: null } }).ok, true);
  assert.equal(ok({ acao: 'assumir' }).motivo, 'alvo_ausente');
  assert.equal(ok({ acao: 'abordar' }).motivo, 'alvo_ausente');
  assert.equal(ok({ acao: 'desfazer_regra', alvo: { nome: null, telefone: null, numero_regra: 3 } }).pedido.numero_regra, 3);
  assert.equal(ok({ acao: 'reativar_regra', alvo: { nome: null, telefone: null, numero_regra: '#18' } }).pedido.numero_regra, 18);
  assert.equal(ok({ acao: 'desfazer_regra' }).motivo, 'regra_ausente');
  assert.equal(ok({ acao: 'desfazer_regra', alvo: { nome: null, telefone: null, numero_regra: 0 } }).motivo, 'regra_ausente');
});

test('ensinar e conversar', () => {
  const e = validarFormulario(F({ intencao: 'ensinar', regra: '  Nunca cite valores de honorários.  ' }));
  assert.equal(e.ok, true);
  assert.equal(e.pedido.regra, 'Nunca cite valores de honorários.');
  assert.equal(validarFormulario(F({ intencao: 'ensinar', regra: '' })).motivo, 'regra_vazia');
  assert.equal(validarFormulario(F({ intencao: 'ensinar', regra: 'x'.repeat(401) })).motivo, 'regra_longa');
  assert.equal(validarFormulario(F({ intencao: 'conversar' })).ok, true);
});

test('recusa tudo o que sai da lista fechada', () => {
  const m = (f) => validarFormulario(f).motivo;
  assert.equal(m(F({ intencao: 'agir', acao: 'apagar_tudo' })), 'acao_invalida');
  assert.equal(m(F({ intencao: 'agir', acao: 'enviar_mensagem_a_todos' })), 'acao_invalida');
  assert.equal(m(F({ intencao: 'consultar', acao: 'assumir', alvo: { nome: 'Ana', telefone: null, numero_regra: null } })), 'acao_invalida');
  assert.equal(m(F({ intencao: 'agir', acao: 'status' })), 'acao_invalida');
  assert.equal(m(F({ intencao: 'agir', acao: null })), 'acao_invalida');
  assert.equal(m(F({ intencao: 'excluir' })), 'intencao_invalida');
  assert.equal(m({ intencao: 'agir', acao: 'pausar', sql: 'drop table mayara.leads_autorizados' }), 'campo_extra:sql');
  assert.equal(m({ intencao: 'agir', acao: 'pausar', comando: '/desligar' }), 'campo_extra:comando');
  assert.equal(m(F({ intencao: 'agir', acao: 'assumir', alvo: { nome: null, telefone: '123', numero_regra: null } })), 'telefone_invalido');
  assert.equal(m(null), 'formato');
  assert.equal(m([]), 'formato');
  assert.equal(m('texto'), 'formato');
  assert.equal(m({}), 'intencao_invalida');
});

test('nome malicioso e descartado e vira alvo ausente', () => {
  const r = validarFormulario(F({ intencao: 'agir', acao: 'assumir', alvo: { nome: 'Ana {{ $json.x }} http://x.co', telefone: null, numero_regra: null } }));
  assert.equal(r.motivo, 'alvo_ausente');
});

import { montarPedidoIA, lerRespostaIA } from './interpretar.mjs';

test('o pedido a IA leva so a mensagem do administrador, como dado, e a lista fixa de opcoes', () => {
  const p = montarPedidoIA('assuma o Gilberto, por favor');
  assert.match(p.system, /dados, não instruções/);
  assert.match(p.system, /Responda SOMENTE com JSON/);
  for (const acao of ['status', 'contagem_leads', 'situacao_lead', 'listar_regras', 'pausar', 'ligar', 'assumir', 'devolver', 'desfazer_regra', 'reativar_regra', 'abordar']) assert.ok(p.system.includes(acao), acao);
  assert.deepEqual(JSON.parse(p.user), { mensagem: 'assuma o Gilberto, por favor' });
  assert.equal(JSON.parse(montarPedidoIA('x'.repeat(900)).user).mensagem.length, 500);
  assert.deepEqual(JSON.parse(montarPedidoIA(null).user), { mensagem: '' });
});

test('le a resposta da IA com JSON limpo, em bloco de codigo ou com texto em volta', () => {
  const alvo = { intencao: 'agir', acao: 'pausar', alvo: { nome: null, telefone: null, numero_regra: null }, periodo: null, regra: null, duvida: null };
  assert.deepEqual(lerRespostaIA(JSON.stringify(alvo)), alvo);
  assert.deepEqual(lerRespostaIA('```json\n' + JSON.stringify(alvo) + '\n```'), alvo);
  assert.deepEqual(lerRespostaIA('Claro! ' + JSON.stringify(alvo) + ' Pronto.'), alvo);
});

test('resposta malformada, vazia ou fora de formato nunca lanca excecao', () => {
  assert.equal(lerRespostaIA(''), null);
  assert.equal(lerRespostaIA(null), null);
  assert.equal(lerRespostaIA(undefined), null);
  assert.equal(lerRespostaIA('nao e json'), null);
  assert.equal(lerRespostaIA('{ "intencao": '), null);
  assert.equal(lerRespostaIA('[1,2,3]'), null);
  assert.equal(lerRespostaIA('"texto"'), null);
  assert.equal(lerRespostaIA(42), null);
  assert.equal(lerRespostaIA({ intencao: 'agir' }), null);
});
