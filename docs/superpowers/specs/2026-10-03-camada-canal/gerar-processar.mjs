// gerar-processar.mjs: gera o JSON do workflow "Mayara - Canal: Processar Evento".
// Reune tudo o que o Gateway faz depois de normalizar o evento (rota, Central, portao, Ponte).
// Uso: node gerar-processar.mjs  (grava docs/superpowers/specs/workflows/mayara-canal-processar-evento.json)
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const PG = { postgres: { id: 'nNpCUIhnDuVvTApU', name: 'Postgres account' } };
const PONTE_ID = 'B1xdt1WotCQE3NOb';
const id = (n) => `c9200000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const opcoes = (tipo = 'strict') => ({ version: 2, leftValue: '', caseSensitive: true, typeValidation: tipo });
const se = (idc, esquerda) => ({
  conditions: { options: opcoes(), conditions: [{ id: idc, leftValue: esquerda, rightValue: true, operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' },
  options: {},
});
const campo = (nome) => ({ id: nome, displayName: nome, required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true });
const T = "$('Execute Workflow Trigger').first().json";

export function montarWorkflow(centralId) {
  const nodes = [
    { id: id(1), name: 'Execute Workflow Trigger', type: 'n8n-nodes-base.executeWorkflowTrigger', typeVersion: 1.1, position: [0, 300], parameters: { inputSource: 'passthrough' } },
    { id: id(2), name: 'Tem Mensagem?', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [220, 300], parameters: se('tem-mensagem', "={{ $json.reason !== 'EVENTO_SEM_MENSAGEM' }}") },
    { id: id(3), name: 'Rota da Mensagem', type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [440, 300], credentials: PG, onError: 'continueErrorOutput',
      parameters: { operation: 'executeQuery', query: 'select mayara.rota_mensagem($1::text, $2::text) as rota, $1::text as phone', options: { queryReplacement: '={{ [$json.phone, $json.message] }}' } } },
    { id: id(4), name: 'Comando?', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [660, 300], parameters: se('e-comando', "={{ $json.rota === 'comando' }}") },
    { id: id(5), name: 'Executar Central', type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.3, position: [880, 160], onError: 'continueRegularOutput',
      parameters: { workflowId: { __rl: true, value: centralId, mode: 'list', cachedResultName: 'Mayara — Central de Comando' },
        workflowInputs: { mappingMode: 'defineBelow', value: {
          phone: `={{ ${T}.phone }}`, message: `={{ ${T}.message }}`, messageId: `={{ ${T}.messageId }}`, phoneNumberId: `={{ ${T}.phoneNumberId }}` },
          matchingColumns: [], schema: ['phone', 'message', 'messageId', 'phoneNumberId'].map(campo), attemptToConvertTypes: false, convertFieldsToString: false },
        options: { waitForSubWorkflow: false } } },
    { id: id(6), name: 'Falha da Rota', type: 'n8n-nodes-base.stopAndError', typeVersion: 1, position: [660, 500],
      parameters: { errorMessage: 'Falha ao decidir a rota da mensagem (administrador ou lead); a mensagem foi descartada ate normalizar.' } },
    { id: id(7), name: 'Consultar Autorização', type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [880, 360], credentials: PG, onError: 'continueErrorOutput',
      parameters: { operation: 'executeQuery', query: 'select mayara.motivo_bloqueio($1) as motivo', options: { queryReplacement: '={{ [$json.phone] }}' } } },
    { id: id(8), name: 'Liberado?', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [1100, 360], parameters: se('liberado', '={{ $json.motivo === null }}') },
    { id: id(9), name: 'Bloqueado em Silêncio', type: 'n8n-nodes-base.noOp', typeVersion: 1, position: [1320, 520], parameters: {} },
    { id: id(10), name: 'Falha do Portão (fecha e alerta)', type: 'n8n-nodes-base.stopAndError', typeVersion: 1, position: [1100, 560],
      parameters: { errorMessage: 'Falha ao consultar a lista de leads autorizados no Gateway; mensagens estao sendo ignoradas ate normalizar.' } },
    { id: id(11), name: 'Restaurar Evento', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1320, 300], parameters: { jsCode: `return [{ json: ${T} }];` } },
    { id: id(12), name: 'Evento Autorizado?', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [1540, 300], parameters: se('whatsapp-evento-aceito', '={{ $json.accepted }}') },
    { id: id(13), name: 'Requer Atendimento Humano?', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [1760, 440], parameters: se('requer-humano', '={{ $json.requiresHuman === true }}') },
    { id: id(14), name: 'Ignorar Evento com Seguranca', type: 'n8n-nodes-base.noOp', typeVersion: 1, position: [1980, 520], parameters: {} },
    { id: id(15), name: 'Chamar Mayara — Ponte WhatsApp', type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.3, position: [1980, 300], onError: 'continueRegularOutput',
      parameters: { workflowId: { __rl: true, value: PONTE_ID, mode: 'list', cachedResultName: 'Mayara — Ponte WhatsApp' },
        workflowInputs: { mappingMode: 'defineBelow', value: Object.fromEntries(['sessionKey', 'messageId', 'phone', 'message', 'timestamp', 'channel', 'phoneNumberId', 'requiresHuman'].map((k) => [k, `={{ $json.${k} }}`])),
          matchingColumns: [], schema: ['sessionKey', 'messageId', 'phone', 'message', 'timestamp', 'channel', 'phoneNumberId', 'requiresHuman'].map((c) => (c === 'requiresHuman' ? { ...campo(c), type: 'boolean' } : campo(c))), attemptToConvertTypes: false, convertFieldsToString: false },
        options: { waitForSubWorkflow: true } } },
  ];
  const p = (...destinos) => destinos.map((node) => ({ node, type: 'main', index: 0 }));
  const connections = {
    'Execute Workflow Trigger': { main: [p('Tem Mensagem?')] },
    'Tem Mensagem?': { main: [p('Rota da Mensagem'), p('Evento Autorizado?')] },
    'Rota da Mensagem': { main: [p('Comando?'), p('Falha da Rota')] },
    'Comando?': { main: [p('Executar Central'), p('Consultar Autorização')] },
    'Consultar Autorização': { main: [p('Liberado?'), p('Falha do Portão (fecha e alerta)')] },
    'Liberado?': { main: [p('Restaurar Evento'), p('Bloqueado em Silêncio')] },
    'Restaurar Evento': { main: [p('Evento Autorizado?')] },
    'Evento Autorizado?': { main: [p('Chamar Mayara — Ponte WhatsApp'), p('Requer Atendimento Humano?')] },
    'Requer Atendimento Humano?': { main: [p('Chamar Mayara — Ponte WhatsApp'), p('Ignorar Evento com Seguranca')] },
  };
  return {
    name: 'Mayara — Canal: Processar Evento [Sub-workflow]',
    nodes, connections,
    settings: { executionOrder: 'v1', errorWorkflow: 'CQyjBKLX0UheNh1q', callerPolicy: 'workflowsFromSameOwner' },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const destino = join(dir, '..', 'workflows', 'mayara-canal-processar-evento.json');
  writeFileSync(destino, JSON.stringify(montarWorkflow('jNhj68Ee7i3w8dey'), null, 2));
  console.log('gravado', destino);
}
