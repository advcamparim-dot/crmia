// gerar-receber.mjs: gera o JSON do workflow "Mayara - Canal: Receber Evolution".
// Autentica, normaliza, REGISTRA e entrega o evento aceito ao "Canal: Processar Evento" (portao, Central, Ponte).
// Este workflow em si nunca envia mensagem.
// Uso: node gerar-receber.mjs  (grava docs/superpowers/specs/workflows/mayara-canal-receber-evolution.json)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const PG = { postgres: { id: 'nNpCUIhnDuVvTApU', name: 'Postgres account' } };
const OPCOES_IF = { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 };
const id = (n) => `c9100000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export function corpoLib() {
  return readFileSync(join(dir, 'evolucao.mjs'), 'utf8').replace(/^export\s+/gm, '');
}

export const RODAPE_NORMALIZAR = `
const corpo = $('Webhook Evolution').first().json.body;
return [{ json: normalizarEvolution(corpo) }];
`;

export function corpoNode(rodape) {
  return corpoLib() + '\n' + rodape;
}

const condicaoBool = (idc, expr) => ({
  options: OPCOES_IF,
  conditions: [{ id: idc, leftValue: expr, rightValue: true, operator: { type: 'boolean', operation: 'true', singleValue: true } }],
  combinator: 'and',
});

const SQL_REGISTRO = "select mayara.registrar_evento_canal($1, $2, $3, nullif($4, ''), nullif($5, ''), nullif($6, ''), nullif($7, '')::int, nullif($8, '')::boolean)";

export function montarWorkflow(processarId = '1ciEX4HqgbaS3Gqx', estadoId = 'uRxJRPeu9axfmzAd') {
  const nodes = [
    { id: id(1), name: 'Webhook Evolution', type: 'n8n-nodes-base.webhook', typeVersion: 2.1, position: [0, 300],
      webhookId: id(101),
      parameters: { httpMethod: 'POST', path: 'canal-evolution', authentication: 'none', responseMode: 'onReceived', options: {} } },
    { id: id(2), name: 'Conferir Segredo', type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [240, 300], credentials: PG,
      parameters: { operation: 'executeQuery', query: 'select mayara.conferir_segredo_canal($1) as ok',
        options: { queryReplacement: "={{ [String($json.headers['x-canal-segredo'] || '')] }}" } } },
    { id: id(3), name: 'Segredo OK?', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [480, 300],
      parameters: { conditions: condicaoBool('segredo', '={{ $json.ok === true }}'), options: {} } },
    { id: id(4), name: 'Descartar em Silencio', type: 'n8n-nodes-base.noOp', typeVersion: 1, position: [720, 460], parameters: {} },
    { id: id(5), name: 'Normalizar Evento', type: 'n8n-nodes-base.code', typeVersion: 2, position: [720, 300],
      parameters: { jsCode: corpoNode(RODAPE_NORMALIZAR) } },
    { id: id(6), name: 'Aceito?', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [960, 300],
      parameters: { conditions: condicaoBool('aceito', "={{ $json.acao === 'processar' }}"), options: {} } },
    { id: id(7), name: 'Registrar Aceito', type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [1200, 220], credentials: PG, onError: 'continueRegularOutput',
      parameters: { operation: 'executeQuery', query: SQL_REGISTRO,
        options: { queryReplacement: "={{ [$json.evento.canalId, 'evolution', 'aceito', '', $json.evento.phone, $json.evento.messageType, String($json.evento.message.length), String($json.evento.requiresHuman)] }}" } } },
    { id: id(8), name: 'Registrar Descartado', type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [1440, 440], credentials: PG, onError: 'continueRegularOutput',
      parameters: { operation: 'executeQuery', query: SQL_REGISTRO,
        options: { queryReplacement: "={{ ['escritorio', 'evolution', 'descartado', $json.motivo, '', '', '', ''] }}" } } },
    { id: id(9), name: 'Preparar Evento', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1440, 220],
      parameters: { jsCode: "return [{ json: $('Normalizar Evento').first().json.evento }];" } },
    { id: id(10), name: 'Processar Evento', type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.3, position: [1680, 220], onError: 'continueRegularOutput',
      parameters: { workflowId: { __rl: true, value: processarId, mode: 'list', cachedResultName: 'Mayara — Canal: Processar Evento [Sub-workflow]' },
        options: { waitForSubWorkflow: true } } },
    { id: id(11), name: 'Evento de Estado?', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [600, 300],
      parameters: { conditions: condicaoBool('estado', "={{ String($('Webhook Evolution').first().json.body && $('Webhook Evolution').first().json.body.event || '').toLowerCase().replace(/_/g, '.') === 'connection.update' }}"), options: {} } },
    { id: id(12), name: 'Preparar Estado', type: 'n8n-nodes-base.code', typeVersion: 2, position: [840, 640],
      parameters: { jsCode: "return [{ json: $('Webhook Evolution').first().json.body }];" } },
    { id: id(13), name: 'Chamar Estado', type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.3, position: [1080, 640], onError: 'continueRegularOutput',
      parameters: { workflowId: { __rl: true, value: estadoId, mode: 'list', cachedResultName: 'Mayara — Canal: Estado [Sub-workflow]' },
        options: { waitForSubWorkflow: true } } },
    { id: id(14), name: 'Humano?', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [1200, 400],
      parameters: { conditions: condicaoBool('humano', "={{ $json.acao === 'humano' }}"), options: {} } },
    { id: id(15), name: 'Aguardar Registro de Envio', type: 'n8n-nodes-base.wait', typeVersion: 1.1, position: [1440, 340], webhookId: id(201),
      parameters: { amount: 5, unit: 'seconds' } },
    { id: id(16), name: 'Registrar Humano', type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [1680, 340], credentials: PG, onError: 'continueRegularOutput',
      parameters: { operation: 'executeQuery', query: 'select mayara.humano_assumiu($1, $2, $3) as r',
        options: { queryReplacement: '={{ [$json.canalId, $json.phone, $json.messageId] }}' } } },
  ];
  const ligar = (...destinos) => ({ main: [destinos.map((node) => ({ node, type: 'main', index: 0 }))] });
  const connections = {
    'Webhook Evolution': ligar('Conferir Segredo'),
    'Conferir Segredo': ligar('Segredo OK?'),
    'Segredo OK?': { main: [[{ node: 'Evento de Estado?', type: 'main', index: 0 }], [{ node: 'Descartar em Silencio', type: 'main', index: 0 }]] },
    'Evento de Estado?': { main: [[{ node: 'Preparar Estado', type: 'main', index: 0 }], [{ node: 'Normalizar Evento', type: 'main', index: 0 }]] },
    'Preparar Estado': ligar('Chamar Estado'),
    'Normalizar Evento': ligar('Aceito?'),
    'Registrar Aceito': ligar('Preparar Evento'),
    'Preparar Evento': ligar('Processar Evento'),
    'Aceito?': { main: [[{ node: 'Registrar Aceito', type: 'main', index: 0 }], [{ node: 'Humano?', type: 'main', index: 0 }]] },
    'Humano?': { main: [[{ node: 'Aguardar Registro de Envio', type: 'main', index: 0 }], [{ node: 'Registrar Descartado', type: 'main', index: 0 }]] },
    'Aguardar Registro de Envio': ligar('Registrar Humano'),
  };
  return {
    name: 'Mayara — Canal: Receber Evolution',
    nodes, connections,
    settings: { executionOrder: 'v1', errorWorkflow: 'CQyjBKLX0UheNh1q', callerPolicy: 'workflowsFromSameOwner' },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const destino = join(dir, '..', 'workflows', 'mayara-canal-receber-evolution.json');
  writeFileSync(destino, JSON.stringify(montarWorkflow(), null, 2));
  console.log('gravado', destino);
}
