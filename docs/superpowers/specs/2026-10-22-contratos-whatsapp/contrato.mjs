// contrato.mjs
// Dinheiro (centavos inteiros), datas e vencimentos de um contrato dito em frase livre. Funcoes puras; o modelo de
// linguagem so extrai os campos, tudo aqui e conferido em codigo. O corpo (sem export) e copiado para o Code node do n8n.

const TOTAL_MAX_CENTAVOS = 500000000; // R$ 5.000.000
const PARCELAS_MAX = 120;

export function parseReais(v) {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? Math.round(v * 100) : null;
  if (typeof v !== 'string') return null;
  let t = v.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/r\$/g, '').replace(/reais?/g, '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  let mult = 1;
  const m = t.match(/^(.*?)\s*mil$/);
  if (m) { t = m[1].trim(); mult = 1000; }
  if (!/^\d[\d.,]*$/.test(t)) return null;
  let n;
  if (t.includes(',')) {
    if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/.test(t)) return null;
    n = Number(t.replace(/\./g, '').replace(',', '.'));
  } else if (t.includes('.')) {
    if (/^\d{1,3}(\.\d{3})+$/.test(t)) n = Number(t.replace(/\./g, ''));
    else if (/^\d+\.\d{1,2}$/.test(t)) n = Number(t);
    else return null;
  } else {
    n = Number(t);
  }
  const c = Math.round(n * mult * 100);
  return Number.isFinite(c) && c > 0 ? c : null;
}

function dataValida(a, m, d) {
  const x = new Date(Date.UTC(a, m - 1, d));
  return x.getUTCFullYear() === a && x.getUTCMonth() === m - 1 && x.getUTCDate() === d;
}
function iso(a, m, d) {
  return String(a).padStart(4, '0') + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}

// hoje = 'aaaa-mm-dd'. modo decide o ano quando o texto nao traz ano: 'passada' (o dia mais recente que nao passa de hoje)
// ou 'futura' (o primeiro dia que nao e anterior a hoje).
export function resolverData(texto, hoje, modo) {
  const t = String(texto ?? '').trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return dataValida(+m[1], +m[2], +m[3]) ? t : null;
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (m) {
    const a = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return dataValida(a, +m[2], +m[1]) ? iso(a, +m[2], +m[1]) : null;
  }
  m = t.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!m) return null;
  const ano = +hoje.slice(0, 4);
  let a = ano;
  if (!dataValida(a, +m[2], +m[1])) return null;
  const aqui = iso(a, +m[2], +m[1]);
  if (modo === 'passada' && aqui > hoje) a = ano - 1;
  if (modo === 'futura' && aqui < hoje) a = ano + 1;
  return dataValida(a, +m[2], +m[1]) ? iso(a, +m[2], +m[1]) : null;
}

function diasNoMes(a, m) {
  return new Date(Date.UTC(a, m, 0)).getUTCDate();
}

// Primeira parcela na data dada; as demais todo mes no "dia" (padrao: o dia do primeiro vencimento), com o fim de mes
// curto indo para o ultimo dia do mes.
export function vencimentos(primeiro, dia, quantidade) {
  const [a0, m0, d0] = primeiro.split('-').map(Number);
  const alvo = Number.isInteger(dia) && dia >= 1 && dia <= 31 ? dia : d0;
  const saida = [];
  for (let k = 0; k < quantidade; k++) {
    if (k === 0) { saida.push(primeiro); continue; }
    const idx = m0 - 1 + k;
    const a = a0 + Math.floor(idx / 12);
    const m = (idx % 12) + 1;
    saida.push(iso(a, m, Math.min(alvo, diasNoMes(a, m))));
  }
  return saida;
}

export function formatarReais(centavos) {
  const c = Math.abs(Math.round(centavos));
  const reais = String(Math.floor(c / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (centavos < 0 ? '-' : '') + 'R$ ' + reais + ',' + String(c % 100).padStart(2, '0');
}

function dataBR(isoData) {
  const [a, m, d] = isoData.split('-');
  return d + '/' + m + '/' + a;
}

const falha = (motivo, mensagem, extra = {}) => ({ ok: false, motivo, mensagem, ...extra });

export function montarContrato(form, hoje) {
  const f = form && typeof form === 'object' ? form : {};
  if (f.total === undefined || f.total === null || f.total === '') return falha('total_ausente', 'Não entendi o valor total do contrato.');
  const total = parseReais(f.total);
  if (!total) return falha('total_invalido', 'Não entendi o valor total do contrato.');
  if (total > TOTAL_MAX_CENTAVOS) return falha('total_alto', 'O valor total passa do limite de R$ 5.000.000,00. Nada foi gravado.');

  const parcelas = [];
  let soma = 0;
  const e = f.entrada && typeof f.entrada === 'object' ? f.entrada : null;
  if (e && e.valor !== undefined && e.valor !== null && e.valor !== '') {
    const v = parseReais(e.valor);
    if (!v) return falha('entrada_invalida', 'Não entendi o valor da entrada.');
    let venc = hoje;
    let pago = null;
    if (e.paga_em) {
      pago = resolverData(e.paga_em, hoje, 'passada');
      if (!pago) return falha('data_invalida', 'Não entendi a data de pagamento da entrada.');
      if (pago > hoje) return falha('pagamento_no_futuro', 'A data de pagamento da entrada é futura. Nada foi gravado.');
      venc = pago;
    } else if (e.vence_em) {
      venc = resolverData(e.vence_em, hoje, 'futura');
      if (!venc) return falha('data_invalida', 'Não entendi a data de vencimento da entrada.');
    }
    parcelas.push({ numero: 0, valor_centavos: v, vencimento: venc, pago_em: pago });
    soma += v;
  }

  const p = f.parcelas && typeof f.parcelas === 'object' ? f.parcelas : null;
  if (p) {
    const q = Number(p.quantidade);
    const v = parseReais(p.valor);
    if (!Number.isInteger(q) || q < 1 || q > PARCELAS_MAX || !v) return falha('parcelas_invalidas', 'Não entendi a quantidade ou o valor das parcelas (de 1 a 120).');
    const dia = p.dia === undefined || p.dia === null ? undefined : Number(p.dia);
    let primeiro = null;
    if (p.primeiro_vencimento) {
      primeiro = resolverData(p.primeiro_vencimento, hoje, 'futura');
      if (!primeiro) return falha('data_invalida', 'Não entendi a data do primeiro vencimento.');
    } else if (Number.isInteger(dia) && dia >= 1 && dia <= 31) {
      const [a, m] = hoje.split('-').map(Number);
      const hojeDia = Number(hoje.slice(8));
      let ano = a, mes = m;
      if (Math.min(dia, diasNoMes(ano, mes)) <= hojeDia) { mes += 1; if (mes > 12) { mes = 1; ano += 1; } }
      primeiro = iso(ano, mes, Math.min(dia, diasNoMes(ano, mes)));
    } else {
      return falha('primeiro_vencimento_ausente', 'Não entendi quando vence a primeira parcela.');
    }
    const datas = vencimentos(primeiro, dia, q);
    datas.forEach((d, i) => parcelas.push({ numero: i + 1, valor_centavos: v, vencimento: d, pago_em: null }));
    soma += v * q;
  }
  if (parcelas.length === 0) return falha('sem_parcelas', 'Não entendi nem a entrada nem as parcelas do contrato.');

  if (soma !== total) {
    const dif = soma - total;
    return falha('soma_nao_bate',
      'A entrada mais as parcelas somam ' + formatarReais(soma) + ' e o valor total é ' + formatarReais(total) +
      ' (diferença de ' + formatarReais(Math.abs(dif)) + '). Nada foi gravado. Reenvie o pedido com os valores corrigidos.',
      { diferenca_centavos: dif });
  }
  return { ok: true, contrato: { total_centavos: total, assinado_em: hoje, parcelas } };
}

// Corpo do resumo (sem o cabecalho com o nome do lead, que o banco monta depois de resolver o lead).
export function corpoResumo(contrato) {
  const linhas = ['Total: ' + formatarReais(contrato.total_centavos) + '.'];
  const entrada = contrato.parcelas.find((x) => x.numero === 0);
  if (entrada) {
    linhas.push('Entrada: ' + formatarReais(entrada.valor_centavos) +
      (entrada.pago_em ? ' (paga em ' + dataBR(entrada.pago_em) + ')' : ' (vence em ' + dataBR(entrada.vencimento) + ')') + '.');
  }
  const resto = contrato.parcelas.filter((x) => x.numero >= 1);
  if (resto.length === 1) {
    linhas.push('1 parcela de ' + formatarReais(resto[0].valor_centavos) + ', com vencimento em ' + dataBR(resto[0].vencimento) + '.');
  } else if (resto.length > 1) {
    linhas.push(resto.length + ' parcelas de ' + formatarReais(resto[0].valor_centavos) + ', de ' + dataBR(resto[0].vencimento) + ' a ' + dataBR(resto[resto.length - 1].vencimento) + '.');
  }
  linhas.push('Assinatura: ' + dataBR(contrato.assinado_em) + '.');
  return linhas.join('\n');
}

export function resumoContrato(contrato, rotuloLead) {
  return 'Registrar contrato de ' + rotuloLead + ':\n' + corpoResumo(contrato);
}
