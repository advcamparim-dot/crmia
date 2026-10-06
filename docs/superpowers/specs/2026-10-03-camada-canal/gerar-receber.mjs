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

export function montarWorkflow(processarId = '1ciEX4HqgbaS3Gqx') {
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
    { id: id(7), name: 'Registrar Aceito', type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [1200, 220], credentials: PG,
      parameters: { operation: 'executeQuery', query: SQL_REGISTRO,
        options: { queryReplacement: "={{ [$json.evento.canalId, 'evolution', 'aceito', '', $json.evento.phone, $json.evento.messageType, String($json.evento.message.length), String($json.evento.requiresHuman)] }}" } } },
    { id: id(8), name: 'Registrar Descartado', type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [1200, 400], credentials: PG,
      parameters: { operation: 'executeQuery', query: SQL_REGISTRO,
        options: { queryReplacement: "={{ ['escritorio', 'evolution', 'descartado', $json.motivo, '', '', '', ''] }}" } } },
    { id: id(9), name: 'Preparar Evento', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1440, 220],
      parameters: { jsCode: "return [{ json: $('Normalizar Evento').first().json.evento }];" } },
    { id: id(10), name: 'Processar Evento', type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.3, position: [1680, 220], onError: 'continueRegularOutput',
      parameters: { workflowId: { __rl: true, value: processarId, mode: 'list', cachedResultName: 'Mayara — Canal: Processar Evento [Sub-workflow]' },
        options: { waitForSubWorkflow: true } } },
  ];
  const ligar = (...destinos) => ({ main: [destinos.map((node) => ({ node, type: 'main', index: 0 }))] });
  const connections = {
    'Webhook Evolution': ligar('Conferir Segredo'),
    'Conferir Segredo': ligar('Segredo OK?'),
    'Segredo OK?': { main: [[{ node: 'Normalizar Evento', type: 'main', index: 0 }], [{ node: 'Descartar em Silencio', type: 'main', index: 0 }]] },
    'Normalizar Evento': ligar('Aceito?'),
    'Registrar Aceito': ligar('Preparar Evento'),
    'Preparar Evento': ligar('Processar Evento'),
    'Aceito?': { main: [[{ node: 'Registrar Aceito', type: 'main', index: 0 }], [{ node: 'Registrar Descartado', type: 'main', index: 0 }]] },
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
