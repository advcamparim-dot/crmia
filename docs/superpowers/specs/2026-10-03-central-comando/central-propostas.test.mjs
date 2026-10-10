// central-propostas.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { classificarMensagem } from './central-comando.mjs';

const livre = { exclusivo: true, ctx: { pendente: false, acao_pendente: false, propostas_abertas: 0, proposta_unica: null } };

test('sim N, nao N e editar N: texto viram operacoes de proposta', () => {
  assert.deepEqual(classificarMensagem('sim 12', livre), { tipo: 'proposta', acao: 'proposta_aprovar', op: 'aprovar', id: 12, texto: '' });
  assert.deepEqual(classificarMensagem('Sim #12', livre), { tipo: 'proposta', acao: 'proposta_aprovar', op: 'aprovar', id: 12, texto: '' });
  assert.deepEqual(classificarMensagem('não 7', livre), { tipo: 'proposta', acao: 'proposta_descartar', op: 'descartar', id: 7, texto: '' });
  assert.deepEqual(classificarMensagem('nao 7', livre), { tipo: 'proposta', acao: 'proposta_descartar', op: 'descartar', id: 7, texto: '' });
  assert.deepEqual(classificarMensagem('editar 12: Boa tarde, Ana. Aqui é a Mayara. Qual banco?', livre),
    { tipo: 'proposta', acao: 'proposta_editar', op: 'editar', id: 12, texto: 'Boa tarde, Ana. Aqui é a Mayara. Qual banco?' });
  assert.deepEqual(classificarMensagem('editar 12 - Texto novo', livre),
    { tipo: 'proposta', acao: 'proposta_editar', op: 'editar', id: 12, texto: 'Texto novo' });
  assert.deepEqual(classificarMensagem('propostas', livre), { tipo: 'proposta', acao: 'proposta_listar', op: 'listar', id: null, texto: '' });
});

test('funciona tambem fora do modo exclusivo e sem ctx', () => {
  assert.equal(classificarMensagem('sim 12').tipo, 'proposta');
  assert.equal(classificarMensagem('sim 12', { exclusivo: false }).op, 'aprovar');
});

test('sim sem numero com uma unica proposta e nada pendente aprova essa proposta', () => {
  const ctx = { pendente: false, acao_pendente: false, propostas_abertas: 1, proposta_unica: 5 };
  assert.deepEqual(classificarMensagem('sim', { exclusivo: true, ctx }), { tipo: 'proposta', acao: 'proposta_aprovar', op: 'aprovar', id: 5, texto: '' });
  assert.deepEqual(classificarMensagem('não', { exclusivo: true, ctx }), { tipo: 'proposta', acao: 'proposta_descartar', op: 'descartar', id: 5, texto: '' });
});

test('sim sem numero com duas ou mais propostas pede o numero e nao aprova nada', () => {
  const ctx = { pendente: false, acao_pendente: false, propostas_abertas: 3, proposta_unica: null };
  const r = classificarMensagem('sim', { exclusivo: true, ctx });
  assert.equal(r.tipo, 'texto');
  assert.equal(r.acao, 'proposta_ambigua');
  assert.match(r.resposta, /3 propostas abertas/);
  assert.match(r.resposta, /sim <número>/);
  assert.equal(classificarMensagem('não', { exclusivo: true, ctx }).acao, 'proposta_ambigua');
});

test('regra ou acao pendente tem prioridade: o sim continua valendo para elas', () => {
  const base = { propostas_abertas: 1, proposta_unica: 5 };
  assert.equal(classificarMensagem('sim', { exclusivo: true, ctx: { ...base, pendente: true, acao_pendente: false } }).tipo, 'sql');
  assert.equal(classificarMensagem('sim', { exclusivo: true, ctx: { ...base, pendente: false, acao_pendente: true } }).tipo, 'sql');
  assert.equal(classificarMensagem('não', { exclusivo: true, ctx: { ...base, pendente: true, acao_pendente: false } }).tipo, 'sql');
});

test('sim sem numero e sem propostas continua como confirmacao de regra', () => {
  assert.equal(classificarMensagem('sim', livre).tipo, 'sql');
  assert.equal(classificarMensagem('sim').tipo, 'sql');
});

test('o ensino livre e os comandos com barra nao mudam', () => {
  assert.equal(classificarMensagem('Quando perguntarem de honorários, não cite valores.', livre).tipo, 'livre');
  assert.equal(classificarMensagem('/status', livre).tipo, 'status');
  assert.equal(classificarMensagem('sim claro, pode ser', livre).tipo, 'livre');
  assert.equal(classificarMensagem('editar a regra de honorários', livre).tipo, 'livre');
});
