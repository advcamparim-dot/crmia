import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Cola que fecha o corpo do Code node "Validar e Normalizar". Fica em String.raw para que os escapes
// (barra-u-XXXX) cheguem ao arquivo gerado como texto, e nao como o caractere. Nao usar crase nem
// dollar-chave dentro dela.
const COLA = String.raw`
// ---- cola do Code node (gerada por gerar-node.mjs; nao editar o arquivo gerado) ----
// O payloadBruto segue para colunas text/jsonb do Postgres, que recusam o caractere NUL e surrogate
// solto. limparParaBanco devolve uma COPIA profunda segura:
// - strings (e chaves) sem NUL e sem surrogate solto; o par valido fica;
// - arrays e objetos comuns limpos recursivamente, com no maximo 200 itens/chaves cada;
// - profundidade maxima 6 (a raiz e o nivel 0; qualquer valor no nivel 7 ou abaixo vira null);
// - numero, booleano e null passam iguais; todo o resto (undefined, funcao, symbol, bigint, Date,
//   Map...) vira null.
// Nunca lanca excecao.
function limparTextoParaBanco(texto) {
  return texto
    .replace(/\u0000/g, '')
    .replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '');
}

function limparParaBanco(valor, profundidade) {
  try {
    if (profundidade > 6) return null;
    if (valor === null) return null;
    if (typeof valor === 'string') return limparTextoParaBanco(valor);
    if (typeof valor === 'number' || typeof valor === 'boolean') return valor;
    if (typeof valor !== 'object') return null;
    if (Array.isArray(valor)) {
      const itens = [];
      const total = Math.min(valor.length, 200);
      for (let i = 0; i < total; i++) {
        let item = null;
        try {
          item = valor[i];
        } catch {
          item = null;
        }
        itens.push(limparParaBanco(item, profundidade + 1));
      }
      return itens;
    }
    if (Object.prototype.toString.call(valor) !== '[object Object]') return null;
    const pares = [];
    for (const chave of Object.keys(valor).slice(0, 200)) {
      let filho = null;
      try {
        filho = valor[chave];
      } catch {
        filho = null;
      }
      pares.push([limparTextoParaBanco(chave), limparParaBanco(filho, profundidade + 1)]);
    }
    return Object.fromEntries(pares);
  } catch {
    return null;
  }
}

const entrada = $input.first().json;
let payloadBruto = null;
let r = { ok: false, motivo: 'campo_invalido' };
try {
  const corpo = entrada && typeof entrada === 'object' && 'body' in entrada ? entrada.body : entrada;
  payloadBruto = limparParaBanco(corpo, 0);
  r = validarLead(corpo);
} catch {
  // Corpo hostil (getter ou proxy que lanca): segue como campo_invalido, sem lancar.
}
if (!r.ok) return [{ json: { ok: false, motivo: r.motivo, payloadBruto } }];
return [{ json: { ok: true, ...r.lead, payloadBruto } }];
`;

export function gerarCorpoDoNode() {
  const lib = readFileSync(new URL('./lead-formulario.mjs', import.meta.url), 'utf8').replace(/^export /gm, '');
  return lib + COLA;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(new URL('./lead-formulario.node.js', import.meta.url), gerarCorpoDoNode());
}
