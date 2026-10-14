// Gerado por gerar-nodes.mjs a partir das bibliotecas testadas. Colar como esta.

// recuperar.mjs
// Funcoes puras da recuperacao de mensagens. O corpo (sem export) e gerado para Code nodes do n8n.

function janelaBusca(desdeIso, agoraIso) {
  const agora = Date.parse(agoraIso);
  let desde = Date.parse(desdeIso);
  if (!Number.isFinite(desde)) desde = agora - 30 * 60 * 1000;
  desde = Math.max(desde, agora - 48 * 3600 * 1000);
  desde = Math.min(desde, agora - 5 * 60 * 1000);
  return { gte: Math.floor(desde / 1000), lte: Math.floor(agora / 1000), ateIso: new Date(agora).toISOString() };
}

function corpoBusca(janela, pagina = 1, tamanho = 200) {
  return { where: { messageTimestamp: { gte: janela.gte, lte: janela.lte } }, page: pagina, offset: tamanho };
}

function extrairRegistros(resposta) {
  if (Array.isArray(resposta)) return resposta;
  if (!resposta || typeof resposta !== 'object') return [];
  if (resposta.messages && Array.isArray(resposta.messages.records)) return resposta.messages.records;
  if (Array.isArray(resposta.records)) return resposta.records;
  return [];
}

function registroParaEvento(registro, instancia) {
  return { event: 'messages.upsert', instance: instancia, data: registro };
}

function segundos(ts) {
  const n = Number(ts && typeof ts === 'object' ? ts.low : ts);
  return Number.isFinite(n) ? n : 0;
}

function prepararLote(resposta, instancia, janela, limite) {
  const dentro = extrairRegistros(resposta)
    .map((r) => ({ r, t: segundos(r && r.messageTimestamp) }))
    .filter((x) => x.t >= janela.gte && x.t <= janela.lte)
    .sort((a, b) => a.t - b.t)
    .slice(0, Math.max(0, limite))
    .map((x) => ({ evento: registroParaEvento(x.r, instancia), timestamp: x.t }));
  return [...dentro, { fim: true, ateIso: janela.ateIso }];
}

const e = $('Execute Workflow Trigger').first().json;
const j = janelaBusca(e.desde, new Date().toISOString());
return [{ json: { ...j, simular: String(e.simular || 'false'), corpo: corpoBusca(j, 1, 200) } }];
