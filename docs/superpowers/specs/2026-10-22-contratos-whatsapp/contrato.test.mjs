import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReais, resolverData, vencimentos, montarContrato, resumoContrato, corpoResumo, formatarReais } from './contrato.mjs';

const HOJE = '2026-10-22';

test('parseReais aceita as formas faladas e escritas e devolve centavos', () => {
  assert.equal(parseReais('24 mil'), 2400000);
  assert.equal(parseReais(24000), 2400000);
  assert.equal(parseReais('1.600,50'), 160050);
  assert.equal(parseReais('R$ 1600'), 160000);
  assert.equal(parseReais('1600 reais'), 160000);
  assert.equal(parseReais('1.600'), 160000);
  assert.equal(parseReais('1600.5'), 160050);
  assert.equal(parseReais('2,5 mil'), 250000);
  assert.equal(parseReais(1600.1), 160010);
  assert.equal(parseReais('5 mil'), 500000);
});

test('parseReais rejeita lixo, zero e negativo', () => {
  for (const v of ['', 'abc', null, undefined, 0, -5, '-100', NaN, Infinity, '1.2.3.4', '12 mil mil']) assert.equal(parseReais(v), null, String(v));
});

test('resolverData: ISO, dd/mm/aaaa, dd/mm/aa e datas impossiveis', () => {
  assert.equal(resolverData('2026-11-20', HOJE, 'futura'), '2026-11-20');
  assert.equal(resolverData('20/11/2026', HOJE, 'futura'), '2026-11-20');
  assert.equal(resolverData('20/11/26', HOJE, 'futura'), '2026-11-20');
  assert.equal(resolverData('30/02/2026', HOJE, 'futura'), null);
  assert.equal(resolverData('31/04', HOJE, 'futura'), null);
  assert.equal(resolverData('lixo', HOJE, 'futura'), null);
});

test('resolverData sem ano: passada recua, futura avanca', () => {
  assert.equal(resolverData('20/10', HOJE, 'passada'), '2026-10-20');
  assert.equal(resolverData('25/10', HOJE, 'passada'), '2025-10-25'); // 25/10 deste ano ainda nao chegou
  assert.equal(resolverData('22/10', HOJE, 'passada'), '2026-10-22'); // hoje vale
  assert.equal(resolverData('20/11', HOJE, 'futura'), '2026-11-20');
  assert.equal(resolverData('20/10', HOJE, 'futura'), '2027-10-20'); // ja passou este ano
  assert.equal(resolverData('22/10', HOJE, 'futura'), '2026-10-22'); // hoje vale
});

test('vencimentos: 12 parcelas de 20/11/2026 vao ate 20/10/2027, virando o ano', () => {
  const v = vencimentos('2026-11-20', 20, 12);
  assert.equal(v.length, 12);
  assert.equal(v[0], '2026-11-20');
  assert.equal(v[1], '2026-12-20');
  assert.equal(v[2], '2027-01-20');
  assert.equal(v[11], '2027-10-20');
});

test('vencimentos: dia 31 cai no ultimo dia do mes curto e volta ao 31 depois', () => {
  const v = vencimentos('2026-12-31', 31, 4);
  assert.deepEqual(v, ['2026-12-31', '2027-01-31', '2027-02-28', '2027-03-31']);
  assert.equal(vencimentos('2027-12-31', 31, 3)[2], '2028-02-29'); // 2028 e bissexto
  assert.deepEqual(vencimentos('2026-11-30', 30, 3), ['2026-11-30', '2026-12-30', '2027-01-30']);
});

const FORM_ERRADO = { total: '24 mil', entrada: { valor: '5 mil', paga_em: '20/10' }, parcelas: { quantidade: 12, valor: 1600, primeiro_vencimento: '20/11', dia: 20 } };
const FORM_CERTO = { ...FORM_ERRADO, total: 24200 };

test('o exemplo do Dr. Santo: soma 24.200 contra 24.000 nao grava e informa R$ 200 de diferenca', () => {
  const r = montarContrato(FORM_ERRADO, HOJE);
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'soma_nao_bate');
  assert.equal(r.diferenca_centavos, 20000);
  assert.match(r.mensagem, /R\$ 24\.200,00/);
  assert.match(r.mensagem, /R\$ 24\.000,00/);
  assert.match(r.mensagem, /R\$ 200,00/);
});

test('com a soma exata monta entrada paga e 12 parcelas com os vencimentos certos', () => {
  const r = montarContrato(FORM_CERTO, HOJE);
  assert.equal(r.ok, true);
  const c = r.contrato;
  assert.equal(c.total_centavos, 2420000);
  assert.equal(c.assinado_em, HOJE);
  assert.equal(c.parcelas.length, 13);
  assert.deepEqual(c.parcelas[0], { numero: 0, valor_centavos: 500000, vencimento: '2026-10-20', pago_em: '2026-10-20' });
  assert.deepEqual(c.parcelas[1], { numero: 1, valor_centavos: 160000, vencimento: '2026-11-20', pago_em: null });
  assert.equal(c.parcelas[12].vencimento, '2027-10-20');
  assert.equal(c.parcelas.reduce((s, p) => s + p.valor_centavos, 0), c.total_centavos);
});

test('entrada sem data de pagamento nasce a receber, vencendo hoje', () => {
  const r = montarContrato({ total: 3000, entrada: { valor: 1000 }, parcelas: { quantidade: 2, valor: 1000, primeiro_vencimento: '2026-12-01' } }, HOJE);
  assert.equal(r.ok, true);
  assert.deepEqual(r.contrato.parcelas[0], { numero: 0, valor_centavos: 100000, vencimento: HOJE, pago_em: null });
});

test('entrada com vence_em usa essa data', () => {
  const r = montarContrato({ total: 3000, entrada: { valor: 1000, vence_em: '25/10' }, parcelas: { quantidade: 2, valor: 1000, primeiro_vencimento: '2026-12-01' } }, HOJE);
  assert.equal(r.contrato.parcelas[0].vencimento, '2026-10-25');
});

test('contrato a vista: so entrada, sem parcelas', () => {
  const r = montarContrato({ total: 5000, entrada: { valor: 5000, paga_em: '2026-10-22' } }, HOJE);
  assert.equal(r.ok, true);
  assert.equal(r.contrato.parcelas.length, 1);
});

test('pagamento da entrada no futuro e recusado', () => {
  const r = montarContrato({ total: 3000, entrada: { valor: 1000, paga_em: '2026-12-01' }, parcelas: { quantidade: 2, valor: 1000, primeiro_vencimento: '2027-01-01' } }, HOJE);
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'pagamento_no_futuro');
});

test('limites: total alto, parcelas demais, quantidade invalida, sem total', () => {
  assert.equal(montarContrato({ total: 6000000, entrada: { valor: 6000000, paga_em: HOJE } }, HOJE).motivo, 'total_alto');
  assert.equal(montarContrato({ total: 1210, parcelas: { quantidade: 121, valor: 10, primeiro_vencimento: '2026-12-01' } }, HOJE).motivo, 'parcelas_invalidas');
  assert.equal(montarContrato({ total: 100, parcelas: { quantidade: 0, valor: 10, primeiro_vencimento: '2026-12-01' } }, HOJE).motivo, 'parcelas_invalidas');
  assert.equal(montarContrato({ entrada: { valor: 100 } }, HOJE).motivo, 'total_ausente');
  assert.equal(montarContrato({ total: 100 }, HOJE).motivo, 'sem_parcelas');
});

test('12 parcelas de 1.600,10 somam 19.201,20 em centavos, sem erro de ponto flutuante', () => {
  const r = montarContrato({ total: '19.201,20', parcelas: { quantidade: 12, valor: 1600.1, primeiro_vencimento: '2026-11-05' } }, HOJE);
  assert.equal(r.ok, true);
  assert.equal(r.contrato.total_centavos, 1920120);
});

test('sem primeiro vencimento usa o proximo dia informado depois de hoje', () => {
  const r = montarContrato({ total: 2000, parcelas: { quantidade: 2, valor: 1000, dia: 5 } }, HOJE);
  assert.equal(r.ok, true);
  assert.equal(r.contrato.parcelas[0].vencimento, '2026-11-05');
  assert.equal(r.contrato.parcelas[1].vencimento, '2026-12-05');
});

test('formatarReais e resumoContrato mostram total, entrada, parcelas e datas', () => {
  assert.equal(formatarReais(2420000), 'R$ 24.200,00');
  assert.equal(formatarReais(5), 'R$ 0,05');
  const r = montarContrato(FORM_CERTO, HOJE);
  const t = resumoContrato(r.contrato, 'Cliente Teste (final 6001)');
  assert.match(t, /Cliente Teste \(final 6001\)/);
  assert.match(t, /R\$ 24\.200,00/);
  assert.match(t, /Entrada: R\$ 5\.000,00 \(paga em 20\/10\/2026\)/);
  assert.match(t, /12 parcelas de R\$ 1\.600,00, de 20\/11\/2026 a 20\/10\/2027/);
  assert.match(t, /22\/10\/2026/);
});

test('corpoResumo nao traz o cabecalho do lead; resumoContrato junta os dois', () => {
  const r = montarContrato(FORM_CERTO, HOJE);
  const corpo = corpoResumo(r.contrato);
  assert.match(corpo, /^Total: R\$ 24\.200,00\./);
  assert.doesNotMatch(corpo, /Registrar contrato/);
  assert.equal(resumoContrato(r.contrato, 'X'), 'Registrar contrato de X:\n' + corpo);
});
