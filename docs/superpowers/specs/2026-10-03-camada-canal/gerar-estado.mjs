// gerar-estado.mjs: gera o JSON do workflow "Mayara - Canal: Estado".
// Recebe o corpo de um webhook connection.update da Evolution, registra o estado e, na queda
// da conexao, cria uma Task de alta prioridade no EspoCRM (a linha caida nao pode avisar por si mesma).
// Uso: node gerar-estado.mjs  (grava docs/superpowers/specs/workflows/mayara-canal-estado.json)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const PG = { postgres: { id: 'nNpCUIhnDuVvTApU', name: 'Postgres account' } };
const CRM = { httpHeaderAuth: { id: 'myYur8JVp4IuNL3w', name: 'EspoCRM Alertas API' } };
const OPCOES_IF = { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 };
const id = (n) => `c9300000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export function corpoLib() {
  const fonte = readFileSync(join(dir, 'evolucao.mjs'), 'utf8').replace(/^export\s+/gm, '');
  return fonte;
}

export const RODAPE_EXTRAIR = `
let corpo = null;
try { corpo = $input.first().json; } catch (e) { corpo = null; }
return [{ json: extrairEstado(corpo) }];
`;

export function corpoNode(rodape) {
  return corpoLib() + '\n' + rodape;
}

const se = (idc, esquerda) => ({
  conditions: { options: OPCOES_IF, conditions: [{ id: idc, leftValue: esquerda, rightValue: true, operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' },
  options: {},
});

const CORPO_TAREFA = "={{ ({ name: 'WhatsApp - linha do escritorio desconectada', status: 'Not Started', priority: 'High', dateStart: $now.toUTC().toFormat('yyyy-MM-dd HH:mm:ss'), assignedUserId: '6a899b5713e9849fa', description: 'A conexao do WhatsApp do escritorio caiu. A Mayara nao esta recebendo nem respondendo ate reconectar (painel da Evolution, instancia, Conectar).', cAlertOrigin: 'WhatsApp', cAlertSeverity: 'Alta', cAlertKey: 'WHATSAPP_LINHA_CAIDA_V1:' + $('Extrair Estado').first().json.canalId + ':' + $now.toUTC().toFormat('yyyyMMddHHmm'), cSourceEntityType: 'WhatsAppMessage', cSourceRecordId: $('Extrair Estado').first().json.canalId, cDetectedAt: $now.toUTC().toFormat('yyyy-MM-dd HH:mm:ss'), cAlertRule: 'WHATSAPP_LINHA_CAIDA_V1' }) }}";

export function montarWorkflow() {
  const nodes = [
    { id: id(1), name: 'Execute Workflow Trigger', type: 'n8n-nodes-base.executeWorkflowTrigger', typeVersion: 1.1, position: [0, 300], parameters: { inputSource: 'passthrough' } },
    { id: id(2), name: 'Extrair Estado', type: 'n8n-nodes-base.code', typeVersion: 2, position: [220, 300], parameters: { jsCode: corpoNode(RODAPE_EXTRAIR) } },
    { id: id(3), name: 'Estado Valido?', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [440, 300], parameters: se('estado-valido', '={{ $json.valido === true }}') },
    { id: id(4), name: 'Registrar Estado', type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [660, 300], credentials: PG,
      parameters: { operation: 'executeQuery', query: 'select mayara.registrar_estado_canal($1, $2) as r', options: { queryReplacement: '={{ [$json.canalId, $json.estado] }}' } } },
    { id: id(5), name: 'Alertar?', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [880, 300], parameters: se('alertar', '={{ $json.r.alertar === true }}') },
    { id: id(6), name: 'Criar Tarefa no CRM', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4, position: [1100, 220], credentials: CRM, onError: 'continueRegularOutput',
      parameters: { method: 'POST', url: 'https://crm.camparimadvogados.com.br/api/v1/Task', authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
        sendBody: true, specifyBody: 'json', jsonBody: CORPO_TAREFA, options: { timeout: 20000 } } },
  ];
  const p = (...destinos) => destinos.map((node) => ({ node, type: 'main', index: 0 }));
  const connections = {
    'Execute Workflow Trigger': { main: [p('Extrair Estado')] },
    'Extrair Estado': { main: [p('Estado Valido?')] },
    'Estado Valido?': { main: [p('Registrar Estado'), []] },
    'Registrar Estado': { main: [p('Alertar?')] },
    'Alertar?': { main: [p('Criar Tarefa no CRM'), []] },
  };
  return {
    name: 'Mayara — Canal: Estado [Sub-workflow]',
    nodes, connections,
    settings: { executionOrder: 'v1', errorWorkflow: 'CQyjBKLX0UheNh1q', callerPolicy: 'workflowsFromSameOwner' },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const destino = join(dir, '..', 'workflows', 'mayara-canal-estado.json');
  writeFileSync(destino, JSON.stringify(montarWorkflow(), null, 2));
  console.log('gravado', destino);
}
