// gerar-followup-node.mjs: gera os corpos dos Code nodes da regua a partir de followup.mjs (codigo testado).
// Uso: node gerar-followup-node.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const lib = readFileSync(join(dir, 'followup.mjs'), 'utf8').replace(/^export\s+/gm, '');
const CAB = '// Gerado por gerar-followup-node.mjs a partir de followup.mjs (testado em followup.test.mjs). Colar como esta.\n';

export const corpoPedido = CAB + lib + `
return $input.all().map((it) => {
  const r = it.json;
  const ctx = r.ctx || {};
  const pedido = montarPedido({
    sequencia: r.lead_sequencia, etapa: r.lead_etapa, tentativa: ctx.tentativa, nome: ctx.nome || r.lead_nome, agora: new Date(),
    mensagens: ctx.mensagens, fatos: ctx.fatos, anteriores: ctx.anteriores,
  });
  return { json: { ...r, prompt: pedido.system + '\\n\\nDADOS (JSON):\\n' + pedido.user, tem_aprovado: Boolean(r.texto_proximo) } };
});
`;

export const corpoEscolher = CAB + lib + `
const bases = $('Montar Pedido').all();
return $input.all().map((it, i) => {
  const base = bases[i].json;
  const ctx = base.ctx || {};
  const saida = it.json || {};
  const textoIA = typeof saida.text === 'string' ? saida.text : (typeof saida.output === 'string' ? saida.output : '');
  const e = escolherTexto({
    sequencia: base.lead_sequencia, etapa: base.lead_etapa, nome: ctx.nome || base.lead_nome, agora: new Date(),
    anteriores: ctx.anteriores, textoIA, textoPreAprovado: base.texto_proximo, fatos: ctx.fatos,
  });
  return { json: { log_id: base.log_id, modo: base.modo, telefone: ctx.telefone || base.lead_telefone, texto: e.texto, fonte: e.fonte, motivo_rejeicao: e.motivoRejeicao } };
});
`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(join(dir, 'pedido.node.js'), corpoPedido);
  writeFileSync(join(dir, 'escolher.node.js'), corpoEscolher);
  console.log('pedido.node.js (' + corpoPedido.length + ') e escolher.node.js (' + corpoEscolher.length + ') gerados');
}
