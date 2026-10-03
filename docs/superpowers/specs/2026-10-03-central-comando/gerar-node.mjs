// gerar-node.mjs: monta o corpo dos Code nodes (biblioteca + rodape) sem copiar a mao.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));

export function corpoLib() {
  return readFileSync(join(dir, 'central-comando.mjs'), 'utf8').replace(/^export\s+/gm, '');
}

export const RODAPE_CLASSIFICAR = `
const entrada = $('Execute Workflow Trigger').first().json;
const ctx = $input.first().json.ctx || {};
const r = classificarMensagem(entrada.message, { exclusivo: ctx.exclusivo === true });
return [{ json: { ...r, phone: entrada.phone, message: entrada.message, messageId: entrada.messageId, phoneNumberId: entrada.phoneNumberId } }];
`;

export const RODAPE_VALIDAR = `
const c = $('Classificar').first().json;
const bruto = $input.first().json;
const saida = interpretarRespostaIA(bruto.text !== undefined ? bruto.text : bruto.output);
return [{ json: montarResultadoEnsino(saida, c.texto) }];
`;

export function corpoNode(rodape) {
  return corpoLib() + '\n' + rodape;
}
