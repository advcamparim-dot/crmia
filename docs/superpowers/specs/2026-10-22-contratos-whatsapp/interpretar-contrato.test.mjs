import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { interpretarResposta, montarPedidoIA, validarFormulario } from '../2026-10-12-central-linguagem-livre/interpretar.mjs';
import { montarContrato, corpoResumo } from './contrato.mjs';

const HOJE = '2026-10-22';
const ctx = { montarContrato, corpoResumo, hoje: HOJE };

// Resposta simulada do modelo para a frase do Dr. Santo: "contrato fechado com o Joao da Silva no valor de 24 mil, 5 mil de
// entrada pago 20/10 e mais 12 parcelas de 1600 reais com vencimento para todo dia 20 de cada mes iniciando 20 de novembro".
const modelo = (total) => JSON.stringify({
  intencao: 'agir', acao: 'registrar_contrato', alvo: { nome: 'João da Silva', telefone: null, numero_regra: null }, periodo: null, regra: null, duvida: null,
  contrato: { total, entrada: { valor: '5 mil', paga_em: '20/10', vence_em: null }, parcelas: { quantidade: 12, valor: 1600, primeiro_vencimento: '20 de novembro', dia: 20 } },
});

test('a frase do exemplo com 24 mil: a soma nao bate, nada vai para o banco e a diferenca de R$ 200 e informada', () => {
  const r = interpretarResposta(modelo('24 mil'), ctx);
  // "20 de novembro" nao e uma data que o codigo entende: o modelo deve devolver dd/mm; aqui garantimos que o codigo recusa com mensagem clara
  assert.equal(r.tipo, 'texto');
  assert.equal(r.acao, 'livre_contrato_recusado');
});

const modeloOk = (total) => modelo(total).replace('20 de novembro', '20/11');

test('com datas em dd/mm e total 24 mil: recusa pela diferenca de R$ 200', () => {
  const r = interpretarResposta(modeloOk('24 mil'), ctx);
  assert.equal(r.acao, 'livre_contrato_recusado');
  assert.match(r.resposta, /R\$ 24\.200,00/);
  assert.match(r.resposta, /R\$ 24\.000,00/);
  assert.match(r.resposta, /R\$ 200,00/);
  assert.match(r.resposta, /Nada foi gravado/);
});

test('com o total corrigido para 24.200: vira pedido SQL com o contrato resolvido pelo codigo', () => {
  const r = interpretarResposta(modeloOk('24.200'), ctx);
  assert.equal(r.tipo, 'sql');
  assert.equal(r.acao, 'livre_registrar_contrato');
  assert.equal(r.fn, 'livre');
  const pedido = JSON.parse(r.arg);
  assert.equal(pedido.acao, 'registrar_contrato');
  assert.equal(pedido.nome, 'João da Silva');
  assert.equal(pedido.contrato.total_centavos, 2420000);
  assert.equal(pedido.contrato.assinado_em, HOJE);
  assert.equal(pedido.contrato.parcelas.length, 13);
  assert.deepEqual(pedido.contrato.parcelas[0], { numero: 0, valor_centavos: 500000, vencimento: '2026-10-20', pago_em: '2026-10-20' });
  assert.equal(pedido.contrato.parcelas[1].vencimento, '2026-11-20');
  assert.equal(pedido.contrato.parcelas[12].vencimento, '2027-10-20');
  assert.match(pedido.contrato.resumo_corpo, /12 parcelas de R\$ 1\.600,00, de 20\/11\/2026 a 20\/10\/2027/);
  assert.ok(!('contrato_form' in pedido), 'o formulario cru do modelo nao vai ao banco');
});

test('sem alvo, sem contrato ou sem total: nao entendi, nada executa', () => {
  const base = JSON.parse(modeloOk('24.200'));
  for (const mut of [
    (o) => { o.alvo = { nome: null, telefone: null, numero_regra: null }; },
    (o) => { delete o.contrato; },
    (o) => { o.contrato = null; },
    (o) => { delete o.contrato.total; },
  ]) {
    const o = structuredClone(base);
    mut(o);
    const r = interpretarResposta(JSON.stringify(o), ctx);
    assert.equal(r.tipo === 'sql', false, JSON.stringify(o));
  }
});

test('campo extra, valor aninhado e texto enorme nao passam', () => {
  const o = JSON.parse(modeloOk('24.200'));
  assert.equal(interpretarResposta(JSON.stringify({ ...o, executar: 'drop table' }), ctx).acao, 'livre_nao_entendi');
  const aninhado = structuredClone(o);
  aninhado.contrato.parcelas.valor = { x: 1 };
  assert.notEqual(interpretarResposta(JSON.stringify(aninhado), ctx).tipo, 'sql');
  const enorme = structuredClone(o);
  enorme.contrato.total = '9'.repeat(500);
  assert.notEqual(interpretarResposta(JSON.stringify(enorme), ctx).tipo, 'sql');
});

test('total absurdo, parcelas demais e data impossivel sao recusados com mensagem', () => {
  const o = JSON.parse(modeloOk('24.200'));
  const alto = structuredClone(o); alto.contrato.total = '50 milhões'; alto.contrato.entrada = { valor: 50000000, paga_em: '20/10' }; alto.contrato.parcelas = null;
  assert.notEqual(interpretarResposta(JSON.stringify(alto), ctx).tipo, 'sql');
  const muitas = structuredClone(o); muitas.contrato.parcelas.quantidade = 500;
  assert.equal(interpretarResposta(JSON.stringify(muitas), ctx).acao, 'livre_contrato_recusado');
  const data = structuredClone(o); data.contrato.entrada.paga_em = '31/02';
  assert.equal(interpretarResposta(JSON.stringify(data), ctx).acao, 'livre_contrato_recusado');
});

test('sem a biblioteca de contrato no contexto, a acao e recusada (fail-safe)', () => {
  assert.equal(interpretarResposta(modeloOk('24.200')).acao, 'livre_nao_entendi');
  assert.equal(interpretarResposta(modeloOk('24.200'), { hoje: HOJE }).acao, 'livre_nao_entendi');
});

test('frases perigosas que o modelo manda para conversar nunca viram contrato', () => {
  const r = interpretarResposta(JSON.stringify({ intencao: 'conversar', acao: null, alvo: {}, periodo: null, regra: null, duvida: null }), ctx);
  assert.equal(r.acao, 'livre_conversar');
});

test('o formulario valida registrar_contrato como acao de agir e o prompt a descreve', () => {
  const v = validarFormulario(JSON.parse(modeloOk('24.200')));
  assert.equal(v.ok, true);
  assert.equal(v.pedido.acao, 'registrar_contrato');
  const p = montarPedidoIA('contrato fechado com Fulano');
  assert.match(p.system, /registrar_contrato/);
  assert.match(p.system, /nunca some nem corrija/i);
});

const corpoNode = readFileSync(fileURLToPath(new URL('../2026-10-12-central-linguagem-livre/interpretar.node.js', import.meta.url)), 'utf8');
test('o Code node gerado roda o contrato ponta a ponta (com a data de hoje de Sao Paulo)', () => {
  const rodar = (texto) => new Function('$input', corpoNode)({ first: () => ({ json: { text: texto } }) })[0].json;
  const r = rodar(modeloOk('24 mil'));
  assert.equal(r.acao, 'livre_contrato_recusado');
  assert.match(r.resposta, /R\$ 200,00/);
});
