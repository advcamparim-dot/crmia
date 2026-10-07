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
