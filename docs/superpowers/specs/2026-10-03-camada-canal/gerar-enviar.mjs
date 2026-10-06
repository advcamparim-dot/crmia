// gerar-enviar.mjs: gera o JSON do workflow "Mayara - Canal: Enviar".
// Uso: node gerar-enviar.mjs  (grava docs/superpowers/specs/workflows/mayara-canal-enviar.json)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const PG = { postgres: { id: 'nNpCUIhnDuVvTApU', name: 'Postgres account' } };
const BEARER = { httpBearerAuth: { id: 'SChAKcHay4ghJVwe', name: 'Bearer Auth account' } };
const EVO = { httpHeaderAuth: { id: 'vA1UKEhHVqwcLGWW', name: 'Evolution API' } };
const OPCOES_IF = { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 };
const id = (n) => `c9000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export function corpoLib() {
  return readFileSync(join(dir, 'canal.mjs'), 'utf8').replace(/^export\s+/gm, '');
}

export const RODAPE_PREPARAR = `
const v = validarPedido($input.first().json);
if (!v.ok) return [{ json: { valido: false, resultado: { ok: false, error: { message: v.erro } } } }];
return [{ json: { valido: true, pedido: v.pedido } }];
`;

export const RODAPE_CORPO_META = `
const p = $('Decidir').first().json.pedido;
return [{ json: { pedido: p, corpo: montarCorpoMeta(p) } }];
`;

export const RODAPE_INTERPRETAR = `
const p = $('Corpo Meta').first().json.pedido;
return [{ json: { pedido: p, resultado: interpretarRespostaMeta($input.first().json) } }];
`;

export const RODAPE_CORPO_EVOLUTION = `
const p = $('Decidir').first().json.pedido;
const corpoTemplate = $input.first().json.corpo;
try {
  return [{ json: { pedido: p, evo: montarEvolution(p, corpoTemplate) } }];
} catch (e) {
  return [{ json: { pedido: p, resultado: { ok: false, error: { message: String(e && e.message ? e.message : e) } } } }];
}
`;

export const RODAPE_INTERPRETAR_EVOLUTION = `
const p = $('Corpo Evolution').first().json.pedido;
return [{ json: { pedido: p, resultado: interpretarRespostaEvolution($input.first().json) } }];
`;

export function corpoNode(rodape) {
  return corpoLib() + '\n' + rodape;
}

const regra = (valor) => ({
  conditions: { options: OPCOES_IF, conditions: [{ id: 'r-' + valor, leftValue: '={{ $json.rota }}', rightValue: valor,
    operator: { type: 'string', operation: 'equals' } }], combinator: 'and' },
  renameOutput: true, outputKey: valor,
});

export function montarWorkflow() {
  const nodes = [
    { id: id(1), name: 'Execute Workflow Trigger', type: 'n8n-nodes-base.executeWorkflowTrigger', typeVersion: 1.1, position: [0, 300],
      parameters: { inputSource: 'workflowInputs', workflowInputs: { values: ['canalId', 'para', 'tipo', 'texto', 'templateNome', 'templateVariaveis', 'identificarMayara', 'origem'].map((name) => ({ name, type: 'string' })) } } },
    { id: id(2), name: 'Preparar', type: 'n8n-nodes-base.code', typeVersion: 2, position: [220, 300], parameters: { jsCode: corpoNode(RODAPE_PREPARAR) } },
    { id: id(3), name: 'Valido?', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [440, 300],
      parameters: { conditions: { options: OPCOES_IF, conditions: [{ id: 'valido', leftValue: '={{ $json.valido === true }}', rightValue: true,
        operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' }, options: {} } },
    { id: id(4), name: 'Retorno Invalido', type: 'n8n-nodes-base.code', typeVersion: 2, position: [660, 460],
      parameters: { jsCode: 'return [{ json: $input.first().json.resultado }];' } },
    { id: id(5), name: 'Pode Enviar', type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [660, 300], credentials: PG,
      parameters: { operation: 'executeQuery', query: 'select mayara.pode_enviar($1, $2, $3) as r',
        options: { queryReplacement: '={{ [$json.pedido.canalId, $json.pedido.para, $json.pedido.tipo] }}' } } },
    { id: id(6), name: 'Decidir', type: 'n8n-nodes-base.code', typeVersion: 2, position: [880, 300],
      parameters: { jsCode: "const r = $input.first().json.r;\nconst p = $('Preparar').first().json.pedido;\nif (!r || r.ok !== true) return [{ json: { rota: 'negado', pedido: p, resultado: { ok: false, error: { message: (r && r.motivo) || 'sem_resposta_da_politica' } } } }];\nreturn [{ json: { rota: r.provedor, pedido: p } }];" } },
    { id: id(7), name: 'Roteador', type: 'n8n-nodes-base.switch', typeVersion: 3.2, position: [1100, 300],
      parameters: { rules: { values: ['meta', 'evolution', 'negado'].map(regra) }, options: {} } },
    { id: id(8), name: 'Corpo Meta', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1320, 140], parameters: { jsCode: corpoNode(RODAPE_CORPO_META) } },
    { id: id(9), name: 'Enviar Meta', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4, position: [1540, 140], credentials: BEARER, onError: 'continueRegularOutput',
      parameters: { method: 'POST', url: '=https://graph.facebook.com/v25.0/{{ $json.pedido.canalId }}/messages',
        authentication: 'genericCredentialType', genericAuthType: 'httpBearerAuth', sendBody: true, specifyBody: 'json',
        jsonBody: '={{ JSON.stringify($json.corpo) }}', options: { timeout: 25000 } } },
    { id: id(10), name: 'Interpretar Meta', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1760, 140], parameters: { jsCode: corpoNode(RODAPE_INTERPRETAR) } },
    { id: id(11), name: 'Texto do Template', type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [1320, 300], credentials: PG,
      parameters: { operation: 'executeQuery', query: 'select (select corpo from mayara.canal_templates where nome = $1) as corpo',
        options: { queryReplacement: '={{ [$json.pedido.templateNome || \'\'] }}' } } },
    { id: id(14), name: 'Corpo Evolution', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1540, 300], parameters: { jsCode: corpoNode(RODAPE_CORPO_EVOLUTION) } },
    { id: id(15), name: 'Evolution Pronto?', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [1760, 300],
      parameters: { conditions: { options: OPCOES_IF, conditions: [{ id: 'evo-pronto', leftValue: '={{ $json.evo !== undefined }}', rightValue: true,
        operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' }, options: {} } },
    { id: id(16), name: 'Enviar Evolution', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4, position: [1980, 240], credentials: EVO, onError: 'continueRegularOutput',
      parameters: { method: 'POST', url: "={{ 'https://evolution.camparimadvogados.com.br' + $json.evo.caminho }}",
        authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth', sendBody: true, specifyBody: 'json',
        jsonBody: '={{ JSON.stringify($json.evo.corpo) }}', options: { timeout: 30000 } } },
    { id: id(17), name: 'Interpretar Evolution', type: 'n8n-nodes-base.code', typeVersion: 2, position: [2200, 240], parameters: { jsCode: corpoNode(RODAPE_INTERPRETAR_EVOLUTION) } },
    { id: id(12), name: 'Registrar Envio', type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [2420, 300], credentials: PG,
      parameters: { operation: 'executeQuery', query: 'select mayara.registrar_envio($1, $2, $3, $4::jsonb) as r',
        options: { queryReplacement: '={{ [$json.pedido.canalId, $json.pedido.para, $json.pedido.tipo, JSON.stringify($json.resultado)] }}' } } },
    { id: id(13), name: 'Retorno', type: 'n8n-nodes-base.code', typeVersion: 2, position: [2640, 300],
      parameters: { jsCode: 'return [{ json: $input.first().json.r }];' } },
  ];
  const ligar = (...destinos) => ({ main: [destinos.map((node) => ({ node, type: 'main', index: 0 }))] });
  const connections = {
    'Execute Workflow Trigger': ligar('Preparar'),
    'Preparar': ligar('Valido?'),
    'Valido?': { main: [[{ node: 'Pode Enviar', type: 'main', index: 0 }], [{ node: 'Retorno Invalido', type: 'main', index: 0 }]] },
    'Pode Enviar': ligar('Decidir'),
    'Decidir': ligar('Roteador'),
    'Roteador': { main: [
      [{ node: 'Corpo Meta', type: 'main', index: 0 }],
      [{ node: 'Texto do Template', type: 'main', index: 0 }],
      [{ node: 'Registrar Envio', type: 'main', index: 0 }],
    ] },
    'Corpo Meta': ligar('Enviar Meta'),
    'Enviar Meta': ligar('Interpretar Meta'),
    'Interpretar Meta': ligar('Registrar Envio'),
    'Texto do Template': ligar('Corpo Evolution'),
    'Corpo Evolution': ligar('Evolution Pronto?'),
    'Evolution Pronto?': { main: [[{ node: 'Enviar Evolution', type: 'main', index: 0 }], [{ node: 'Registrar Envio', type: 'main', index: 0 }]] },
    'Enviar Evolution': ligar('Interpretar Evolution'),
    'Interpretar Evolution': ligar('Registrar Envio'),
    'Registrar Envio': ligar('Retorno'),
  };
  return {
    name: 'Mayara — Canal: Enviar [Sub-workflow]',
    nodes, connections,
    settings: { executionOrder: 'v1', errorWorkflow: 'CQyjBKLX0UheNh1q', callerPolicy: 'workflowsFromSameOwner' },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const destino = join(dir, '..', 'workflows', 'mayara-canal-enviar.json');
  writeFileSync(destino, JSON.stringify(montarWorkflow(), null, 2));
  console.log('gravado', destino);
}
