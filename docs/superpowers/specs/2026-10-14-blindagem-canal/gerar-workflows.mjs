// gerar-workflows.mjs: monta os workflows Canal: Vigia, Canal: Recuperar e Canal: Alertar Fora do WhatsApp (JSON do n8n).
// Uso: node gerar-workflows.mjs --idProcessar <id> [--credEmail <id>:<nome>] [--idAlertar <id>] [--idRecuperar <id>]
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { corpoVigia, corpoJanela, corpoLote, corpoTextoAlerta } from './gerar-nodes.mjs';

const dir = dirname(fileURLToPath(import.meta.url));
const EVO = 'https://evolution.camparimadvogados.com.br';
const CRED_EVO = { httpHeaderAuth: { id: 'vA1UKEhHVqwcLGWW', name: 'Evolution API' } };
const CRED_PG = { postgres: { id: 'nNpCUIhnDuVvTApU', name: 'Postgres account' } };
const CRED_CRM = { httpHeaderAuth: { id: '3CNvCGWMMDOyGD2n', name: 'EspoCRM Integração n8n — Mayara' } };
const ERRO = 'CQyjBKLX0UheNh1q';
const SETTINGS = { executionOrder: 'v1', errorWorkflow: ERRO };
const OPCOES_IF = { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 };
const id = (p, n) => `${p}000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const campo = (nome) => ({ id: nome, displayName: nome, required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true });

const pg = (nid, nome, pos, query, repl, extra = {}) => ({
  id: nid, name: nome, type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: pos, credentials: CRED_PG,
  parameters: { operation: 'executeQuery', query, options: repl ? { queryReplacement: repl } : {} }, ...extra,
});
const codigo = (nid, nome, pos, js, extra = {}) => ({ id: nid, name: nome, type: 'n8n-nodes-base.code', typeVersion: 2, position: pos, parameters: { jsCode: js }, ...extra });
const se = (nid, nome, pos, esquerda, valor = true, extra = {}) => ({
  id: nid, name: nome, type: 'n8n-nodes-base.if', typeVersion: 2.2, position: pos,
  parameters: { conditions: { options: OPCOES_IF, conditions: [{ id: nid + '-c', leftValue: esquerda, rightValue: valor, operator: { type: 'boolean', operation: valor ? 'true' : 'false', singleValue: true } }], combinator: 'and' }, options: {} }, ...extra,
});
const regra = (saida, esquerda) => ({
  conditions: { options: OPCOES_IF, conditions: [{ id: 'r-' + saida, leftValue: esquerda, rightValue: saida, operator: { type: 'string', operation: 'equals' } }], combinator: 'and' },
  renameOutput: true, outputKey: saida,
});
const troca = (nid, nome, pos, esquerda, saidas) => ({
  id: nid, name: nome, type: 'n8n-nodes-base.switch', typeVersion: 3.2, position: pos,
  parameters: { rules: { values: saidas.map((s) => regra(s, esquerda)) }, options: {} },
});
const http = (nid, nome, pos, metodo, url, extra = {}, parametros = {}) => ({
  id: nid, name: nome, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: pos, credentials: CRED_EVO,
  parameters: { method: metodo, url, authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth', ...parametros },
  ...extra,
});
const sub = (nid, nome, pos, workflowId, valores, extra = {}) => ({
  id: nid, name: nome, type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.3, position: pos,
  parameters: { workflowId: { __rl: true, value: workflowId, mode: 'list' }, options: { waitForSubWorkflow: true },
    workflowInputs: { mappingMode: 'defineBelow', value: valores, matchingColumns: [], schema: Object.keys(valores).map(campo), attemptToConvertTypes: false, convertFieldsToString: true } },
  ...extra,
});
const lig = (...saidas) => ({ main: saidas.map((s) => s.map((node) => ({ node, type: 'main', index: 0 }))) });

export function montarVigia(idAlertar, idRecuperar) {
  const nodes = [
    { id: id('ca', 1), name: 'Agendar', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, position: [0, 300],
      parameters: { rule: { interval: [{ field: 'minutes', minutesInterval: 2 }] } } },
    http(id('ca', 2), 'Estado Real', [220, 300], 'GET', EVO + '/instance/connectionState/escritorio', { onError: 'continueRegularOutput' }, { options: { timeout: 10000 } }),
    codigo(id('ca', 3), 'Normalizar Leitura', [440, 300], corpoVigia),
    pg(id('ca', 4), 'Registrar Leitura', [660, 300], "select mayara.leitura_canal('escritorio', $1) as r", '={{ [$json.estado] }}'),
    troca(id('ca', 5), 'Acao', [880, 300], '={{ $json.r.acao }}', ['reiniciar', 'alertar', 'lembrar', 'recuperar']),
    http(id('ca', 6), 'Reiniciar Instancia', [1120, 120], 'PUT', EVO + '/instance/restart/escritorio', { onError: 'continueRegularOutput' }, { options: { timeout: 20000 } }),
    codigo(id('ca', 7), 'Texto do Alerta', [1120, 320], corpoTextoAlerta),
    sub(id('ca', 8), 'Alertar Fora do WhatsApp', [1360, 320], idAlertar,
      { assunto: '={{ $json.assunto }}', texto: '={{ $json.texto }}', criarTarefa: "={{ String($('Registrar Leitura').first().json.r.acao === 'alertar') }}" }, { onError: 'continueRegularOutput' }),
    sub(id('ca', 9), 'Recuperar', [1120, 520], idRecuperar,
      { desde: "={{ $('Registrar Leitura').first().json.r.desde }}", simular: 'false' }, { onError: 'continueRegularOutput' }),
  ];
  const connections = {
    Agendar: lig(['Estado Real']),
    'Estado Real': lig(['Normalizar Leitura']),
    'Normalizar Leitura': lig(['Registrar Leitura']),
    'Registrar Leitura': lig(['Acao']),
    Acao: lig(['Reiniciar Instancia'], ['Texto do Alerta'], ['Texto do Alerta'], ['Recuperar']),
    'Texto do Alerta': lig(['Alertar Fora do WhatsApp']),
  };
  return { name: 'Mayara — Canal: Vigia', nodes, connections, settings: SETTINGS };
}

export function montarRecuperar(parametrosProcessar) {
  const nodes = [
    { id: id('cb', 1), name: 'Execute Workflow Trigger', type: 'n8n-nodes-base.executeWorkflowTrigger', typeVersion: 1.1, position: [0, 300],
      parameters: { inputSource: 'workflowInputs', workflowInputs: { values: [{ name: 'desde', type: 'string' }, { name: 'simular', type: 'string' }] } } },
    codigo(id('cb', 2), 'Janela', [220, 300], corpoJanela),
    http(id('cb', 3), 'Buscar', [440, 300], 'POST', EVO + '/chat/findMessages/escritorio', { onError: 'continueRegularOutput' },
      { sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify($json.corpo) }}', options: { timeout: 30000 } }),
    codigo(id('cb', 4), 'Lote', [660, 300], corpoLote),
    { id: id('cb', 5), name: 'Cada Mensagem', type: 'n8n-nodes-base.splitInBatches', typeVersion: 3, position: [880, 300], parameters: { batchSize: 1, options: {} } },
    se(id('cb', 6), 'Util?', [1100, 400], "={{ $json.fim === false && ['processar', 'humano'].includes($json.norm.acao) }}"),
    pg(id('cb', 7), 'Marcar Vista', [1320, 400],
      "={{ $json.simular === 'true' ? 'select not mayara.mensagem_ja_vista($1, $2) as novo, $3::text as direcao' : \"select mayara.marcar_mensagem_vista($1, $2, $3, 'recuperacao') as novo\" }}",
      "={{ ['escritorio', $json.messageId, $json.norm.acao === 'humano' ? 'saida_humana' : 'entrada'] }}"),
    codigo(id('cb', 8), 'Juntar', [1540, 400], "return [{ json: { ...$('Util?').item.json, novo: $json.novo === true } }];"),
    se(id('cb', 9), 'Novo?', [1760, 400], '={{ $json.novo === true }}'),
    se(id('cb', 10), 'Simular?', [1980, 400], "={{ $json.simular === 'true' }}"),
    troca(id('cb', 11), 'Tipo', [2200, 400], '={{ $json.norm.acao }}', ['humano', 'processar']),
    pg(id('cb', 12), 'Tratar Humano', [2440, 300], 'select mayara.tratar_mensagem_humana($1, $2, $3, $4, $5::timestamptz) as r',
      '={{ [$json.norm.canalId, $json.norm.phone, $json.norm.messageId, $json.norm.texto, $json.norm.timestamp] }}', { onError: 'continueRegularOutput' }),
    pg(id('cb', 13), 'Registrar Aceito', [2440, 500],
      "select mayara.registrar_evento_canal($1, $2, $3, nullif($4, ''), nullif($5, ''), nullif($6, ''), nullif($7, '')::int, nullif($8, '')::boolean)",
      "={{ ['escritorio', 'evolution', 'aceito', 'recuperacao', $json.norm.evento.phone, $json.norm.evento.messageType, String($json.norm.evento.message.length), String($json.norm.evento.requiresHuman)] }}",
      { onError: 'continueRegularOutput' }),
    codigo(id('cb', 14), 'Preparar Evento', [2660, 500], "return [{ json: $('Juntar').item.json.norm.evento }];"),
    { id: id('cb', 15), name: 'Processar Evento', type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.3, position: [2880, 500], onError: 'continueRegularOutput', parameters: parametrosProcessar },
    se(id('cb', 16), 'Concluir?', [1100, 160], "={{ $('Janela').first().json.simular !== 'true' }}", true, { executeOnce: true }),
    pg(id('cb', 17), 'Concluir', [1320, 160], "select mayara.concluir_recuperacao('escritorio', $1::timestamptz)",
      "={{ [$('Janela').first().json.ateIso] }}", { executeOnce: true }),
  ];
  const connections = {
    'Execute Workflow Trigger': lig(['Janela']),
    Janela: lig(['Buscar']),
    Buscar: lig(['Lote']),
    Lote: lig(['Cada Mensagem']),
    'Cada Mensagem': lig(['Concluir?'], ['Util?']),
    'Concluir?': lig(['Concluir']),
    'Util?': lig(['Marcar Vista'], ['Cada Mensagem']),
    'Marcar Vista': lig(['Juntar']),
    Juntar: lig(['Novo?']),
    'Novo?': lig(['Simular?'], ['Cada Mensagem']),
    'Simular?': lig(['Cada Mensagem'], ['Tipo']),
    Tipo: lig(['Tratar Humano'], ['Registrar Aceito']),
    'Tratar Humano': lig(['Cada Mensagem']),
    'Registrar Aceito': lig(['Preparar Evento']),
    'Preparar Evento': lig(['Processar Evento']),
    'Processar Evento': lig(['Cada Mensagem']),
  };
  return { name: 'Mayara — Canal: Recuperar [Sub-workflow]', nodes, connections, settings: SETTINGS };
}

export function montarAlertarFora(credEmail) {
  const entrada = "$('Execute Workflow Trigger').first().json";
  const gmail = {
    id: id('cc', 3), name: 'Enviar E-mail', type: 'n8n-nodes-base.gmail', typeVersion: 2.1, position: [440, 300], onError: 'continueRegularOutput',
    parameters: { resource: 'message', operation: 'send', sendTo: '={{ $json.valor }}', subject: `={{ ${entrada}.assunto }}`, emailType: 'text', message: `={{ ${entrada}.texto }}`, options: {} },
  };
  if (credEmail) gmail.credentials = { gmailOAuth2: { id: credEmail.id, name: credEmail.name } };
  else gmail.disabled = true;
  const nodes = [
    { id: id('cc', 1), name: 'Execute Workflow Trigger', type: 'n8n-nodes-base.executeWorkflowTrigger', typeVersion: 1.1, position: [0, 300],
      parameters: { inputSource: 'workflowInputs', workflowInputs: { values: [{ name: 'assunto', type: 'string' }, { name: 'texto', type: 'string' }, { name: 'criarTarefa', type: 'string' }] } } },
    pg(id('cc', 2), 'Destino', [220, 300], "select valor from mayara.config where chave = 'alerta_email_destino'"),
    gmail,
    se(id('cc', 4), 'Tarefa?', [660, 300], `={{ ${entrada}.criarTarefa === 'true' }}`),
    { id: id('cc', 5), name: 'Criar Tarefa no CRM', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4, position: [880, 300], credentials: CRED_CRM, onError: 'continueRegularOutput',
      parameters: { method: 'POST', url: 'https://crm.camparimadvogados.com.br/api/v1/Task', authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth', sendBody: true, specifyBody: 'json',
        jsonBody: `={{ ({ name: ${entrada}.assunto, status: 'Not Started', priority: 'High', dateStart: $now.toUTC().toFormat('yyyy-MM-dd HH:mm:ss'), assignedUserId: '6a899b5713e9849fa', description: ${entrada}.texto, cAlertOrigin: 'WhatsApp', cAlertSeverity: 'Alta', cAlertKey: 'WHATSAPP_LINHA_CAIDA_V1:escritorio:' + $now.toUTC().toFormat('yyyyMMddHHmm'), cSourceEntityType: 'WhatsAppMessage', cSourceRecordId: 'escritorio', cDetectedAt: $now.toUTC().toFormat('yyyy-MM-dd HH:mm:ss'), cAlertRule: 'WHATSAPP_LINHA_CAIDA_V1' }) }}`,
        options: { timeout: 20000 } } },
  ];
  const connections = {
    'Execute Workflow Trigger': lig(['Destino']),
    Destino: lig(['Enviar E-mail']),
    'Enviar E-mail': lig(['Tarefa?']),
    'Tarefa?': lig(['Criar Tarefa no CRM']),
  };
  return { name: 'Mayara — Canal: Alertar Fora do WhatsApp [Sub-workflow]', nodes, connections, settings: SETTINGS };
}

function arg(nome) {
  const i = process.argv.indexOf('--' + nome);
  return i >= 0 ? process.argv[i + 1] : null;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const saida = join(dir, '..', 'workflows');
  const cred = arg('credEmail');
  const credEmail = cred ? { id: cred.split(':')[0], name: cred.split(':').slice(1).join(':') || 'Gmail account' } : null;
  if (!credEmail) console.warn('AVISO: sem --credEmail, o no de e-mail sai desabilitado.');
  writeFileSync(join(saida, 'mayara-canal-alertar-fora.json'), JSON.stringify(montarAlertarFora(credEmail), null, 2));
  const receptor = JSON.parse(readFileSync(join(saida, 'mayara-canal-receber-evolution.json'), 'utf8'));
  const base = receptor.nodes.find((n) => n.name === 'Processar Evento').parameters;
  const idProcessar = arg('idProcessar');
  if (idProcessar) {
    const parametros = JSON.parse(JSON.stringify(base));
    parametros.workflowId.value = idProcessar;
    writeFileSync(join(saida, 'mayara-canal-recuperar.json'), JSON.stringify(montarRecuperar(parametros), null, 2));
  }
  if (arg('idAlertar') && arg('idRecuperar')) {
    writeFileSync(join(saida, 'mayara-canal-vigia.json'), JSON.stringify(montarVigia(arg('idAlertar'), arg('idRecuperar')), null, 2));
  }
  console.log('workflows gerados em ' + saida);
}
