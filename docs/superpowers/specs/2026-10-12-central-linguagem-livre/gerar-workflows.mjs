// gerar-workflows.mjs: monta o sub-workflow "Central: Interpretar Livre" (JSON do n8n).
// Uso: node gerar-workflows.mjs  (grava em docs/superpowers/specs/workflows/)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const ERRO = 'CQyjBKLX0UheNh1q';
const id = (n) => `c1000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export function montarInterpretarLivre() {
  const pedido = readFileSync(join(dir, 'pedido-livre.node.js'), 'utf8')
    .replace("$('Classificar').first().json.texto", "$('Execute Workflow Trigger').first().json.texto");
  const interpretar = readFileSync(join(dir, 'interpretar.node.js'), 'utf8');
  const nodes = [
    { id: id(1), name: 'Execute Workflow Trigger', type: 'n8n-nodes-base.executeWorkflowTrigger', typeVersion: 1.1, position: [0, 300],
      parameters: { inputSource: 'workflowInputs', workflowInputs: { values: [{ name: 'texto', type: 'string' }] } } },
    { id: id(2), name: 'Pedido Livre', type: 'n8n-nodes-base.code', typeVersion: 2, position: [240, 300], parameters: { jsCode: pedido } },
    { id: id(3), name: 'Interpretar IA', type: '@n8n/n8n-nodes-langchain.chainLlm', typeVersion: 1.9, position: [480, 300], onError: 'continueRegularOutput',
      parameters: { promptType: 'define', text: '={{ $json.prompt }}' } },
    { id: id(4), name: 'Modelo Anthropic', type: '@n8n/n8n-nodes-langchain.lmChatAnthropic', typeVersion: 1.3, position: [480, 520],
      credentials: { anthropicApi: { id: '6U02h1ioNpD09Q99', name: 'Anthropic account 2' } },
      parameters: { model: { __rl: true, mode: 'list', value: 'claude-sonnet-4-5-20250929', cachedResultName: 'Claude Sonnet 4.5' }, options: { temperature: 0 } } },
    { id: id(5), name: 'Interpretar', type: 'n8n-nodes-base.code', typeVersion: 2, position: [720, 300], parameters: { jsCode: interpretar } },
  ];
  const connections = {
    'Execute Workflow Trigger': { main: [[{ node: 'Pedido Livre', type: 'main', index: 0 }]] },
    'Pedido Livre': { main: [[{ node: 'Interpretar IA', type: 'main', index: 0 }]] },
    'Interpretar IA': { main: [[{ node: 'Interpretar', type: 'main', index: 0 }]] },
    'Modelo Anthropic': { ai_languageModel: [[{ node: 'Interpretar IA', type: 'ai_languageModel', index: 0 }]] },
  };
  return { name: 'Mayara — Central: Interpretar Livre [Sub-workflow]', nodes, connections, settings: { executionOrder: 'v1', errorWorkflow: ERRO } };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const saida = join(dir, '..', 'workflows', 'mayara-central-interpretar-livre.json');
  writeFileSync(saida, JSON.stringify(montarInterpretarLivre(), null, 2));
  console.log('gravado: ' + saida);
}
