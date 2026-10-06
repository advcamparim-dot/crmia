// canal.mjs
// Biblioteca da camada de canal. Sem import e sem dependencias: o corpo e copiado
// para Code nodes do n8n (gerar-enviar.mjs remove o "export ").

export const PREFIXO = '*Mayara:*\n';

export function soDigitos(t) {
  return String(t ?? '').replace(/\D/g, '');
}

export function aplicarPrefixo(texto) {
  const t = String(texto ?? '');
  return t.startsWith(PREFIXO) ? t : PREFIXO + t;
}

function lerVariaveis(v) {
  if (Array.isArray(v)) return v;
  if (v === undefined || v === null || String(v).trim() === '') return [];
  try {
    const o = JSON.parse(String(v));
    return Array.isArray(o) ? o : null;
  } catch (e) {
    return null;
  }
}

export function validarPedido(entrada) {
  const e = entrada || {};
  const canalId = String(e.canalId ?? '').trim();
  if (!canalId) return { ok: false, erro: 'canalId ausente' };
  const para = soDigitos(e.para);
  if (para.length < 10 || para.length > 15) return { ok: false, erro: 'para invalido' };
  const tipo = String(e.tipo ?? '');
  if (tipo !== 'texto' && tipo !== 'template') return { ok: false, erro: 'tipo invalido' };
  const texto = String(e.texto ?? '').trim();
  const templateNome = String(e.templateNome ?? '').trim();
  const variaveis = lerVariaveis(e.templateVariaveis);
  if (tipo === 'texto' && (texto === '' || texto.length > 4096)) return { ok: false, erro: 'texto invalido' };
  if (tipo === 'template' && templateNome === '') return { ok: false, erro: 'templateNome ausente' };
  if (variaveis === null) return { ok: false, erro: 'templateVariaveis invalido' };
  return { ok: true, pedido: {
    canalId, para, tipo, texto, templateNome, templateVariaveis: variaveis,
    identificar: e.identificarMayara === true || e.identificarMayara === 'true',
    origem: String(e.origem ?? ''),
  } };
}

export function montarCorpoMeta(p) {
  if (p.tipo === 'texto') {
    return { messaging_product: 'whatsapp', to: p.para, type: 'text', text: { body: p.identificar ? aplicarPrefixo(p.texto) : p.texto } };
  }
  const template = { name: p.templateNome, language: { code: 'pt_BR' } };
  if (p.templateVariaveis.length > 0) {
    template.components = [{ type: 'body', parameters: p.templateVariaveis.map((v) => ({ type: 'text', text: String(v) })) }];
  }
  return { messaging_product: 'whatsapp', to: p.para, type: 'template', template };
}

export function renderTemplate(corpo, variaveis) {
  const v = Array.isArray(variaveis) ? variaveis : [];
  return String(corpo ?? '').replace(/\{\{(\d+)\}\}/g, (_, n) => (v[Number(n) - 1] === undefined ? '' : String(v[Number(n) - 1])));
}

export function montarEvolution(p, corpoTemplate) {
  let texto = p.texto;
  if (p.tipo === 'template') {
    if (corpoTemplate === undefined || corpoTemplate === null) throw new Error('template sem texto equivalente cadastrado');
    texto = renderTemplate(corpoTemplate, p.templateVariaveis);
  }
  const final = p.identificar ? aplicarPrefixo(texto) : texto;
  return { caminho: '/message/sendText/' + p.canalId, corpo: { number: p.para, text: final, delay: atrasoHumanoMs(final) } };
}

export function atrasoHumanoMs(texto) {
  const n = String(texto ?? '').length;
  return Math.min(4000, Math.max(1000, 1000 + n * 20));
}

export function interpretarRespostaMeta(resposta) {
  const r = resposta && typeof resposta === 'object' ? resposta : {};
  const id = Array.isArray(r.messages) && r.messages[0] ? r.messages[0].id : undefined;
  if (!r.error && id) return { ok: true, ...r };
  let msg = 'erro_desconhecido';
  if (r.error) msg = typeof r.error === 'string' ? r.error : String(r.error.message ?? JSON.stringify(r.error));
  else if (!id) msg = 'resposta_sem_id_de_mensagem';
  return { ok: false, error: { message: msg } };
}

export function interpretarRespostaEvolution(resposta) {
  const r = resposta && typeof resposta === 'object' ? resposta : {};
  const id = r.key && r.key.id ? String(r.key.id) : undefined;
  if (!r.error && id) return { ok: true, messaging_product: 'whatsapp', messages: [{ id }] };
  let msg = 'resposta_sem_id_de_mensagem';
  const detalhe = r.response && r.response.message;
  if (detalhe) msg = Array.isArray(detalhe) ? detalhe.map(String).join('; ') : String(detalhe);
  else if (r.error) msg = typeof r.error === 'string' ? r.error : String(r.error.message ?? JSON.stringify(r.error));
  return { ok: false, error: { message: msg } };
}
