export function calcularLacunas(fatosJson) {
  const f = fatosJson || {};

  const fatosConhecidosPares = [];
  if (f.tipoDivida) fatosConhecidosPares.push(`tipo=${f.tipoDivida}`);
  if (f.bancos && f.bancos.length) fatosConhecidosPares.push(`banco=${f.bancos.join(', ')}`);
  if (f.valorAproximado) fatosConhecidosPares.push(`valor=${f.valorAproximado}`);
  if (f.documento) fatosConhecidosPares.push(`documento=${f.documento}`);

  const linhaFatos = fatosConhecidosPares.length
    ? `FATOS JÁ CONHECIDOS: ${fatosConhecidosPares.join('; ')}`
    : 'FATOS JÁ CONHECIDOS: (nenhum ainda)';

  const lacunasEmOrdem = [];

  if (!f.situacaoJudicial || !f.urgencia) {
    lacunasEmOrdem.push('situação judicial vs. cobrança informal');
  }
  if (!f.bancos || !f.bancos.length) {
    lacunasEmOrdem.push('banco(s) envolvido(s) na dívida');
  }
  if (f.notificacaoOrigem === 'desconhecida') {
    lacunasEmOrdem.push('origem da notificação recebida (banco ou judicial)');
  }
  if (!f.causaEconomica) {
    lacunasEmOrdem.push('causa econômica do atraso/dificuldade');
  }
  if (typeof f.outrosContratosOuDividas === 'undefined') {
    lacunasEmOrdem.push('existência de outros contratos ou dívidas bancárias');
  }
  if (typeof f.tentativaRenegociacao === 'undefined') {
    lacunasEmOrdem.push('tentativa anterior de renegociação com o banco');
  }

  if (lacunasEmOrdem.length === 0) {
    return [
      linhaFatos,
      'LACUNA PRIORITÁRIA EM ABERTO: nenhuma — todas as lacunas conhecidas foram resolvidas',
      'NUNCA PERGUNTE O QUE JÁ ESTÁ EM "FATOS JÁ CONHECIDOS"',
    ].join('\n');
  }

  const [prioritaria, ...outras] = lacunasEmOrdem;
  const linhas = [linhaFatos, `LACUNA PRIORITÁRIA EM ABERTO: ${prioritaria}`];
  if (outras.length) {
    linhas.push(`OUTRAS LACUNAS (só considerar se a prioritária já foi resolvida): ${outras.join('; ')}`);
  }
  linhas.push('NUNCA PERGUNTE O QUE JÁ ESTÁ EM "FATOS JÁ CONHECIDOS"');
  return linhas.join('\n');
}
