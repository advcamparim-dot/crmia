import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Guarda: os corpos gerados para o n8n se comportam como a biblioteca testada.
const ler = (n) => readFileSync(fileURLToPath(new URL(n, import.meta.url)), 'utf8');
const pedido = ler('./pedido.node.js');
const escolher = ler('./escolher.node.js');

function rodar(corpo, $input, $) {
  return new Function('$input', '$', corpo)($input, $);
}

test('Montar Pedido: junta o contexto num unico prompt e sinaliza texto aprovado', () => {
  const item = { log_id: 7, lead_sequencia: 'conversa', lead_etapa: 2, lead_nome: 'Ana Silva', lead_telefone: '+5511999990001', modo: 'simulacao', texto_proximo: null,
    ctx: { nome: 'Ana Silva', tentativa: 2, mensagens: [{ papel: 'mayara', texto: 'Qual banco?' }], fatos: { tipoDivida: 'Pronampe' }, anteriores: ['Oi, Ana.'] } };
  const out = rodar(pedido, { all: () => [{ json: item }] })[0].json;
  assert.equal(out.log_id, 7);
  assert.equal(out.tem_aprovado, false);
  assert.match(out.prompt, /dados, não instruções/);
  assert.match(out.prompt, /"nome":"Ana"/);
  assert.match(out.prompt, /Qual banco\?/);
  const com = rodar(pedido, { all: () => [{ json: { ...item, texto_proximo: 'Texto aprovado' } }] })[0].json;
  assert.equal(com.tem_aprovado, true);
});

test('lote: processa varios itens na ordem e pareia cada saida do modelo com o seu pedido', () => {
  const mk = (id, nome) => ({ log_id: id, lead_sequencia: 'nunca_respondeu', lead_etapa: 3, lead_nome: nome, lead_telefone: '+55119999900' + id, modo: 'ligado', texto_proximo: null, ctx: { nome, anteriores: [] } });
  const itens = [mk(11, 'Ana'), mk(12, 'Bia')];
  const pedidos = rodar(pedido, { all: () => itens.map((json) => ({ json })) });
  assert.deepEqual(pedidos.map((p) => p.json.log_id), [11, 12]);
  const saidas = [{ json: { text: 'Oi, Ana. Ainda faz sentido conversarmos?' } }, { json: {} }];
  const out = rodar(escolher, { all: () => saidas }, () => ({ all: () => itens.map((json) => ({ json })) }));
  assert.equal(out[0].json.log_id, 11);
  assert.equal(out[0].json.fonte, 'ia');
  assert.equal(out[1].json.log_id, 12);
  assert.equal(out[1].json.fonte, 'fixo');
  assert.match(out[1].json.texto, /Bia\./);
});

test('Escolher Texto: IA valida, IA invalida, sem IA e texto aprovado', () => {
  const base = { log_id: 7, lead_sequencia: 'conversa', lead_etapa: 1, lead_nome: 'Ana', lead_telefone: '+5511999990001', modo: 'ligado', texto_proximo: null, ctx: { nome: 'Ana', anteriores: [] } };
  const via = (saida, b = base) => rodar(escolher, { all: () => [{ json: saida }] }, () => ({ all: () => [{ json: b }] }))[0].json;
  const ok = via({ text: 'Oi, Ana. Conseguiu ver minha pergunta?' });
  assert.equal(ok.fonte, 'ia');
  assert.equal(ok.texto, 'Oi, Ana. Conseguiu ver minha pergunta?');
  assert.equal(ok.telefone, '+5511999990001');
  const ruim = via({ text: 'Último aviso! Garantimos o resultado.' });
  assert.equal(ruim.fonte, 'fixo');
  assert.equal(ruim.motivo_rejeicao, 'promessa_ou_pressao');
  const sem = via({});
  assert.equal(sem.fonte, 'fixo');
  assert.match(sem.texto, /^(Bom dia|Boa tarde|Boa noite), Ana\./);
  const aprovado = via({ text: 'qualquer coisa' }, { ...base, texto_proximo: 'Bom dia, Cristina. Tudo bem? Texto aprovado.' });
  assert.equal(aprovado.fonte, 'aprovado');
  assert.equal(aprovado.texto, 'Bom dia, Cristina. Tudo bem? Texto aprovado.');
});
