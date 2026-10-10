// gerar-workflows.mjs: monta os workflows "Abordagem: Propor" e "Abordagem: Notificar" (JSON do n8n).
// Uso: node gerar-workflows.mjs  (grava em docs/superpowers/specs/workflows/)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const PG = { postgres: { id: 'nNpCUIhnDuVvTApU', name: 'Postgres account' } };
const CANAL_ENVIAR = { __rl: true, value: 'SHLZkNqfbCrs2OSQ', mode: 'list', cachedResultName: 'Mayara — Canal: Enviar [Sub-workflow]' };
const ALERTAR = { __rl: true, value: 'FWSC1k1CBMWBtsNs', mode: 'list', cachedResultName: 'Mayara — Alertar Escritório [Sub-workflow]' };
const ERRO = 'CQyjBKLX0UheNh1q';
const id = (prefixo, n) => `${prefixo}000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const campo = (nome) => ({ id: nome, displayName: nome, required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true });
const entradaCanal = (valores) => ({ mappingMode: 'defineBelow', value: valores, matchingColumns: [], schema: Object.keys(valores).map(campo), attemptToConvertTypes: false, convertFieldsToString: true });
const pg = (nid, nome, pos, query, repl, extra = {}) => ({
  id: nid, name: nome, type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: pos, credentials: PG,
  parameters: { operation: 'executeQuery', query, options: repl ? { queryReplacement: repl } : {} }, ...extra,
});
const codigo = (nid, nome, pos, js) => ({ id: nid, name: nome, type: 'n8n-nodes-base.code', typeVersion: 2, position: pos, parameters: { jsCode: js } });
const se = (nid, nome, pos, esquerda) => ({
  id: nid, name: nome, type: 'n8n-nodes-base.if', typeVersion: 2.2, position: pos,
  parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
    conditions: [{ id: nid + '-c', leftValue: esquerda, rightValue: true, operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' }, options: {} },
});
const sub = (nid, nome, pos, workflowId, valores, extra = {}) => ({
  id: nid, name: nome, type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.3, position: pos,
  parameters: { workflowId, workflowInputs: entradaCanal(valores), options: { waitForSubWorkflow: true } }, ...extra,
});
const lig = (...destinos) => ({ main: [destinos.map((node) => ({ node, type: 'main', index: 0 }))] });

const CHAVE = "select (valor = 'true') as ligada from mayara.config where chave = 'abordagem_assistida'";

export function montarPropor() {
  const redigir = readFileSync(join(dir, 'redigir.node.js'), 'utf8');
  const entrada = "$('Preparar Entrada').first().json";
  const nodes = [
    { id: id('ab', 1), name: 'Execute Workflow Trigger', type: 'n8n-nodes-base.executeWorkflowTrigger', typeVersion: 1.1, position: [0, 300], parameters: { inputSource: 'passthrough' } },
    pg(id('ab', 2), 'Chave Ligada', [220, 300], CHAVE),
    se(id('ab', 3), 'Ligada?', [440, 300], '={{ $json.ligada === true }}'),
    codigo(id('ab', 4), 'Preparar Entrada', [660, 200], "const e = $('Execute Workflow Trigger').first().json;\nreturn [{ json: { lead: e.lead || {}, crmLeadId: e.crmLeadId || '' } }];"),
    codigo(id('ab', 5), 'Redigir', [880, 200], redigir),
    pg(id('ab', 6), 'Criar Proposta', [1100, 200], 'select mayara.criar_proposta($1, $2, $3, $4, $5::jsonb, $6) as r',
      `={{ [ ${entrada}.lead.telefone || '', ${entrada}.lead.nome || '', ${entrada}.crmLeadId, $json.texto, JSON.stringify($json.fatos), $json.lacuna.codigo ] }}`,
      { onError: 'continueErrorOutput' }),
    codigo(id('ab', 7), 'Montar Alerta', [1320, 360], `const l = ${entrada}.lead;\nconst tel = String(l.telefone || '');\nreturn [{ json: { texto: 'Atenção: não consegui preparar a proposta de abordagem do lead ' + (l.nome || 'sem nome') + ' (final ' + tel.slice(-4) + '). Contate manualmente.' } }];`),
    sub(id('ab', 8), 'Alertar Escritório', [1540, 360], ALERTAR, { texto: '={{ $json.texto }}' }, { onError: 'continueRegularOutput' }),
  ];
  nodes[7].parameters.options.waitForSubWorkflow = false;
  const connections = {
    'Execute Workflow Trigger': lig('Chave Ligada'),
    'Chave Ligada': lig('Ligada?'),
    'Ligada?': { main: [[{ node: 'Preparar Entrada', type: 'main', index: 0 }], []] },
    'Preparar Entrada': lig('Redigir'),
    Redigir: lig('Criar Proposta'),
    'Criar Proposta': { main: [[], [{ node: 'Montar Alerta', type: 'main', index: 0 }]] },
    'Montar Alerta': lig('Alertar Escritório'),
  };
  return { name: 'Mayara — Abordagem: Propor [Sub-workflow]', nodes, connections, settings: { executionOrder: 'v1', errorWorkflow: ERRO, callerPolicy: 'workflowsFromSameOwner' } };
}

const MONTAR_MENSAGEM = `const linhas = $input.all().map((i) => i.json);
return linhas.map((r) => {
  const nome = r.nome || 'Sem nome';
  const texto = r.tipo === 'lembrete'
    ? 'Lembrete: a proposta #' + r.id + ' (' + nome + ', final ' + r.telefone_fim + ') ainda aguarda sua resposta.\\n\\nResponda *sim ' + r.id + '* para enviar ou *não ' + r.id + '* para descartar.'
    : 'Novo lead: ' + nome + ' (final ' + r.telefone_fim + ').\\n\\nA Mayara propõe enviar:\\n\\n' + r.texto + '\\n\\nResponda *sim ' + r.id + '* para enviar, *não ' + r.id + '* para descartar ou *editar ' + r.id + ': novo texto* para trocar a mensagem.';
  return { json: { id: r.id, tipo: r.tipo, admin: r.admin, texto } };
});`;

export function montarNotificar() {
  const nodes = [
    { id: id('ac', 1), name: 'A Cada Minuto', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, position: [0, 300], parameters: { rule: { interval: [{ field: 'minutes', minutesInterval: 1 }] } } },
    pg(id('ac', 2), 'Chave Ligada', [220, 300],
      "select (valor = 'true' and exists (select 1 from mayara.administradores where ativo)) as ligada from mayara.config where chave = 'abordagem_assistida'"),
    se(id('ac', 3), 'Ligada?', [440, 300], '={{ $json.ligada === true }}'),
    pg(id('ac', 4), 'Reservar', [660, 300],
      'select r.id, r.tipo, r.nome, r.texto, r.telefone_fim, a.telefone as admin from mayara.reservar_notificacoes() r cross join (select telefone from mayara.administradores where ativo) a'),
    codigo(id('ac', 5), 'Montar Mensagem', [880, 300], MONTAR_MENSAGEM),
    sub(id('ac', 6), 'Enviar Notificacao', [1100, 300], CANAL_ENVIAR, {
      canalId: 'escritorio', para: '={{ $json.admin }}', tipo: 'texto', texto: '={{ $json.texto }}',
      templateNome: '', templateVariaveis: '', identificarMayara: 'false', origem: 'abordagem_notificacao',
    }, { onError: 'continueRegularOutput' }),
    codigo(id('ac', 7), 'Casar Retorno', [1320, 300],
      "const montados = $('Montar Mensagem').all();\nreturn $input.all().map((it, i) => ({ json: { id: montados[i].json.id, tipo: montados[i].json.tipo, falhou: it.json.ok !== true } }));"),
    se(id('ac', 8), 'Falhou?', [1540, 300], '={{ $json.falhou === true }}'),
    pg(id('ac', 9), 'Liberar Reserva', [1760, 200], 'select mayara.liberar_notificacao($1::bigint, $2)', '={{ [$json.id, $json.tipo] }}', { onError: 'continueRegularOutput' }),
  ];
  const connections = {
    'A Cada Minuto': lig('Chave Ligada'),
    'Chave Ligada': lig('Ligada?'),
    'Ligada?': { main: [[{ node: 'Reservar', type: 'main', index: 0 }], []] },
    Reservar: lig('Montar Mensagem'),
    'Montar Mensagem': lig('Enviar Notificacao'),
    'Enviar Notificacao': lig('Casar Retorno'),
    'Casar Retorno': lig('Falhou?'),
    'Falhou?': { main: [[{ node: 'Liberar Reserva', type: 'main', index: 0 }], []] },
  };
  return { name: 'Mayara — Abordagem: Notificar', nodes, connections, settings: { executionOrder: 'v1', errorWorkflow: ERRO } };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const saida = join(dir, '..', 'workflows');
  writeFileSync(join(saida, 'mayara-abordagem-propor.json'), JSON.stringify(montarPropor(), null, 2));
  writeFileSync(join(saida, 'mayara-abordagem-notificar.json'), JSON.stringify(montarNotificar(), null, 2));
  console.log('workflows gerados em', saida);
}
