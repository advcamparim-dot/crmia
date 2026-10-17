// gerar-workflows.mjs: monta os workflows "Followup: Worker" e "Followup: Resumo Diario" (JSON do n8n).
// Uso: node gerar-workflows.mjs  (grava em docs/superpowers/specs/workflows/)
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { corpoPedido, corpoEscolher } from './gerar-followup-node.mjs';

const dir = dirname(fileURLToPath(import.meta.url));
const PG = { postgres: { id: 'nNpCUIhnDuVvTApU', name: 'Postgres account' } };
const ANTHROPIC = { anthropicApi: { id: '6U02h1ioNpD09Q99', name: 'Anthropic account 2' } };
const CANAL_ENVIAR = { __rl: true, value: 'SHLZkNqfbCrs2OSQ', mode: 'list', cachedResultName: 'Mayara — Canal: Enviar [Sub-workflow]' };
const ALERTAR = { __rl: true, value: 'FWSC1k1CBMWBtsNs', mode: 'list', cachedResultName: 'Mayara — Alertar Escritório [Sub-workflow]' };
const ERRO = 'CQyjBKLX0UheNh1q';
const id = (p, n) => `${p}000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const campo = (nome) => ({ id: nome, displayName: nome, required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true });
const entrada = (valores) => ({ mappingMode: 'defineBelow', value: valores, matchingColumns: [], schema: Object.keys(valores).map(campo), attemptToConvertTypes: false, convertFieldsToString: true });
const pg = (nid, nome, pos, query, repl, extra = {}) => ({ id: nid, name: nome, type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: pos, credentials: PG,
  parameters: { operation: 'executeQuery', query, options: repl ? { queryReplacement: repl } : {} }, ...extra });
const codigo = (nid, nome, pos, js) => ({ id: nid, name: nome, type: 'n8n-nodes-base.code', typeVersion: 2, position: pos, parameters: { jsCode: js } });
const se = (nid, nome, pos, esq) => ({ id: nid, name: nome, type: 'n8n-nodes-base.if', typeVersion: 2.2, position: pos,
  parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 }, conditions: [{ id: nid + '-c', leftValue: esq, rightValue: true, operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' }, options: {} } });
const sub = (nid, nome, pos, workflowId, valores, espera, extra = {}) => ({ id: nid, name: nome, type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.3, position: pos,
  parameters: { workflowId, workflowInputs: entrada(valores), options: { waitForSubWorkflow: espera } }, ...extra });
const lig = (...d) => ({ main: [d.map((node) => ({ node, type: 'main', index: 0 }))] });

export function montarWorker() {
  const nodes = [
    { id: id('f1', 1), name: 'A Cada 5 Minutos', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, position: [0, 300], parameters: { rule: { interval: [{ field: 'minutes', minutesInterval: 5 }] } } },
    pg(id('f1', 2), 'Fechar Ciclos', [220, 80], 'select * from mayara.followups_fechar_ciclos()', null, { onError: 'continueRegularOutput' }),
    codigo(id('f1', 3), 'Montar Aviso', [440, 80], "return $input.all().map((it) => { const r = it.json; const nome = r.lead_nome || 'Um lead'; return { json: { texto: 'Atenção: ' + nome + ' ' + (r.motivo === 'teto' ? 'recebeu ' + r.enviados + ' follow-ups sem responder e atingiu o limite' : 'esgotou a sequência de follow-ups') + '. A régua parou e o lead ficou em revisão humana. Decida se vale um novo contato.' } }; });"),
    sub(id('f1', 4), 'Alertar Escritório', [660, 80], ALERTAR, { texto: '={{ $json.texto }}' }, false, { onError: 'continueRegularOutput' }),
    pg(id('f1', 5), 'Reservar', [220, 300], 'select r.*, mayara.contexto_followup(r.log_id) as ctx from mayara.reservar_followups(now(), 1) r'),
    codigo(id('f1', 6), 'Montar Pedido', [440, 300], corpoPedido),
    { id: id('f1', 7), name: 'Gerar Texto', type: '@n8n/n8n-nodes-langchain.chainLlm', typeVersion: 1.9, position: [660, 300], onError: 'continueRegularOutput',
      parameters: { promptType: 'define', text: '={{ $json.prompt }}' } },
    { id: id('f1', 8), name: 'Modelo Anthropic', type: '@n8n/n8n-nodes-langchain.lmChatAnthropic', typeVersion: 1.3, position: [660, 500], credentials: ANTHROPIC,
      parameters: { model: { __rl: true, mode: 'list', value: 'claude-sonnet-4-5-20250929', cachedResultName: 'Claude Sonnet 4.5' }, options: { temperature: 0.6 } } },
    codigo(id('f1', 9), 'Escolher Texto', [880, 300], corpoEscolher),
    pg(id('f1', 10), 'Revalidar', [1100, 300],
      'select $1::bigint as log_id, $2::text as texto, $3::text as fonte, $4::text as telefone, $5::text as modo, $6::text as motivo_rejeicao, mayara.followup_ainda_valido($1::bigint) as v',
      '={{ [$json.log_id, $json.texto, $json.fonte, $json.telefone, $json.modo, $json.motivo_rejeicao || null] }}'),
    se(id('f1', 11), 'Valido?', [1320, 300], '={{ $json.v.ok === true }}'),
    pg(id('f1', 12), 'Cancelar', [1540, 460], "select mayara.registrar_followup($1::bigint, 'cancelado', null, null, $2::text)", '={{ [$json.log_id, $json.v.motivo] }}', { onError: 'continueRegularOutput' }),
    se(id('f1', 13), 'Simulacao?', [1540, 200], "={{ $json.modo === 'simulacao' }}"),
    pg(id('f1', 14), 'Registrar Simulado', [1760, 120], "select mayara.registrar_followup($1::bigint, 'simulado', $2::text, $3::text, $4::text)", '={{ [$json.log_id, $json.texto, $json.fonte, $json.motivo_rejeicao || null] }}', { onError: 'continueRegularOutput' }),
    sub(id('f1', 15), 'Enviar Follow-up', [1760, 280], CANAL_ENVIAR, { canalId: 'escritorio', para: '={{ $json.telefone }}', tipo: 'texto', texto: '={{ $json.texto }}', templateNome: '', templateVariaveis: '', identificarMayara: 'true', origem: 'followup' }, true, { onError: 'continueRegularOutput' }),
    codigo(id('f1', 16), 'Casar Envio', [1980, 280],
      "const base = $('Revalidar').all().map((i) => i.json).filter((j) => j.v && j.v.ok === true && j.modo !== 'simulacao');\nreturn $input.all().map((it, i) => ({ json: { log_id: base[i].log_id, texto: base[i].texto, fonte: base[i].fonte, ok: it.json.ok === true, erro: it.json.ok === true ? '' : String((it.json.error && it.json.error.message) || it.json.message || 'falha_no_envio').slice(0, 200) } }));"),
    pg(id('f1', 17), 'Registrar Resultado', [2200, 280], "select mayara.registrar_followup($1::bigint, case when $2::boolean then 'enviado' else 'falhou' end, $3::text, $4::text, nullif($5::text, ''))", '={{ [$json.log_id, $json.ok, $json.texto, $json.fonte, $json.erro] }}', { onError: 'continueRegularOutput' }),
  ];
  const connections = {
    'A Cada 5 Minutos': lig('Fechar Ciclos', 'Reservar'),
    'Fechar Ciclos': lig('Montar Aviso'),
    'Montar Aviso': lig('Alertar Escritório'),
    Reservar: lig('Montar Pedido'),
    'Montar Pedido': lig('Gerar Texto'),
    'Modelo Anthropic': { ai_languageModel: [[{ node: 'Gerar Texto', type: 'ai_languageModel', index: 0 }]] },
    'Gerar Texto': lig('Escolher Texto'),
    'Escolher Texto': lig('Revalidar'),
    Revalidar: lig('Valido?'),
    'Valido?': { main: [[{ node: 'Simulacao?', type: 'main', index: 0 }], [{ node: 'Cancelar', type: 'main', index: 0 }]] },
    'Simulacao?': { main: [[{ node: 'Registrar Simulado', type: 'main', index: 0 }], [{ node: 'Enviar Follow-up', type: 'main', index: 0 }]] },
    'Enviar Follow-up': lig('Casar Envio'),
    'Casar Envio': lig('Registrar Resultado'),
  };
  return { name: 'Mayara — Follow-up: Worker', nodes, connections, settings: { executionOrder: 'v1', errorWorkflow: ERRO } };
}

export function montarResumo() {
  const nodes = [
    { id: id('f2', 1), name: 'Fim do Expediente', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, position: [0, 300],
      parameters: { rule: { interval: [{ field: 'cronExpression', expression: '30 18 * * 1-6' }] } } },
    pg(id('f2', 2), 'Resumo', [220, 300],
      "select mayara.followups_resumo(date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo') as texto, (select valor from mayara.config where chave = 'followup_modo') as modo"),
    se(id('f2', 3), 'Ativo?', [440, 300], "={{ $json.modo !== 'desligado' }}"),
    sub(id('f2', 4), 'Alertar Escritório', [660, 300], ALERTAR, { texto: "={{ 'Resumo do dia (' + $json.modo + '). ' + $json.texto }}" }, false, { onError: 'continueRegularOutput' }),
  ];
  const connections = { 'Fim do Expediente': lig('Resumo'), Resumo: lig('Ativo?'), 'Ativo?': { main: [[{ node: 'Alertar Escritório', type: 'main', index: 0 }], []] } };
  return { name: 'Mayara — Follow-up: Resumo Diário', nodes, connections, settings: { executionOrder: 'v1', errorWorkflow: ERRO, timezone: 'America/Sao_Paulo' } };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const saida = join(dir, '..', 'workflows');
  writeFileSync(join(saida, 'mayara-followup-worker.json'), JSON.stringify(montarWorker(), null, 2));
  writeFileSync(join(saida, 'mayara-followup-resumo.json'), JSON.stringify(montarResumo(), null, 2));
  console.log('workflows gerados em', saida);
}
