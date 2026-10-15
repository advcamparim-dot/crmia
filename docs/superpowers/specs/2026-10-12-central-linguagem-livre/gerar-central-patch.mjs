// gerar-central-patch.mjs: operacoes incrementais para a Central ao vivo (ramo livre + @efeito).
// Uso: node gerar-central-patch.mjs <id-do-sub-workflow>
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const OPCOES_IF = { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 };
const nid = (n) => `c9100000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const campo = (nome) => ({ id: nome, displayName: nome, required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true });
const regra = (saida, esquerda, direita) => ({
  conditions: { options: OPCOES_IF, conditions: [{ id: 'r-' + saida, leftValue: esquerda, rightValue: direita, operator: { type: 'string', operation: 'equals' } }], combinator: 'and' },
  renameOutput: true, outputKey: saida,
});
const se = (n, nome, pos, esquerda) => ({ id: nid(n), name: nome, type: 'n8n-nodes-base.if', typeVersion: 2.2, position: pos,
  parameters: { conditions: { options: OPCOES_IF, conditions: [{ id: 'p' + n, leftValue: esquerda, rightValue: true, operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' }, options: {} } });
const codigo = (n, nome, pos, js) => ({ id: nid(n), name: nome, type: 'n8n-nodes-base.code', typeVersion: 2, position: pos, parameters: { jsCode: js } });

const LER_EFEITO = [
  "const bruto = String($input.first().json.resposta || '');",
  "const falha = { aiMode: '', resposta: 'Não consegui aplicar o efeito. Nada foi alterado.', erro: true };",
  "if (!bruto.startsWith('@efeito ')) return [{ json: falha }];",
  "const quebra = bruto.indexOf('\\n');",
  'const cabeca = bruto.slice(8, quebra < 0 ? bruto.length : quebra);',
  "const texto = quebra < 0 ? '' : bruto.slice(quebra + 1).trim();",
  'let o;',
  'try { o = JSON.parse(cabeca); } catch (e) { return [{ json: falha }]; }',
  "if (!o || o.tipo !== 'modo' || !['active', 'paused'].includes(o.aiMode)) return [{ json: falha }];",
  'return [{ json: { aiMode: o.aiMode, resposta: texto, erro: false } }];',
].join('\n');

export function operacoes(subId) {
  const novos = [
    se(1, 'Livre Ligado?', [1180, 1500], "={{ $('Contexto').first().json.ctx.livre === true }}"),
    { id: nid(2), name: 'Interpretar Livre', type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.3, position: [1400, 1420], onError: 'continueRegularOutput',
      parameters: { workflowId: { __rl: true, value: subId, mode: 'list', cachedResultName: 'Mayara — Central: Interpretar Livre [Sub-workflow]' }, options: { waitForSubWorkflow: true },
        workflowInputs: { mappingMode: 'defineBelow', matchingColumns: [], attemptToConvertTypes: false, convertFieldsToString: true,
          value: { texto: "={{ $('Classificar').first().json.texto }}" }, schema: [campo('texto')] } } },
    { id: nid(3), name: 'Saída Livre', type: 'n8n-nodes-base.switch', typeVersion: 3.2, position: [1620, 1420],
      parameters: { rules: { values: [
        regra('status', '={{ $json.acao }}', 'livre_status'),
        regra('sql', '={{ $json.tipo }}', 'sql'),
        regra('texto', '={{ $json.tipo }}', 'texto'),
        regra('ensinar', '={{ $json.tipo }}', 'ensinar'),
      ] }, options: { fallbackOutput: 'extra' } } },
    codigo(4, 'Ensino do Livre', [1840, 1620], "return [{ json: { text: JSON.stringify({ tipo: 'instrucao', regra: $json.regra }) } }];"),
    se(5, 'Efeito?', [1100, 40], "={{ String($json.resposta || '').startsWith('@efeito ') }}"),
    codigo(6, 'Ler Efeito', [1320, -60], LER_EFEITO),
    se(7, 'Efeito Valido?', [1540, -60], '={{ $json.erro === false }}'),
    { id: nid(8), name: 'Atualizar Modo Livre', type: 'n8n-nodes-base.dataTable', typeVersion: 1.1, position: [1760, -140],
      parameters: { operation: 'update', dataTableId: { __rl: true, value: '8zkrH8xVko73LXAd', mode: 'list', cachedResultName: 'Mayara Control' },
        filters: { conditions: [{ keyName: 'controlKey', keyValue: 'global' }] },
        columns: { mappingMode: 'defineBelow', value: { controlKey: 'global', aiMode: '={{ $json.aiMode }}', updatedBy: 'central-comando', reason: 'Comando em linguagem livre' },
          matchingColumns: [], schema: ['controlKey', 'aiMode', 'updatedBy', 'reason'].map(campo), attemptToConvertTypes: false, convertFieldsToString: false }, options: {} } },
    codigo(9, 'Texto do Efeito', [1980, -60], [
      "const e = $('Ler Efeito').first().json;",
      "const aviso = e.aiMode === 'paused' ? ' Os leads recebem o aviso de pausa e a equipe atende. Atenção: cada mensagem de lead durante a pausa cria uma Task no CRM.' : '';",
      'return [{ json: { resposta: e.erro ? e.resposta : (e.resposta + aviso).trim() } }];',
    ].join('\n')),
  ];
  const ligacoes = [
    ['Roteador', 'Livre Ligado?', { sourceIndex: 4 }],
    ['Livre Ligado?', 'Interpretar Livre', { branch: 'true' }],
    ['Livre Ligado?', 'Interpretar Instrucao', { branch: 'false' }],
    ['Interpretar Livre', 'Saída Livre', {}],
    ['Saída Livre', 'Ler Modo', { sourceIndex: 0 }],
    ['Saída Livre', 'Executar SQL', { sourceIndex: 1 }],
    ['Saída Livre', 'Finalizar', { sourceIndex: 2 }],
    ['Saída Livre', 'Ensino do Livre', { sourceIndex: 3 }],
    ['Saída Livre', 'Falha', { sourceIndex: 4 }],
    ['Ensino do Livre', 'Validar Ensino', {}],
    ['Executar SQL', 'Efeito?', { sourceIndex: 0 }],
    ['Efeito?', 'Ler Efeito', { branch: 'true' }],
    ['Efeito?', 'Finalizar', { branch: 'false' }],
    ['Ler Efeito', 'Efeito Valido?', {}],
    ['Efeito Valido?', 'Atualizar Modo Livre', { branch: 'true' }],
    ['Efeito Valido?', 'Texto do Efeito', { branch: 'false' }],
    ['Atualizar Modo Livre', 'Texto do Efeito', {}],
    ['Texto do Efeito', 'Finalizar', {}],
  ];
  return [
    ...novos.map((node) => ({ type: 'addNode', node })),
    { type: 'removeConnection', source: 'Roteador', target: 'Interpretar Instrucao', sourceIndex: 4 },
    { type: 'removeConnection', source: 'Executar SQL', target: 'Finalizar', sourceIndex: 0 },
    ...ligacoes.map(([source, target, extra]) => ({ type: 'addConnection', source, target, ...extra })),
  ];
}

// No ramo livre o Finalizar gravava no log de comandos a acao 'ensino' (a do Classificar) para qualquer pedido.
// Passa a gravar a acao interpretada (livre_assumir, livre_pausar...), ou livre_erro se o modelo falhou.
export function operacoesLog() {
  return [{
    type: 'updateNode', nodeName: 'Finalizar',
    updates: {
      'parameters.options.queryReplacement':
        "={{ [$('Classificar').first().json.messageId, ($('Interpretar Livre').isExecuted ? ($('Interpretar Livre').first().json.acao || 'livre_erro') : $('Classificar').first().json.acao), $json.resposta] }}",
    },
  }];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const sub = process.argv[2];
  if (!sub) { console.error('Uso: node gerar-central-patch.mjs <id-do-sub-workflow>'); process.exit(1); }
  writeFileSync(join(dir, 'central-livre-patch.json'), JSON.stringify(operacoes(sub), null, 2));
  writeFileSync(join(dir, 'central-livre-log-patch.json'), JSON.stringify(operacoesLog(), null, 2));
  console.log('central-livre-patch.json (' + operacoes(sub).length + ' operacoes)');
}
