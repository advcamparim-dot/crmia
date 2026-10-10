// gerar-central-patch.mjs: gera as operacoes incrementais para a Central ao vivo e o novo codigo do no Classificar.
// Uso: node gerar-central-patch.mjs
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { corpoNode, RODAPE_CLASSIFICAR } from '../2026-10-03-central-comando/gerar-node.mjs';

const dir = dirname(fileURLToPath(import.meta.url));
const PG = { postgres: { id: 'nNpCUIhnDuVvTApU', name: 'Postgres account' } };
const CRM = { httpHeaderAuth: { id: '3CNvCGWMMDOyGD2n', name: 'EspoCRM Integração n8n — Mayara' } };
const CANAL_ENVIAR = { __rl: true, value: 'SHLZkNqfbCrs2OSQ', mode: 'list', cachedResultName: 'Mayara — Canal: Enviar [Sub-workflow]' };
const OPCOES_IF = { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 };
const nid = (n) => `c9000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const campo = (nome) => ({ id: nome, displayName: nome, required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true });
const regra = (valor) => ({
  conditions: { options: OPCOES_IF, conditions: [{ id: 'r-' + valor, leftValue: '={{ $json.tipo }}', rightValue: valor, operator: { type: 'string', operation: 'equals' } }], combinator: 'and' },
  renameOutput: true, outputKey: valor,
});
const se = (n, nome, pos, esquerda) => ({ id: nid(n), name: nome, type: 'n8n-nodes-base.if', typeVersion: 2.2, position: pos,
  parameters: { conditions: { options: OPCOES_IF, conditions: [{ id: 'p' + n, leftValue: esquerda, rightValue: true, operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' }, options: {} } });

export const classificarJs = corpoNode(RODAPE_CLASSIFICAR);
const D = "$('Decidir Proposta').first().json.d";
const novosNos = [
  { id: nid(1), name: 'Decidir Proposta', type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [1400, 1160], credentials: PG, onError: 'continueErrorOutput',
    parameters: { operation: 'executeQuery', query: 'select mayara.decidir_proposta($1, $2::bigint, $3, $4) as d',
      options: { queryReplacement: "={{ [$json.op, $json.id || null, $json.texto || '', $json.phone] }}" } } },
  se(2, 'Enviar?', [1620, 1160], "={{ $json.d.acao === 'enviar' }}"),
  { id: nid(3), name: 'Resposta Proposta', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1840, 1260], parameters: { jsCode: 'return [{ json: { resposta: $json.d.resposta } }];' } },
  { id: nid(4), name: 'Enviar Primeiro Contato', type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.3, position: [1840, 1060], onError: 'continueRegularOutput',
    parameters: { workflowId: CANAL_ENVIAR, options: { waitForSubWorkflow: true },
      workflowInputs: { mappingMode: 'defineBelow', matchingColumns: [], attemptToConvertTypes: false, convertFieldsToString: true,
        value: { canalId: 'escritorio', para: '={{ $json.d.destino }}', tipo: 'texto', texto: '={{ $json.d.texto }}', templateNome: '', templateVariaveis: '', identificarMayara: 'true', origem: 'abordagem_assistida' },
        schema: ['canalId', 'para', 'tipo', 'texto', 'templateNome', 'templateVariaveis', 'identificarMayara', 'origem'].map(campo) } } },
  { id: nid(5), name: 'Casar Envio', type: 'n8n-nodes-base.code', typeVersion: 2, position: [2060, 1060],
    parameters: { jsCode: `const d = ${D};\nconst r = $input.first().json;\nconst ok = r.ok === true;\nconst erro = ok ? '' : String((r.error && r.error.message) || r.message || 'falha_no_envio').slice(0, 200);\nreturn [{ json: { id: d.id, ok, erro, crmLeadId: d.crm_lead_id || '', nome: d.nome || '' } }];` } },
  { id: nid(6), name: 'Confirmar Envio', type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [2280, 1160], credentials: PG,
    parameters: { operation: 'executeQuery', query: 'select mayara.finalizar_envio_proposta($1::bigint, $2::boolean, $3) as resposta',
      options: { queryReplacement: '={{ [$json.id, $json.ok, $json.erro] }}' } } },
  se(7, 'Enviado?', [2280, 960], "={{ $json.ok === true && $json.crmLeadId !== '' }}"),
  { id: nid(8), name: 'Atualizar CRM', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4, position: [2500, 960], credentials: CRM, onError: 'continueRegularOutput',
    parameters: { method: 'PUT', url: "=https://crm.camparimadvogados.com.br/api/v1/Lead/{{ $json.crmLeadId }}", authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
      sendBody: true, specifyBody: 'json', jsonBody: "={{ ({ cFirstResponseAt: new Date().toISOString().slice(0, 19).replace('T', ' ') }) }}", options: { timeout: 30000 } } },
  { id: nid(9), name: 'Nota no CRM', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4, position: [2720, 960], credentials: CRM, onError: 'continueRegularOutput',
    parameters: { method: 'POST', url: 'https://crm.camparimadvogados.com.br/api/v1/Note', authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
      sendBody: true, specifyBody: 'json', jsonBody: "={{ ({ parentType: 'Lead', parentId: $('Casar Envio').first().json.crmLeadId, type: 'Post', post: 'Primeiro contato enviado pela Mayara (abordagem assistida).' }) }}", options: { timeout: 30000 } } },
];

const ligacoes = [
  ['Roteador', 'Decidir Proposta', { sourceIndex: 5 }],
  ['Decidir Proposta', 'Enviar?', { sourceIndex: 0 }],
  ['Decidir Proposta', 'Falha', { sourceIndex: 1 }],
  ['Enviar?', 'Enviar Primeiro Contato', { branch: 'true' }],
  ['Enviar?', 'Resposta Proposta', { branch: 'false' }],
  ['Resposta Proposta', 'Finalizar', {}],
  ['Enviar Primeiro Contato', 'Casar Envio', {}],
  ['Casar Envio', 'Confirmar Envio', {}],
  ['Casar Envio', 'Enviado?', {}],
  ['Confirmar Envio', 'Finalizar', {}],
  ['Enviado?', 'Atualizar CRM', { branch: 'true' }],
  ['Atualizar CRM', 'Nota no CRM', {}],
];

export function operacoes() {
  const regras = ['sql', 'texto', 'modo', 'status', 'livre', 'proposta'].map(regra);
  return [
    { type: 'updateNode', nodeName: 'Roteador', updates: { 'parameters.rules.values': regras } },
    ...novosNos.map((node) => ({ type: 'addNode', node })),
    ...ligacoes.map(([source, target, extra]) => ({ type: 'addConnection', source, target, ...extra })),
  ];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(join(dir, 'classificar.node.js'), classificarJs);
  writeFileSync(join(dir, 'central-patch.json'), JSON.stringify(operacoes(), null, 2));
  console.log('classificar.node.js (' + classificarJs.length + ' caracteres) e central-patch.json (' + operacoes().length + ' operacoes)');
}
