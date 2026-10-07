// gerar-workflow.mjs: monta o JSON do sub-workflow "Lead do Grupo da Agencia" a partir de lead-grupo.mjs (codigo testado).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const GRUPO_JID = '120363429995424499@g.us';
const lib = readFileSync(join(dir, 'lead-grupo.mjs'), 'utf8').replace(/^export\s+/gm, '');

const CRED = { httpHeaderAuth: { id: '3CNvCGWMMDOyGD2n', name: 'EspoCRM Integração n8n — Mayara' } };
const ALERTAR = { __rl: true, value: 'FWSC1k1CBMWBtsNs', mode: 'list', cachedResultName: 'Mayara — Alertar Escritório [Sub-workflow]' };
const cond = (id, esquerda) => ({ options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 }, conditions: [{ id, leftValue: esquerda, rightValue: true, operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' });
const se = (id, nome, pos, esquerda) => ({ id, name: nome, type: 'n8n-nodes-base.if', typeVersion: 2.2, position: pos, parameters: { conditions: cond(id + '-c', esquerda), options: {} } });
const alerta = (id, nome, pos) => ({ id, name: nome, type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.3, position: pos, onError: 'continueRegularOutput', parameters: { workflowId: ALERTAR, workflowInputs: { mappingMode: 'defineBelow', value: { texto: '={{ $json.texto }}' }, matchingColumns: [], schema: [{ id: 'texto', displayName: 'texto', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }], attemptToConvertTypes: false, convertFieldsToString: true }, options: { waitForSubWorkflow: false } } });
const codigo = (id, nome, pos, js) => ({ id, name: nome, type: 'n8n-nodes-base.code', typeVersion: 2, position: pos, parameters: { jsCode: js } });

const nodes = [
  { id: 'f4000000-0000-4000-8000-000000000001', name: 'Execute Workflow Trigger', type: 'n8n-nodes-base.executeWorkflowTrigger', typeVersion: 1.1, position: [0, 300], parameters: { inputSource: 'passthrough' } },
  codigo('f4000000-0000-4000-8000-000000000002', 'Decidir', [220, 300], lib + `\nconst GRUPO_JID = '${GRUPO_JID}';\nreturn [{ json: decidirAcao($input.first().json, GRUPO_JID) }];\n`),
  se('f4000000-0000-4000-8000-000000000003', 'Criar?', [440, 300], "={{ $json.acao === 'criar' }}"),
  se('f4000000-0000-4000-8000-000000000004', 'Alertar?', [660, 480], "={{ $json.acao === 'alertar' }}"),
  codigo('f4000000-0000-4000-8000-000000000005', 'Montar Alerta Ilegivel', [880, 480], "const d = $input.first().json;\nreturn [{ json: { texto: 'Atenção: um cartão de lead no grupo da agência não pôde ser lido (motivo: ' + d.motivo + '). Confira o grupo e lance o lead manualmente no CRM.' } }];"),
  { id: 'f4000000-0000-4000-8000-000000000006', name: 'Buscar no CRM', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4, position: [660, 180], credentials: CRED, parameters: { method: 'GET', url: "=https://crm.camparimadvogados.com.br/api/v1/Lead?where[0][type]=equals&where[0][attribute]=phoneNumber&where[0][value]={{ encodeURIComponent($('Decidir').first().json.lead.telefone) }}&select=id&maxSize=1", authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth', options: { timeout: 30000 } } },
  codigo('f4000000-0000-4000-8000-000000000007', 'Montar Lead', [880, 180], "const l = $('Decidir').first().json.lead;\nconst r = $input.first().json;\nconst partes = String(l.nome || '').trim().split(/\\s+/).filter(Boolean);\nconst quando = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });\nconst linhas = [\n  'Lead do grupo da agencia, cartao de ' + quando,\n  'Campanha: ' + (l.campanha || ''),\n  'Onde esta a divida: ' + (l.ondeDivida || ''),\n  'Valor da divida: ' + (l.valorDivida || ''),\n  'Situacao: ' + (l.situacao || ''),\n  'Tipo: ' + (l.tipo || ''),\n];\nreturn [{ json: { telefone: l.telefone, firstName: partes[0] || 'Lead', lastName: partes.slice(1).join(' '), description: linhas.join('\\n'), existe: Number(r.total || 0) > 0 } }];"),
  se('f4000000-0000-4000-8000-000000000008', 'Ja Existe?', [1100, 180], '={{ $json.existe === true }}'),
  { id: 'f4000000-0000-4000-8000-000000000009', name: 'Criar Lead', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4, position: [1320, 300], onError: 'continueRegularOutput', credentials: CRED, parameters: { method: 'POST', url: 'https://crm.camparimadvogados.com.br/api/v1/Lead', authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth', sendBody: true, specifyBody: 'json', jsonBody: "={{ ({ firstName: $json.firstName, lastName: $json.lastName, phoneNumber: $json.telefone, description: $json.description, assignedUserId: '6a899d5f8a2b61a29' }) }}", options: { timeout: 30000 } } },
  se('f4000000-0000-4000-8000-000000000010', 'Criou?', [1540, 300], '={{ Boolean($json.id) }}'),
  codigo('f4000000-0000-4000-8000-000000000011', 'Montar Alerta Falha', [1760, 420], "const tel = String($('Montar Lead').first().json.telefone || '');\nreturn [{ json: { texto: 'Atenção: não consegui criar no CRM um lead do grupo da agência (final do telefone ' + tel.slice(-4) + '). Lance manualmente.' } }];"),
  alerta('f4000000-0000-4000-8000-000000000012', 'Alertar Escritório', [2000, 450]),
];
const lig = (...d) => ({ main: [d.map((x) => ({ node: x, type: 'main', index: 0 }))] });
const connections = {
  'Execute Workflow Trigger': lig('Decidir'),
  Decidir: lig('Criar?'),
  'Criar?': { main: [[{ node: 'Buscar no CRM', type: 'main', index: 0 }], [{ node: 'Alertar?', type: 'main', index: 0 }]] },
  'Alertar?': { main: [[{ node: 'Montar Alerta Ilegivel', type: 'main', index: 0 }], []] },
  'Montar Alerta Ilegivel': lig('Alertar Escritório'),
  'Buscar no CRM': lig('Montar Lead'),
  'Montar Lead': lig('Ja Existe?'),
  'Ja Existe?': { main: [[], [{ node: 'Criar Lead', type: 'main', index: 0 }]] },
  'Criar Lead': lig('Criou?'),
  'Criou?': { main: [[], [{ node: 'Montar Alerta Falha', type: 'main', index: 0 }]] },
  'Montar Alerta Falha': lig('Alertar Escritório'),
};
const wf = { name: 'Mayara — Lead do Grupo da Agência [Sub-workflow]', nodes, connections, settings: { executionOrder: 'v1', errorWorkflow: 'CQyjBKLX0UheNh1q', callerPolicy: 'workflowsFromSameOwner' } };
writeFileSync(join(dir, '..', 'workflows', 'mayara-lead-grupo-agencia.json'), JSON.stringify(wf, null, 2) + '\n');
console.log(nodes.length, 'nos;', Object.keys(connections).length, 'origens');
