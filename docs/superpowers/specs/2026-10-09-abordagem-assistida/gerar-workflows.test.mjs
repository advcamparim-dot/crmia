// gerar-workflows.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { montarPropor, montarNotificar } from './gerar-workflows.mjs';

function verificar(wf) {
  const nomes = wf.nodes.map((n) => n.name);
  assert.equal(new Set(nomes).size, nomes.length, 'nomes de nos duplicados');
  assert.equal(new Set(wf.nodes.map((n) => n.id)).size, wf.nodes.length, 'ids duplicados');
  for (const [origem, saidas] of Object.entries(wf.connections)) {
    assert.ok(nomes.includes(origem), 'origem inexistente: ' + origem);
    for (const porta of Object.values(saidas)) for (const lista of porta) for (const lig of lista) assert.ok(nomes.includes(lig.node), 'destino inexistente: ' + lig.node);
  }
  for (const n of wf.nodes) if (n.type === 'n8n-nodes-base.postgres') assert.equal(n.credentials.postgres.id, 'nNpCUIhnDuVvTApU');
  assert.equal(wf.settings.errorWorkflow, 'CQyjBKLX0UheNh1q');
}

test('Propor: estrutura valida, chave ligada antes de qualquer proposta, redigir embutido', () => {
  const wf = montarPropor();
  verificar(wf);
  assert.equal(wf.name, 'Mayara — Abordagem: Propor [Sub-workflow]');
  const tipos = wf.nodes.map((n) => n.type);
  assert.ok(tipos.includes('n8n-nodes-base.executeWorkflowTrigger'));
  assert.equal(wf.nodes.some((n) => n.type === 'n8n-nodes-base.scheduleTrigger'), false);
  const redigir = wf.nodes.find((n) => n.name === 'Redigir');
  assert.match(redigir.parameters.jsCode, /function resolverRascunho/);
  assert.equal(/^\s*(import|export)\s/m.test(redigir.parameters.jsCode), false, 'sem import/export no Code node');
  assert.deepEqual(wf.connections['Execute Workflow Trigger'].main[0].map((l) => l.node), ['Chave Ligada']);
  assert.deepEqual(wf.connections['Ligada?'].main[0].map((l) => l.node), ['Preparar Entrada']);
  assert.equal(wf.connections['Ligada?'].main[1].length, 0, 'chave desligada: nao faz nada');
  const criar = wf.nodes.find((n) => n.name === 'Criar Proposta');
  assert.match(criar.parameters.query, /mayara\.criar_proposta/);
  assert.equal(criar.onError, 'continueErrorOutput');
});

test('Notificar: agendado a cada minuto, so reserva com chave ligada e administrador ativo, e libera quando o envio falha', () => {
  const wf = montarNotificar();
  verificar(wf);
  assert.equal(wf.name, 'Mayara — Abordagem: Notificar');
  const gatilho = wf.nodes.find((n) => n.type === 'n8n-nodes-base.scheduleTrigger');
  assert.deepEqual(gatilho.parameters.rule.interval[0], { field: 'minutes', minutesInterval: 1 });
  const chave = wf.nodes.find((n) => n.name === 'Chave Ligada');
  assert.match(chave.parameters.query, /abordagem_assistida/);
  assert.match(chave.parameters.query, /mayara\.administradores/);
  const reservar = wf.nodes.find((n) => n.name === 'Reservar');
  assert.match(reservar.parameters.query, /reservar_notificacoes\(\)/);
  assert.match(reservar.parameters.query, /cross join/);
  const enviar = wf.nodes.find((n) => n.name === 'Enviar Notificacao');
  assert.equal(enviar.parameters.workflowId.value, 'SHLZkNqfbCrs2OSQ');
  assert.equal(enviar.parameters.workflowInputs.value.origem, 'abordagem_notificacao');
  assert.equal(enviar.parameters.workflowInputs.value.identificarMayara, 'false');
  assert.equal(enviar.onError, 'continueRegularOutput');
  const liberar = wf.nodes.find((n) => n.name === 'Liberar Reserva');
  assert.match(liberar.parameters.query, /liberar_notificacao/);
});

test('Notificar: a mensagem da proposta traz o texto exato e as tres respostas possiveis', () => {
  const wf = montarNotificar();
  const montar = wf.nodes.find((n) => n.name === 'Montar Mensagem').parameters.jsCode;
  const itens = [
    { json: { id: 12, tipo: 'nova', nome: 'Cristina', texto: 'Boa tarde, Cristina. Aqui é a Mayara. Com qual banco é esse contrato?', telefone_fim: '3126', admin: '+5514997022609' } },
    { json: { id: 12, tipo: 'lembrete', nome: 'Cristina', texto: 'x', telefone_fim: '3126', admin: '+5514997022609' } },
  ];
  const saida = new Function('$input', montar)({ all: () => itens });
  assert.match(saida[0].json.texto, /Novo lead: Cristina \(final 3126\)/);
  assert.match(saida[0].json.texto, /Boa tarde, Cristina\. Aqui é a Mayara\. Com qual banco é esse contrato\?/);
  assert.match(saida[0].json.texto, /\*sim 12\*/);
  assert.match(saida[0].json.texto, /\*não 12\*/);
  assert.match(saida[0].json.texto, /\*editar 12: novo texto\*/);
  assert.match(saida[1].json.texto, /^Lembrete: a proposta #12/);
  assert.equal(saida[0].json.admin, '+5514997022609');
});
