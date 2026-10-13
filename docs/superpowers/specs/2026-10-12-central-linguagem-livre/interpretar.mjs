// Transforma a resposta da IA (formulario fechado) em uma decisao segura para a Central. Funcoes puras.
// O corpo (sem export) e gerado para o Code node do n8n por gerar-interpretar-node.mjs.

export function normalizarTelefone(t) {
  const bruto = String(t ?? '').trim();
  const d = bruto.replace(/\D/g, '');
  if (bruto.startsWith('+') && !d.startsWith('55')) return null;
  if (/^55\d{10,11}$/.test(d)) return '+' + d;
  if (/^\d{10,11}$/.test(d)) return '+55' + d;
  return null;
}

export function normalizarNumeroRegra(v) {
  if (typeof v === 'number') return Number.isInteger(v) && v >= 1 && v <= 999999999 ? v : null;
  const m = String(v ?? '').trim().match(/^(?:regra\s*)?#?\s*(\d{1,9})$/i);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 ? n : null;
}

export function normalizarPeriodo(v) {
  const t = String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  return ['hoje', 'semana', 'mes'].includes(t) ? t : null;
}

export function limparNome(v) {
  const t = String(v ?? '').replace(/\s+/g, ' ').trim();
  if (t.length < 2 || t.length > 60) return '';
  return /^[\p{L}][\p{L}' -]*$/u.test(t) ? t : '';
}

const INTENCOES = ['ensinar', 'consultar', 'agir', 'conversar'];
const ACOES_CONSULTA = ['status', 'contagem_leads', 'situacao_lead', 'listar_regras'];
const ACOES_AGIR = ['pausar', 'ligar', 'assumir', 'devolver', 'desfazer_regra', 'reativar_regra', 'abordar'];
const CAMPOS = ['intencao', 'acao', 'alvo', 'periodo', 'regra', 'duvida'];

export function validarFormulario(f) {
  if (!f || typeof f !== 'object' || Array.isArray(f)) return { ok: false, motivo: 'formato' };
  for (const k of Object.keys(f)) if (!CAMPOS.includes(k)) return { ok: false, motivo: 'campo_extra:' + k };
  if (!INTENCOES.includes(f.intencao)) return { ok: false, motivo: 'intencao_invalida' };
  const alvoBruto = f.alvo && typeof f.alvo === 'object' && !Array.isArray(f.alvo) ? f.alvo : {};
  const brutoTelefone = alvoBruto.telefone;
  const telefone = normalizarTelefone(brutoTelefone);
  if (brutoTelefone !== null && brutoTelefone !== undefined && String(brutoTelefone).trim() !== '' && !telefone) {
    return { ok: false, motivo: 'telefone_invalido' };
  }
  const pedido = {
    intencao: f.intencao, acao: null, telefone, nome: limparNome(alvoBruto.nome),
    numero_regra: normalizarNumeroRegra(alvoBruto.numero_regra), periodo: normalizarPeriodo(f.periodo), regra: '',
  };
  if (f.intencao === 'conversar') return { ok: true, pedido };
  if (f.intencao === 'ensinar') {
    const regra = String(f.regra ?? '').trim();
    if (!regra) return { ok: false, motivo: 'regra_vazia' };
    if (regra.length > 400) return { ok: false, motivo: 'regra_longa' };
    return { ok: true, pedido: { ...pedido, regra } };
  }
  const acao = f.acao;
  const validas = f.intencao === 'consultar' ? ACOES_CONSULTA : ACOES_AGIR;
  if (!validas.includes(acao)) return { ok: false, motivo: 'acao_invalida' };
  pedido.acao = acao;
  const temAlvo = Boolean(pedido.telefone || pedido.nome);
  if (acao === 'contagem_leads' && !pedido.periodo) return { ok: false, motivo: 'periodo_ausente' };
  if (['situacao_lead', 'assumir', 'devolver', 'abordar'].includes(acao) && !temAlvo) return { ok: false, motivo: 'alvo_ausente' };
  if (['desfazer_regra', 'reativar_regra'].includes(acao) && !pedido.numero_regra) return { ok: false, motivo: 'regra_ausente' };
  return { ok: true, pedido };
}
