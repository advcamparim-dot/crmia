// redigir.mjs
// Le o card do lead, escolhe a primeira pergunta pela lacuna prioritaria e monta o rascunho do primeiro contato.
// Funcoes puras. O corpo (sem import/export) e gerado para o Code node do n8n por gerar-redigir-node.mjs.
import { calcularLacunas, sanitizarFato } from '../2026-09-18-mayara-v3/calcular-lacunas.mjs';

function documentoDe(ondeDivida) {
  const t = String(ondeDivida ?? '').toUpperCase();
  if (t.includes('CNPJ')) return 'CNPJ';
  if (t.includes('CPF')) return 'CPF';
  return '';
}

export function cartaoParaFatos(lead) {
  const l = lead && typeof lead === 'object' ? lead : {};
  const fatos = { origemLead: 'grupo_agencia' };
  const pares = {
    nomeCompleto: l.nome,
    valorAproximado: l.valorDivida,
    situacaoFormulario: l.situacao,
    campanha: l.campanha,
    tipoDivida: l.tipo,
    perfil: l.ondeDivida,
  };
  for (const [chave, valor] of Object.entries(pares)) {
    const texto = sanitizarFato(valor);
    if (texto) fatos[chave] = texto;
  }
  const documento = documentoDe(l.ondeDivida);
  if (documento) fatos.documento = documento;
  return fatos;
}

// acrescentar a redigir.mjs
const CODIGOS = [
  ['situação judicial', 'situacao_judicial'],
  ['banco(s)', 'banco'],
  ['origem da notificação', 'notificacao'],
  ['causa econômica', 'causa_economica'],
  ['outros contratos', 'outros_contratos'],
  ['renegociação', 'renegociacao'],
];

export function escolherLacuna(fatos) {
  const f = fatos !== null && typeof fatos === 'object' && !Array.isArray(fatos) ? fatos : {};
  if (!sanitizarFato(f.tipoDivida)) {
    return { codigo: 'tipo_contrato', descricao: 'tipo de contrato ou operação em atraso' };
  }
  const bancos = Array.isArray(f.bancos) ? f.bancos : [f.bancos];
  if (!bancos.some((b) => sanitizarFato(b))) {
    return { codigo: 'banco', descricao: 'banco ou instituição financeira do contrato' };
  }
  const linha = calcularLacunas(f).split('\n').find((l) => l.startsWith('LACUNA PRIORITÁRIA EM ABERTO:')) || '';
  const descricao = linha.replace('LACUNA PRIORITÁRIA EM ABERTO:', '').trim();
  if (descricao.startsWith('nenhuma')) return { codigo: 'nenhuma', descricao: '' };
  const achado = CODIGOS.find(([trecho]) => descricao.includes(trecho));
  return { codigo: achado ? achado[1] : 'outra', descricao };
}
