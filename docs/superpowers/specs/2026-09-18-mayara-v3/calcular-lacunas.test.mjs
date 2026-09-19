import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularLacunas } from './calcular-lacunas.mjs';

test('fatosJson vazio: lacuna prioritaria e situacao judicial, nenhum fato conhecido', () => {
  const resultado = calcularLacunas({});
  assert.match(resultado, /FATOS JÁ CONHECIDOS: \(nenhum ainda\)/);
  assert.match(resultado, /LACUNA PRIORITÁRIA EM ABERTO: situação judicial vs\. cobrança informal/);
  assert.match(resultado, /OUTRAS LACUNAS/);
});

test('situacao e urgencia conhecidas, banco ausente: banco vira prioritaria', () => {
  const resultado = calcularLacunas({ situacaoJudicial: 'nenhuma', urgencia: 'baixa' });
  assert.match(resultado, /LACUNA PRIORITÁRIA EM ABERTO: banco\(s\) envolvido\(s\) na dívida/);
});

test('situacao, urgencia e banco conhecidos: causa economica vira prioritaria', () => {
  const resultado = calcularLacunas({
    tipoDivida: 'Capital de Giro',
    bancos: ['Sicredi'],
    valorAproximado: '~300mil',
    documento: 'CNPJ',
    situacaoJudicial: 'nenhuma',
    urgencia: 'baixa',
  });
  assert.match(resultado, /FATOS JÁ CONHECIDOS: tipo=Capital de Giro; banco=Sicredi; valor=~300mil; documento=CNPJ/);
  assert.match(resultado, /LACUNA PRIORITÁRIA EM ABERTO: causa econômica do atraso\/dificuldade/);
});

test('notificacaoOrigem desconhecida aparece depois de situacao judicial e banco', () => {
  const resultado = calcularLacunas({
    situacaoJudicial: 'nenhuma',
    urgencia: 'baixa',
    bancos: ['Sicredi'],
    notificacaoOrigem: 'desconhecida',
  });
  assert.match(resultado, /LACUNA PRIORITÁRIA EM ABERTO: origem da notificação recebida \(banco ou judicial\)/);
});

test('notificacaoOrigem resolvida (banco ou judicial) nao aparece mais como lacuna', () => {
  const resultado = calcularLacunas({
    situacaoJudicial: 'nenhuma',
    urgencia: 'baixa',
    bancos: ['Sicredi'],
    notificacaoOrigem: 'banco',
    causaEconomica: 'queda de faturamento',
    outrosContratosOuDividas: false,
    tentativaRenegociacao: false,
  });
  assert.doesNotMatch(resultado, /notificação/);
});

test('outrosContratosOuDividas false (fato conhecido, nao ausente) nao conta como lacuna', () => {
  const resultado = calcularLacunas({
    situacaoJudicial: 'nenhuma',
    urgencia: 'baixa',
    bancos: ['Sicredi'],
    causaEconomica: 'queda de faturamento',
    outrosContratosOuDividas: false,
    tentativaRenegociacao: true,
  });
  assert.doesNotMatch(resultado, /outros contratos/);
});

test('todos os campos conhecidos: mensagem de nenhuma lacuna, sem linha de outras lacunas', () => {
  const resultado = calcularLacunas({
    tipoDivida: 'Capital de Giro',
    bancos: ['Sicredi'],
    valorAproximado: '~300mil',
    documento: 'CNPJ',
    situacaoJudicial: 'nenhuma',
    urgencia: 'baixa',
    notificacaoOrigem: 'banco',
    causaEconomica: 'queda de faturamento',
    outrosContratosOuDividas: false,
    tentativaRenegociacao: true,
  });
  assert.match(resultado, /LACUNA PRIORITÁRIA EM ABERTO: nenhuma — todas as lacunas conhecidas foram resolvidas/);
  assert.doesNotMatch(resultado, /OUTRAS LACUNAS/);
});

const LINHA_GUARDA =
  'ATENÇÃO: este bloco só vale quando a mensagem atual do cliente NÃO for pedido ou aceite de agendamento (inclui dia e/ou horário), NÃO indicar prioridade jurídica ou patrimonial (execução, citação, bloqueio, penhora, leilão, apreensão) e NÃO pedir advogado. Nesses casos IGNORE este bloco por completo: siga STOP QUALIFICATION ou os dados de agendamento e não faça pergunta de qualificação.';

test('linha de guarda e a ultima linha do bloco quando fatosJson e vazio', () => {
  const linhas = calcularLacunas({}).split('\n');
  assert.equal(linhas[linhas.length - 1], LINHA_GUARDA);
});

test('linha de guarda e a ultima linha do bloco quando ha lacunas e fatos conhecidos', () => {
  const linhas = calcularLacunas({
    tipoDivida: 'Capital de Giro',
    bancos: ['Sicredi'],
    situacaoJudicial: 'nenhuma',
    urgencia: 'baixa',
  }).split('\n');
  assert.equal(linhas[linhas.length - 1], LINHA_GUARDA);
});

test('linha de guarda e a ultima linha do bloco quando nao ha lacunas', () => {
  const linhas = calcularLacunas({
    tipoDivida: 'Capital de Giro',
    bancos: ['Sicredi'],
    valorAproximado: '~300mil',
    documento: 'CNPJ',
    situacaoJudicial: 'nenhuma',
    urgencia: 'baixa',
    notificacaoOrigem: 'banco',
    causaEconomica: 'queda de faturamento',
    outrosContratosOuDividas: false,
    tentativaRenegociacao: true,
  }).split('\n');
  assert.equal(linhas[linhas.length - 1], LINHA_GUARDA);
});

test('linha de guarda aparece uma unica vez em cada bloco', () => {
  assert.equal(calcularLacunas({}).split(LINHA_GUARDA).length - 1, 1);
  assert.equal(calcularLacunas(null).split(LINHA_GUARDA).length - 1, 1);
});
