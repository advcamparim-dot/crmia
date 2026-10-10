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

// acrescentar a redigir.mjs
const PERGUNTAS = {
  tipo_contrato: 'Quais tipos de contratos ou operações estão em atraso hoje? Por exemplo: capital de giro, empréstimos, cartão, cheque especial, financiamento ou Pronampe.',
  situacao_judicial: 'Você já recebeu alguma notificação do banco ou já existe processo judicial em andamento?',
  banco: 'Com qual banco ou instituição financeira é esse contrato?',
  notificacao: 'A notificação que você recebeu veio do banco ou de um processo judicial?',
  causa_economica: 'O que levou ao atraso nos pagamentos?',
  outros_contratos: 'Além desse contrato, existem outras dívidas bancárias em aberto?',
  renegociacao: 'Você já tentou renegociar com o banco?',
  nenhuma: 'Pode me contar com as suas palavras como está a situação hoje?',
  outra: 'Pode me contar um pouco mais sobre a situação?',
};

function horaEmBrasilia(agora) {
  const data = agora instanceof Date && !Number.isNaN(agora.getTime()) ? agora : new Date();
  const hora = new Intl.DateTimeFormat('pt-BR', { hour: 'numeric', hourCycle: 'h23', timeZone: 'America/Sao_Paulo' }).format(data);
  return Number.parseInt(hora, 10);
}

function saudacao(agora) {
  const h = horaEmBrasilia(agora);
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}

function primeiroNome(fatos) {
  const f = fatos && typeof fatos === 'object' ? fatos : {};
  const token = String(f.nomeCompleto ?? '').trim().split(/\s+/)[0] || '';
  if (!/^[\p{L}'-]{1,30}$/u.test(token)) return '';
  return token.charAt(0).toUpperCase() + token.slice(1);
}

function motivoDoContato(fatos) {
  const f = fatos && typeof fatos === 'object' ? fatos : {};
  const empresa = f.documento === 'CNPJ' || /jur[ií]dica/i.test(String(f.perfil ?? ''));
  return empresa ? 'sobre as dívidas bancárias da empresa' : 'sobre as suas dívidas bancárias';
}

export function montarRascunhoModelo(fatos, lacuna, agora) {
  const codigo = lacuna && PERGUNTAS[lacuna.codigo] ? lacuna.codigo : 'outra';
  const nome = primeiroNome(fatos);
  return saudacao(agora) + (nome ? ', ' + nome : '') + '. Tudo bem? Aqui é a Mayara, do Camparim Advogados.\n\n'
    + 'Recebi sua solicitação ' + motivoDoContato(fatos) + '. ' + PERGUNTAS[codigo];
}

const PROMESSA = /garant|100\s*%|certeza|assegur|ganh(ar|amos) a causa|sem risco|gr[aá]tis|de gra[cç]a/i;

export function validarRascunho(texto, fatos) {
  const f = fatos && typeof fatos === 'object' ? fatos : {};
  const t = typeof texto === 'string' ? texto.trim() : '';
  if (!t) return { valido: false, motivo: 'vazio' };
  if (t.length > 700) return { valido: false, motivo: 'longo' };
  if (/https?:|www\.|wa\.me|\{\{|\}\}/i.test(t)) return { valido: false, motivo: 'link_ou_template' };
  if (PROMESSA.test(t)) return { valido: false, motivo: 'promessa' };
  if (!/^(bom dia|boa tarde|boa noite|ol[aá]|oi)(?![\p{L}])/iu.test(t)) return { valido: false, motivo: 'sem_saudacao' };
  if (!/mayara/i.test(t)) return { valido: false, motivo: 'sem_apresentacao' };
  // a cortesia "Tudo bem?" nao conta como pergunta de qualificacao
  if ((t.replace(/tudo bem\?/gi, '').match(/\?/g) || []).length !== 1) return { valido: false, motivo: 'perguntas' };
  if (sanitizarFato(f.tipoDivida) && /tipos? de contratos?/i.test(t)) return { valido: false, motivo: 'repete_fato' };
  if (sanitizarFato(f.valorAproximado) && /qual (é )?o valor/i.test(t)) return { valido: false, motivo: 'repete_fato' };
  return { valido: true };
}
