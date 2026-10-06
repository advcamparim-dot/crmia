import test from 'node:test';
import assert from 'node:assert/strict';
import { codigoCalcularLacunas, codigoGuardrail } from './gerar-nucleo.mjs';

const Q = 'Você recebeu alguma notificação do banco ou já tem processo judicial em andamento?';
const DateTimeStub = { plus: () => ({ setZone: () => ({ toFormat: () => '06/10' }) }) };

const roda = (codigo, argumentos, valores) => new Function(...argumentos, codigo)(...valores);

function lacunas(item) {
  return roda(codigoCalcularLacunas(), ['$input'], [{ first: () => ({ json: item }) }])[0].json;
}
function guardrail(saida, entrada, ultimasIa, fatos = { nomeCompleto: 'Santo Célio Camparim Júnior' }) {
  const $ = (nome) => ({ first: () => ({ json: nome === 'Calcular Lacunas' ? { ultimasIa: JSON.stringify(ultimasIa) } : { chatInput: entrada, fatosJson: JSON.stringify(fatos) } }) });
  return roda(codigoGuardrail(), ['$input', '$', '$now'], [{ first: () => ({ json: { output: saida } }) }, $, DateTimeStub])[0].json;
}

test('os dois codigos sao JS valido, sem import/export', () => {
  for (const c of [codigoCalcularLacunas(), codigoGuardrail()]) {
    assert.ok(!/^\s*(import|export)\s/m.test(c));
    assert.doesNotThrow(() => new Function('$input', '$', '$now', c));
  }
});

test('Calcular Lacunas: inclui o nome nos fatos conhecidos e preserva a logica original', () => {
  const r = lacunas({ fatosJson: '{"tipoDivida":"cartão","nomeCompleto":"Santo Célio","valorAproximado":"500 mil"}', ultimasIa: '[]' });
  assert.match(r.lacunas, /FATOS JÁ CONHECIDOS: tipo=cartão; valor=500 mil; nome=Santo Célio/);
  assert.match(r.lacunas, /LACUNA PRIORITÁRIA EM ABERTO: situação judicial vs\. cobrança informal/);
  assert.match(r.lacunas, /NUNCA PERGUNTE O QUE JÁ ESTÁ EM "FATOS JÁ CONHECIDOS"/);
  assert.match(r.estadoPergunta, /Sem pergunta pendente/);
  assert.ok(!r.lacunas.includes('Há pergunta pendente'));
});

test('Calcular Lacunas: com pergunta pendente, avisa no bloco e preenche o estado da pergunta', () => {
  const r = lacunas({ fatosJson: '{}', ultimasIa: JSON.stringify([Q, Q]) });
  assert.match(r.estadoPergunta, /PERGUNTA PENDENTE/);
  assert.match(r.estadoPergunta, /2 vezes seguidas/);
  assert.match(r.lacunas, /Há pergunta pendente: veja ESTADO DA PERGUNTA/);
  assert.equal(r.ultimasIa, JSON.stringify([Q, Q]));
});

test('Calcular Lacunas: JSON invalido ou ausente nao quebra', () => {
  assert.doesNotThrow(() => lacunas({ fatosJson: 'lixo', ultimasIa: 'lixo' }));
  assert.doesNotThrow(() => lacunas({}));
  assert.match(lacunas({ ultimasIa: null }).estadoPergunta, /Sem pergunta pendente/);
});

test('Guardrail: pergunta repetida apos um nao-resposta vira resposta sem pergunta (caso real)', () => {
  const r = guardrail('Bom dia!\n\n' + Q, 'Bom dia', [Q, Q]);
  assert.equal(r.guardrailTriggered, true);
  assert.equal(r.guardrailReason, 'pergunta_repetida');
  assert.equal(r.output, 'Bom dia, Santo! Estou por aqui. Pode me contar com calma, no seu tempo.');
  assert.equal(r.guardrailOriginalOutput, 'Bom dia!\n\n' + Q);
  const reformulada = guardrail('Essa dívida do cartão já virou processo judicial ou ainda é só cobrança do banco?', 'Oi', [Q]);
  assert.equal(reformulada.guardrailReason, 'pergunta_repetida');
});

test('Guardrail: nao interfere quando a pessoa respondeu, quando o assunto mudou ou quando nao ha pergunta', () => {
  assert.equal(guardrail('Qual banco emitiu esse cartão?', 'Recebi uma notificação do banco', [Q]).guardrailTriggered, undefined);
  assert.equal(guardrail('Qual banco emitiu esse cartão?', 'Bom dia', [Q]).guardrailTriggered, undefined);
  assert.equal(guardrail('Bom dia, Santo!', 'Bom dia', [Q]).guardrailTriggered, undefined);
  assert.equal(guardrail(Q, 'Oi', []).guardrailTriggered, undefined);
});

test('Guardrail: as travas originais continuam valendo e tem prioridade', () => {
  assert.equal(guardrail('Existe cláusula abusiva no seu contrato?', 'Bom dia', [Q]).guardrailReason, 'opiniao_juridica');
  assert.equal(guardrail('Calling Salvar_Estado with input: x', 'Bom dia', [Q]).guardrailReason, 'vazamento_tecnico');
  assert.equal(guardrail('Posso marcar para 31/12?', 'Bom dia', [Q]).guardrailReason, 'data_invalida_no_texto');
});

test('Guardrail: contexto ausente ou quebrado nao derruba a resposta', () => {
  const $ = () => ({ first: () => { throw new Error('sem no'); } });
  const r = roda(codigoGuardrail(), ['$input', '$', '$now'], [{ first: () => ({ json: { output: 'Oi, tudo bem?' } }) }, $, DateTimeStub])[0].json;
  assert.equal(r.output, 'Oi, tudo bem?');
});
