// gerar-workflow.mjs: gera o JSON do workflow "Mayara - Central de Comando".
// Uso: node gerar-workflow.mjs  (grava docs/superpowers/specs/workflows/mayara-central-de-comando.json)
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { corpoNode, RODAPE_CLASSIFICAR, RODAPE_VALIDAR } from './gerar-node.mjs';

const PG = { postgres: { id: 'nNpCUIhnDuVvTApU', name: 'Postgres account' } };
const BEARER = { httpBearerAuth: { id: 'SChAKcHay4ghJVwe', name: 'Bearer Auth account' } };
const ANTHROPIC = { anthropicApi: { id: '6U02h1ioNpD09Q99', name: 'Anthropic account 2' } };
const TABELA = {
  __rl: true, value: '8zkrH8xVko73LXAd', mode: 'list', cachedResultName: 'Mayara Control',
  cachedResultUrl: '/projects/lmefImJvOTxhjDPR/datatables/8zkrH8xVko73LXAd',
};
const FILTRO_GLOBAL = { conditions: [{ keyName: 'controlKey', keyValue: 'global' }] };
const OPCOES_IF = { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 };

const id = (n) => `c8000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function hash(s) { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0; return h; }
const igual = (esquerda, direita) => ({
  conditions: { options: OPCOES_IF, conditions: [{ id: 'c' + Math.abs(hash(esquerda + direita)),
    leftValue: esquerda, rightValue: direita, operator: { type: 'string', operation: 'equals' } }], combinator: 'and' },
  options: {},
});
const regra = (valor) => ({
  conditions: { options: OPCOES_IF, conditions: [{ id: 'r-' + valor, leftValue: '={{ $json.tipo }}', rightValue: valor,
    operator: { type: 'string', operation: 'equals' } }], combinator: 'and' },
  renameOutput: true, outputKey: valor,
});

const PROMPT_IA = [
  'Você transforma mensagens de um administrador em uma regra curta de atendimento para a atendente virtual Mayara,',
  'que faz o primeiro atendimento de empresas endividadas com bancos no escritório Camparim Advogados.',
  'Responda SOMENTE com JSON, sem nenhum texto fora dele, em um destes formatos:',
  '{"tipo":"instrucao","regra":"<regra em até 300 caracteres, em português, na segunda pessoa, começando por um verbo ou por Quando>"}',
  'quando a mensagem ensina ou muda o jeito de atender;',
  '{"tipo":"duvida","pergunta":"<uma pergunta curta para esclarecer>"}',
  'quando a instrução é ambígua ou incompleta;',
  '{"tipo":"pergunta"}',
  'quando for só uma pergunta ou conversa que não é instrução.',
  'Não invente fatos, valores ou prazos que o administrador não disse.',
].join(' ');

export function montarWorkflow() {
  const nodes = [
    { id: id(1), name: 'Execute Workflow Trigger', type: 'n8n-nodes-base.executeWorkflowTrigger', typeVersion: 1.1, position: [0, 300],
      parameters: { inputSource: 'workflowInputs', workflowInputs: { values: ['phone', 'message', 'messageId', 'phoneNumberId'].map((name) => ({ name, type: 'string' })) } } },
    { id: id(2), name: 'Registrar Comando', type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [220, 300], credentials: PG,
      parameters: { operation: 'executeQuery', query: 'select mayara.registrar_comando($1, $2, $3) as novo',
        options: { queryReplacement: '={{ [$json.messageId, $json.phone, $json.message] }}' } } },
    { id: id(3), name: 'Novo?', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [440, 300],
      parameters: { conditions: { options: OPCOES_IF, conditions: [{ id: 'novo', leftValue: '={{ $json.novo === true }}', rightValue: true,
        operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' }, options: {} } },
    { id: id(4), name: 'Duplicado', type: 'n8n-nodes-base.noOp', typeVersion: 1, position: [660, 460], parameters: {} },
    { id: id(5), name: 'Contexto', type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [660, 300], credentials: PG,
      parameters: { operation: 'executeQuery', query: 'select mayara.contexto_central($1) as ctx',
        options: { queryReplacement: "={{ [$('Execute Workflow Trigger').first().json.phone] }}" } } },
    { id: id(6), name: 'Classificar', type: 'n8n-nodes-base.code', typeVersion: 2, position: [880, 300],
      parameters: { jsCode: corpoNode(RODAPE_CLASSIFICAR) } },
    { id: id(7), name: 'Roteador', type: 'n8n-nodes-base.switch', typeVersion: 3.2, position: [1100, 300],
      parameters: { rules: { values: ['sql', 'texto', 'modo', 'status', 'livre'].map(regra) }, options: {} } },
    { id: id(8), name: 'Executar SQL', type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [1400, 40], credentials: PG, onError: 'continueErrorOutput',
      parameters: { operation: 'executeQuery', query: 'select mayara.executar_central($1, $2, $3, $4) as resposta',
        options: { queryReplacement: "={{ [$json.fn, $json.arg || '', $json.arg2 || '', $('Classificar').first().json.phone] }}" } } },
    { id: id(9), name: 'Atualizar Modo', type: 'n8n-nodes-base.dataTable', typeVersion: 1.1, position: [1400, 400],
      parameters: { operation: 'update', dataTableId: TABELA, filters: FILTRO_GLOBAL,
        columns: { mappingMode: 'defineBelow',
          value: { controlKey: 'global', aiMode: "={{ $('Classificar').first().json.aiMode }}", updatedBy: 'central-comando', reason: 'Comando pelo WhatsApp' },
          matchingColumns: [],
          schema: ['controlKey', 'aiMode', 'updatedBy', 'reason'].map((k) => ({ id: k, displayName: k, required: false, defaultMatch: false, display: true, type: 'string', readOnly: false, removed: false })),
          attemptToConvertTypes: false, convertFieldsToString: false },
        options: {} } },
    { id: id(10), name: 'Resposta Modo', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1620, 400],
      parameters: { jsCode: "const c = $('Classificar').first().json;\nconst texto = c.aiMode === 'active'\n  ? 'Mayara ligada. Ela volta a responder os leads agora.'\n  : 'Mayara desligada. Os leads recebem o aviso de pausa e a equipe atende. Atenção: cada mensagem de lead durante a pausa cria uma Task no CRM.';\nreturn [{ json: { resposta: texto } }];" } },
    { id: id(11), name: 'Ler Modo', type: 'n8n-nodes-base.dataTable', typeVersion: 1.1, position: [1400, 560],
      parameters: { operation: 'get', dataTableId: TABELA, filters: FILTRO_GLOBAL } },
    { id: id(12), name: 'Status SQL', type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [1620, 560], credentials: PG,
      parameters: { operation: 'executeQuery', query: "select mayara.executar_central('status', '', '', '') as resposta" } },
    { id: id(13), name: 'Compor Status', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1840, 560],
      parameters: { jsCode: "const modo = $('Ler Modo').first().json.aiMode === 'active' ? 'ligada' : 'desligada';\nreturn [{ json: { resposta: 'Mayara: ' + modo + '\\n' + $input.first().json.resposta } }];" } },
    { id: id(14), name: 'Interpretar Instrucao', type: '@n8n/n8n-nodes-langchain.chainLlm', typeVersion: 1.9, position: [1400, 760], onError: 'continueErrorOutput',
      parameters: { promptType: 'define', text: '={{ ' + JSON.stringify(PROMPT_IA + ' Mensagem do administrador: ') + " + $('Classificar').first().json.texto }}" } },
    { id: id(15), name: 'Modelo Anthropic', type: '@n8n/n8n-nodes-langchain.lmChatAnthropic', typeVersion: 1.3, position: [1400, 960], credentials: ANTHROPIC,
      parameters: { model: { __rl: true, mode: 'list', value: 'claude-sonnet-4-5-20250929', cachedResultName: 'Claude Sonnet 4.5' }, options: { temperature: 0 } } },
    { id: id(16), name: 'Validar Ensino', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1720, 760],
      parameters: { jsCode: corpoNode(RODAPE_VALIDAR) } },
    { id: id(17), name: 'E SQL?', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [1940, 760], parameters: igual('={{ $json.tipo }}', 'sql') },
    { id: id(18), name: 'Falha', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1940, 160],
      parameters: { jsCode: "return [{ json: { resposta: 'Não consegui executar agora. Nada foi alterado.' } }];" } },
    { id: id(19), name: 'Finalizar', type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [2200, 300], credentials: PG,
      parameters: { operation: 'executeQuery', query: 'select mayara.finalizar_comando($1, $2, $3) as resposta',
        options: { queryReplacement: "={{ [$('Classificar').first().json.messageId, $('Classificar').first().json.acao, $json.resposta] }}" } } },
    { id: id(20), name: 'Responder', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4, position: [2420, 300], credentials: BEARER, onError: 'continueRegularOutput',
      parameters: { method: 'POST', url: "=https://graph.facebook.com/v25.0/{{ $('Classificar').first().json.phoneNumberId }}/messages",
        authentication: 'genericCredentialType', genericAuthType: 'httpBearerAuth', sendBody: true, specifyBody: 'json',
        jsonBody: "={{ ({ messaging_product: 'whatsapp', to: $('Classificar').first().json.phone.replace(/\\D/g, ''), type: 'text', text: { body: $json.resposta } }) }}",
        options: { timeout: 25000 } } },
  ];

  const ligar = (...destinos) => ({ main: [destinos.map((node) => ({ node, type: 'main', index: 0 }))] });
  const connections = {
    'Execute Workflow Trigger': ligar('Registrar Comando'),
    'Registrar Comando': ligar('Novo?'),
    'Novo?': { main: [[{ node: 'Contexto', type: 'main', index: 0 }], [{ node: 'Duplicado', type: 'main', index: 0 }]] },
    'Contexto': ligar('Classificar'),
    'Classificar': ligar('Roteador'),
    'Roteador': { main: [
      [{ node: 'Executar SQL', type: 'main', index: 0 }],
      [{ node: 'Finalizar', type: 'main', index: 0 }],
      [{ node: 'Atualizar Modo', type: 'main', index: 0 }],
      [{ node: 'Ler Modo', type: 'main', index: 0 }],
      [{ node: 'Interpretar Instrucao', type: 'main', index: 0 }],
    ] },
    'Executar SQL': { main: [[{ node: 'Finalizar', type: 'main', index: 0 }], [{ node: 'Falha', type: 'main', index: 0 }]] },
    'Atualizar Modo': ligar('Resposta Modo'),
    'Resposta Modo': ligar('Finalizar'),
    'Ler Modo': ligar('Status SQL'),
    'Status SQL': ligar('Compor Status'),
    'Compor Status': ligar('Finalizar'),
    'Interpretar Instrucao': { main: [[{ node: 'Validar Ensino', type: 'main', index: 0 }], [{ node: 'Falha', type: 'main', index: 0 }]] },
    'Modelo Anthropic': { ai_languageModel: [[{ node: 'Interpretar Instrucao', type: 'ai_languageModel', index: 0 }]] },
    'Validar Ensino': ligar('E SQL?'),
    'E SQL?': { main: [[{ node: 'Executar SQL', type: 'main', index: 0 }], [{ node: 'Finalizar', type: 'main', index: 0 }]] },
    'Falha': ligar('Responder'),
    'Finalizar': ligar('Responder'),
  };

  return {
    name: 'Mayara — Central de Comando',
    nodes,
    connections,
    settings: { executionOrder: 'v1', errorWorkflow: 'CQyjBKLX0UheNh1q', callerPolicy: 'workflowsFromSameOwner' },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const destino = join(dirname(fileURLToPath(import.meta.url)), '..', 'workflows', 'mayara-central-de-comando.json');
  writeFileSync(destino, JSON.stringify(montarWorkflow(), null, 2));
  console.log('gravado', destino);
}
