// docs/superpowers/specs/2026-10-17-abordagem-automatica/gerar-workflow.mjs
// Gera o workflow "Mayara — Abordagem: Liberar Automática [Worker]" no mesmo padrão dos workflows de blindagem do canal.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PG = { postgres: { id: 'nNpCUIhnDuVvTApU', name: 'Postgres account' } };
const ID = (n) => `ac000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const ifBool = (id, nome, expr, pos) => ({
  id: ID(id), name: nome, type: 'n8n-nodes-base.if', typeVersion: 2.2, position: pos,
  parameters: {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
      conditions: [{ id: ID(id) + '-c', leftValue: expr, rightValue: true, operator: { type: 'boolean', operation: 'true', singleValue: true } }],
      combinator: 'and',
    },
    options: {},
  },
});

const campo = (id) => ({ id, displayName: id, required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true });

export function montarWorkflow() {
  const nodes = [
    { id: ID(1), name: 'Agendar', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, position: [0, 300],
      parameters: { rule: { interval: [{ field: 'minutes', minutesInterval: 2 }] } } },
    { id: ID(2), name: 'Próximo', type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [220, 300], executeOnce: true,
      parameters: { operation: 'executeQuery', query: 'select mayara.abordagem_auto_proximo(now()) as r', options: {} }, credentials: PG },
    ifBool(3, 'Enviar?', '={{ $json.r.enviar === true }}', [440, 300]),
    { id: ID(4), name: 'Enviar Primeiro Contato', type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.3, position: [660, 200],
      onError: 'continueRegularOutput',
      parameters: {
        workflowId: { __rl: true, value: 'SHLZkNqfbCrs2OSQ', mode: 'list', cachedResultName: 'Mayara — Canal: Enviar [Sub-workflow]' },
        options: { waitForSubWorkflow: true },
        workflowInputs: {
          mappingMode: 'defineBelow', matchingColumns: [], attemptToConvertTypes: false, convertFieldsToString: true,
          value: {
            canalId: 'escritorio', para: '={{ $json.r.destino }}', tipo: 'texto', texto: '={{ $json.r.texto }}',
            templateNome: '', templateVariaveis: '', identificarMayara: 'true', origem: 'abordagem_automatica',
          },
          schema: ['canalId', 'para', 'tipo', 'texto', 'templateNome', 'templateVariaveis', 'identificarMayara', 'origem'].map(campo),
        },
      } },
    { id: ID(5), name: 'Montar Resultado', type: 'n8n-nodes-base.code', typeVersion: 2, position: [880, 200],
      parameters: { jsCode: [
        "const prox = $('Próximo').first().json.r;",
        'const saida = $input.first().json || {};',
        'const ok = saida.ok === true;',
        "const erro = ok ? '' : String((saida.error && saida.error.message) || saida.message || 'falha_no_envio').slice(0, 200);",
        'return [{ json: { id: prox.proposta_id, ok, erro } }];',
      ].join('\n') } },
    { id: ID(6), name: 'Registrar', type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [1100, 200],
      parameters: { operation: 'executeQuery', query: 'select mayara.abordagem_auto_registrar($1::bigint, $2::boolean, $3) as r',
        options: { queryReplacement: '={{ [$json.id, $json.ok, $json.erro] }}' } }, credentials: PG },
    ifBool(7, 'Pausada?', '={{ $json.r.pausada === true }}', [1320, 200]),
    { id: ID(8), name: 'Montar Alerta', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1540, 120],
      parameters: { jsCode: "return [{ json: { texto: 'Atenção: a liberação automática de atendimento foi desligada depois de 3 falhas de envio seguidas. Confira o canal e ligue de novo com /abordagem automatica ligar.' } }];" } },
    { id: ID(9), name: 'Alertar Escritório', type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.3, position: [1760, 120],
      onError: 'continueRegularOutput',
      parameters: {
        workflowId: { __rl: true, value: 'FWSC1k1CBMWBtsNs', mode: 'list', cachedResultName: 'Mayara — Alertar Escritório [Sub-workflow]' },
        workflowInputs: { mappingMode: 'defineBelow', matchingColumns: [], attemptToConvertTypes: false, convertFieldsToString: true,
          value: { texto: '={{ $json.texto }}' }, schema: [campo('texto')] },
        options: { waitForSubWorkflow: false },
      } },
  ];
  const lig = (...para) => ({ main: [para.map((node) => ({ node, type: 'main', index: 0 }))] });
  const connections = {
    Agendar: lig('Próximo'),
    Próximo: lig('Enviar?'),
    'Enviar?': { main: [[{ node: 'Enviar Primeiro Contato', type: 'main', index: 0 }], []] },
    'Enviar Primeiro Contato': lig('Montar Resultado'),
    'Montar Resultado': lig('Registrar'),
    Registrar: lig('Pausada?'),
    'Pausada?': { main: [[{ node: 'Montar Alerta', type: 'main', index: 0 }], []] },
    'Montar Alerta': lig('Alertar Escritório'),
  };
  return {
    name: 'Mayara — Abordagem: Liberar Automática [Worker]',
    nodes, connections,
    settings: { executionOrder: 'v1', errorWorkflow: 'CQyjBKLX0UheNh1q' },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = dirname(fileURLToPath(import.meta.url));
  writeFileSync(join(dir, 'workflow.json'), JSON.stringify(montarWorkflow(), null, 2));
  console.log('workflow.json gerado');
}
