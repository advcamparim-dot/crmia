import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PREFIXO, soDigitos, aplicarPrefixo, validarPedido, montarCorpoMeta,
  renderTemplate, montarEvolution, atrasoHumanoMs, interpretarRespostaMeta,
} from './canal.mjs';

test('soDigitos e telefones em formatos diferentes', () => {
  for (const t of ['+55 14 99702-2609', '5514997022609', '(55) 14 99702.2609']) {
    assert.equal(soDigitos(t), '5514997022609', t);
  }
});

test('aplicarPrefixo nunca duplica', () => {
  assert.equal(aplicarPrefixo('Oi'), PREFIXO + 'Oi');
  assert.equal(aplicarPrefixo(PREFIXO + 'Oi'), PREFIXO + 'Oi');
  assert.equal(aplicarPrefixo(aplicarPrefixo('Oi')), PREFIXO + 'Oi');
  assert.equal(aplicarPrefixo(null), PREFIXO);
});

test('validarPedido aceita texto e normaliza', () => {
  const v = validarPedido({ canalId: '123', para: '+55 14 99702-2609', tipo: 'texto', texto: ' Oi ', identificarMayara: 'true', origem: 'ponte' });
  assert.equal(v.ok, true);
  assert.deepEqual(v.pedido, { canalId: '123', para: '5514997022609', tipo: 'texto', texto: 'Oi', templateNome: '', templateVariaveis: [], identificar: true, origem: 'ponte' });
});

test('validarPedido recusa o que esta errado', () => {
  const base = { canalId: '123', para: '5514997022609', tipo: 'texto', texto: 'Oi' };
  for (const [muda, esperado] of [
    [{ canalId: '' }, 'canalId'], [{ para: '123' }, 'para'], [{ tipo: 'audio' }, 'tipo'],
    [{ texto: '   ' }, 'texto'], [{ texto: 'x'.repeat(4097) }, 'texto'],
    [{ tipo: 'template', texto: '', templateNome: '' }, 'templateNome'],
    [{ tipo: 'template', templateNome: 'a', templateVariaveis: '{nao-json' }, 'templateVariaveis'],
  ]) {
    const v = validarPedido({ ...base, ...muda });
    assert.equal(v.ok, false, JSON.stringify(muda));
    assert.match(v.erro, new RegExp(esperado), JSON.stringify(muda));
  }
});

test('montarCorpoMeta: texto, com e sem prefixo', () => {
  const p = validarPedido({ canalId: '1', para: '5514997022609', tipo: 'texto', texto: 'Oi', identificarMayara: true }).pedido;
  assert.deepEqual(montarCorpoMeta(p), { messaging_product: 'whatsapp', to: '5514997022609', type: 'text', text: { body: PREFIXO + 'Oi' } });
  const q = validarPedido({ canalId: '1', para: '5514997022609', tipo: 'texto', texto: 'Oi' }).pedido;
  assert.equal(montarCorpoMeta(q).text.body, 'Oi');
});

test('montarCorpoMeta: template com variaveis em ordem e sem variaveis', () => {
  const com = validarPedido({ canalId: '1', para: '5514997022609', tipo: 'template', templateNome: 'lembrete', templateVariaveis: JSON.stringify(['Joao', 5, 'amanha']) }).pedido;
  assert.deepEqual(montarCorpoMeta(com), {
    messaging_product: 'whatsapp', to: '5514997022609', type: 'template',
    template: { name: 'lembrete', language: { code: 'pt_BR' },
      components: [{ type: 'body', parameters: [{ type: 'text', text: 'Joao' }, { type: 'text', text: '5' }, { type: 'text', text: 'amanha' }] }] },
  });
  const sem = validarPedido({ canalId: '1', para: '5514997022609', tipo: 'template', templateNome: 'primeiro_contato_campanha', templateVariaveis: '[]' }).pedido;
  assert.equal('components' in montarCorpoMeta(sem).template, false);
});

test('renderTemplate e montarEvolution', () => {
  assert.equal(renderTemplate('Ola {{1}}, sua consulta e {{2}}.', ['Ana', 'amanha']), 'Ola Ana, sua consulta e amanha.');
  assert.equal(renderTemplate('Sem variavel {{3}}', ['a']), 'Sem variavel ');
  const p = validarPedido({ canalId: 'inst1', para: '5514997022609', tipo: 'texto', texto: 'Oi', identificarMayara: true }).pedido;
  assert.deepEqual(montarEvolution(p), { caminho: '/message/sendText/inst1', corpo: { number: '5514997022609', text: PREFIXO + 'Oi' } });
  const t = validarPedido({ canalId: 'inst1', para: '5514997022609', tipo: 'template', templateNome: 'lembrete', templateVariaveis: '["Ana"]' }).pedido;
  assert.equal(montarEvolution(t, 'Ola {{1}}').corpo.text, 'Ola Ana');
  assert.throws(() => montarEvolution(t), /template/);
});

test('atrasoHumanoMs fica entre 1000 e 4000', () => {
  assert.equal(atrasoHumanoMs(''), 1000);
  assert.ok(atrasoHumanoMs('x'.repeat(100)) > 1000);
  assert.equal(atrasoHumanoMs('x'.repeat(5000)), 4000);
});

test('interpretarRespostaMeta mantem o formato da Graph API (a Ponte depende disso)', () => {
  const ok = interpretarRespostaMeta({ messaging_product: 'whatsapp', contacts: [{ wa_id: '55' }], messages: [{ id: 'wamid.X' }] });
  assert.equal(ok.ok, true);
  assert.equal(ok.messages[0].id, 'wamid.X');
  assert.ok(!ok.error);
  for (const ruim of [{ error: 'timeout' }, { error: { message: 'Invalid token' } }, {}, { messages: [] }, null]) {
    const r = interpretarRespostaMeta(ruim);
    assert.equal(r.ok, false, JSON.stringify(ruim));
    assert.ok(r.error && r.error.message, JSON.stringify(ruim));
    assert.ok(!Array.isArray(r.messages), JSON.stringify(ruim));
  }
  assert.equal(interpretarRespostaMeta({ error: { message: 'Invalid token' } }).error.message, 'Invalid token');
});

test('o codigo-fonte nao tem caracteres invisiveis ou combinantes literais', () => {
  const fonte = readFileSync(new URL('./canal.mjs', import.meta.url), 'utf8');
  const proibido = (c) => (c >= 0x300 && c <= 0x36f) || (c >= 0x200b && c <= 0x200f) || c === 0x2028 || c === 0x2029 || c === 0xfeff;
  const achados = [];
  for (let i = 0; i < fonte.length; i++) if (proibido(fonte.charCodeAt(i))) achados.push(i);
  assert.deepEqual(achados, []);
});
