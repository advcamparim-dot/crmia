import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { interpretarResposta, montarPedidoIA, validarFormulario } from '../2026-10-12-central-linguagem-livre/interpretar.mjs';
import { montarContrato, corpoResumo, resolverData } from './contrato.mjs';

const HOJE = '2026-10-22';
const ctx = { montarContrato, corpoResumo, resolverData, hoje: HOJE };
const modelo = (extra = {}) => JSON.stringify({
  intencao: 'agir', acao: 'proposta_enviada', alvo: { nome: 'João da Silva', telefone: null, numero_regra: null }, periodo: null, regra: null, duvida: null, proposta: null, ...extra,
});

test('"enviei a proposta para o João" vira pedido SQL sem data (o banco usa hoje)', () => {
  const r = interpretarResposta(modelo(), ctx);
  assert.equal(r.tipo, 'sql');
  assert.equal(r.acao, 'livre_proposta_enviada');
  assert.equal(r.fn, 'livre');
  const p = JSON.parse(r.arg);
  assert.equal(p.acao, 'proposta_enviada');
  assert.equal(p.nome, 'João da Silva');
  assert.equal(p.data, undefined);
});

test('com data dita ("ontem", "20/10", "15 de outubro") o código resolve para ISO no passado', () => {
  assert.equal(JSON.parse(interpretarResposta(modelo({ proposta: { data: 'ontem' } }), ctx).arg).data, '2026-10-21');
  assert.equal(JSON.parse(interpretarResposta(modelo({ proposta: { data: '20/10' } }), ctx).arg).data, '2026-10-20');
  assert.equal(JSON.parse(interpretarResposta(modelo({ proposta: { data: '15 de outubro' } }), ctx).arg).data, '2026-10-15');
});

test('data ilegível é recusada com mensagem e nada executa', () => {
  const r = interpretarResposta(modelo({ proposta: { data: 'semana passada talvez' } }), ctx);
  assert.equal(r.tipo, 'texto');
  assert.equal(r.acao, 'livre_proposta_recusada');
  assert.match(r.resposta, /data/i);
});

test('sem alvo ou com campo extra não executa; sem a biblioteca no contexto recusa (fail-safe)', () => {
  assert.notEqual(interpretarResposta(modelo({ alvo: { nome: null, telefone: null, numero_regra: null } }), ctx).tipo, 'sql');
  assert.equal(interpretarResposta(JSON.stringify({ ...JSON.parse(modelo()), executar: 'x' }), ctx).acao, 'livre_nao_entendi');
  assert.equal(interpretarResposta(modelo()).acao, 'livre_nao_entendi');
  assert.equal(interpretarResposta(modelo(), { hoje: HOJE }).acao, 'livre_nao_entendi');
});

test('o telefone dito vai junto e valor aninhado ou texto enorme na data não passam', () => {
  const r = interpretarResposta(modelo({ alvo: { nome: null, telefone: '16 99201-6022', numero_regra: null } }), ctx);
  assert.equal(JSON.parse(r.arg).telefone, '+5516992016022');
  assert.notEqual(interpretarResposta(modelo({ proposta: { data: { x: 1 } } }), ctx).tipo, 'sql');
  assert.notEqual(interpretarResposta(modelo({ proposta: { data: '9'.repeat(200) } }), ctx).tipo, 'sql');
});

test('o formulário aceita proposta_enviada como ação de agir e o prompt a descreve sem confundir com contrato', () => {
  const v = validarFormulario(JSON.parse(modelo()));
  assert.equal(v.ok, true);
  assert.equal(v.pedido.acao, 'proposta_enviada');
  const p = montarPedidoIA('enviei a proposta para o Fulano');
  assert.match(p.system, /proposta_enviada/);
  assert.match(p.system, /registrar_contrato/);
});

const corpoNode = readFileSync(fileURLToPath(new URL('../2026-10-12-central-linguagem-livre/interpretar.node.js', import.meta.url)), 'utf8');
test('o Code node gerado interpreta a proposta ponta a ponta', () => {
  const rodar = (texto) => new Function('$input', corpoNode)({ first: () => ({ json: { text: texto } }) })[0].json;
  const r = rodar(modelo({ proposta: { data: '20/10' } }));
  assert.equal(r.acao, 'livre_proposta_enviada');
  assert.match(JSON.parse(r.arg).data, /^\d{4}-\d{2}-\d{2}$/);
});
