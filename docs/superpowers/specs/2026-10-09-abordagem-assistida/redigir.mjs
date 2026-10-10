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
