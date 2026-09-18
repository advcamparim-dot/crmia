# Mayara V3 — Motor de Raciocínio do Núcleo (Fase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer a Mayara raciocinar por lacuna de decisão (o que falta saber pra decidir o próximo passo) em vez de seguir um roteiro de qualificação fixo, sem mudar a arquitetura do workflow nem os nomes de estágio já em produção.

**Architecture:** Um novo node de código determinístico (`Calcular Lacunas`) calcula o que já é fato e qual a lacuna prioritária a partir do `fatosJson`, injeta isso como texto no prompt via `Montar Contexto`; o prompt do `AI Agent` é reescrito para usar essa lacuna como guia (nunca calculando sozinho), reforçar STOP QUALIFICATION, adicionar a regra FATO≠INFERÊNCIA e "não agende cedo demais". Tudo dentro da mesma chamada única de LLM já existente — nenhum node novo de LLM, nenhuma mudança nos 8 estágios (`S0_NOVO`...`S7_HANDOFF_HUMANO`).

**Tech Stack:** n8n (via `mcp__n8n-mcp__*` tools), Node.js 24 (`node:test` para testar a lógica determinística isoladamente antes de colar no Code node), Postgres (schema `mayara`, inalterado nesta fase).

**Spec:** `docs/superpowers/specs/2026-09-18-mayara-v3-motor-raciocinio-design.md`

## Global Constraints

- Não renomear nem adicionar estágios (`estado`) — mantém `S0_NOVO`...`S7_HANDOFF_HUMANO` exatamente como estão.
- Não tocar em: PROIBIÇÕES ABSOLUTAS (segurança jurídica), ESTILO DE ESCRITA, fluxo de `Agendar Consulta`, `Persistir Consulta no CRM`, `Marcar Sem Interesse`.
- Nenhuma chamada de LLM adicional por mensagem (sem latência/custo extra) — só um node de código determinístico.
- Toda alteração de produção só depois de validar num clone de teste (`Mayara — Núcleo do Agente [DRAFT V3]`), nunca direto no workflow que já está em produção (`KLdDHFsr1gJhnHkF`).
- `docs/superpowers/specs/2026-09-09-mayara-prompt-revisado.txt` é a fonte da verdade do prompt — editar esse arquivo primeiro, depois sincronizar no n8n (nunca o contrário).
- Preferir `n8n_update_partial_workflow` com operação `updateNode` (substituição completa do campo) em vez de `patchNodeField` (find/replace) — nesta sessão `patchNodeField` já travou 5x seguidas numa edição simples enquanto `updateNode` funcionou de primeira.

---

## Nota de correção em relação à spec

Ao detalhar a lógica de `Calcular Lacunas`, ficou claro que a lista de prioridade da spec (situação judicial/urgência → notificação → causa econômica → outros contratos → renegociação) esqueceu de incluir **qual banco** como lacuna computável — mas o próprio exemplo da spec e a conversa original do usuário (seção 5) tratam "qual banco" como literalmente a primeira pergunta quando ainda não se sabe. Este plano corrige isso: `bancos` ausente entra como a 2ª lacuna prioritária (logo depois de situação judicial/urgência, antes de notificação/causa econômica/outros contratos/renegociação). Documentando aqui porque é uma pequena mudança em relação ao texto literal da spec.

---

### Task 1: Função determinística `calcularLacunas` (TDD, sem dependência de n8n)

**Files:**
- Create: `docs/superpowers/specs/2026-09-18-mayara-v3/calcular-lacunas.mjs`
- Create: `docs/superpowers/specs/2026-09-18-mayara-v3/calcular-lacunas.test.mjs`

**Interfaces:**
- Produces: `calcularLacunas(fatosJson: object): string` — usada pela Task 3 para colar a mesma lógica (inline, sem `export`) dentro do Code node do n8n.

- [ ] **Step 1: Escrever os testes (devem falhar, a função ainda não existe)**

```js
// docs/superpowers/specs/2026-09-18-mayara-v3/calcular-lacunas.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularLacunas } from './calcular-lacunas.mjs';

test('fatosJson vazio: lacuna prioritaria e situacao judicial, nenhum fato conhecido', () => {
  const resultado = calcularLacunas({});
  assert.match(resultado, /FATOS JÁ CONHECIDOS: \(nenhum ainda\)/);
  assert.match(resultado, /LACUNA PRIORITÁRIA EM ABERTO: situação judicial vs\. cobrança informal/);
  assert.match(resultado, /OUTRAS LACUNAS/);
});

test('situacao e urgencia conhecidas, banco ausente: banco vira prioritaria', () => {
  const resultado = calcularLacunas({ situacaoJudicial: 'nenhuma', urgencia: 'baixa' });
  assert.match(resultado, /LACUNA PRIORITÁRIA EM ABERTO: banco\(s\) envolvido\(s\) na dívida/);
});

test('situacao, urgencia e banco conhecidos: causa economica vira prioritaria', () => {
  const resultado = calcularLacunas({
    tipoDivida: 'Capital de Giro',
    bancos: ['Sicredi'],
    valorAproximado: '~300mil',
    documento: 'CNPJ',
    situacaoJudicial: 'nenhuma',
    urgencia: 'baixa',
  });
  assert.match(resultado, /FATOS JÁ CONHECIDOS: tipo=Capital de Giro; banco=Sicredi; valor=~300mil; documento=CNPJ/);
  assert.match(resultado, /LACUNA PRIORITÁRIA EM ABERTO: causa econômica do atraso\/dificuldade/);
});

test('notificacaoOrigem desconhecida aparece depois de situacao judicial e banco', () => {
  const resultado = calcularLacunas({
    situacaoJudicial: 'nenhuma',
    urgencia: 'baixa',
    bancos: ['Sicredi'],
    notificacaoOrigem: 'desconhecida',
  });
  assert.match(resultado, /LACUNA PRIORITÁRIA EM ABERTO: origem da notificação recebida \(banco ou judicial\)/);
});

test('notificacaoOrigem resolvida (banco ou judicial) nao aparece mais como lacuna', () => {
  const resultado = calcularLacunas({
    situacaoJudicial: 'nenhuma',
    urgencia: 'baixa',
    bancos: ['Sicredi'],
    notificacaoOrigem: 'banco',
    causaEconomica: 'queda de faturamento',
    outrosContratosOuDividas: false,
    tentativaRenegociacao: false,
  });
  assert.doesNotMatch(resultado, /notificação/);
});

test('outrosContratosOuDividas false (fato conhecido, nao ausente) nao conta como lacuna', () => {
  const resultado = calcularLacunas({
    situacaoJudicial: 'nenhuma',
    urgencia: 'baixa',
    bancos: ['Sicredi'],
    causaEconomica: 'queda de faturamento',
    outrosContratosOuDividas: false,
    tentativaRenegociacao: true,
  });
  assert.doesNotMatch(resultado, /outros contratos/);
});

test('todos os campos conhecidos: mensagem de nenhuma lacuna, sem linha de outras lacunas', () => {
  const resultado = calcularLacunas({
    tipoDivida: 'Capital de Giro',
    bancos: ['Sicredi'],
    valorAproximado: '~300mil',
    documento: 'CNPJ',
    situacaoJudicial: 'nenhuma',
    urgencia: 'baixa',
    notificacaoOrigem: 'banco',
    causaEconomica: 'queda de faturamento',
    outrosContratosOuDividas: false,
    tentativaRenegociacao: true,
  });
  assert.match(resultado, /LACUNA PRIORITÁRIA EM ABERTO: nenhuma — todas as lacunas conhecidas foram resolvidas/);
  assert.doesNotMatch(resultado, /OUTRAS LACUNAS/);
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `node --test docs/superpowers/specs/2026-09-18-mayara-v3/calcular-lacunas.test.mjs`
Expected: FAIL — `Cannot find module './calcular-lacunas.mjs'`

- [ ] **Step 3: Implementar a função**

```js
// docs/superpowers/specs/2026-09-18-mayara-v3/calcular-lacunas.mjs
export function calcularLacunas(fatosJson) {
  const f = fatosJson || {};

  const fatosConhecidosPares = [];
  if (f.tipoDivida) fatosConhecidosPares.push(`tipo=${f.tipoDivida}`);
  if (f.bancos && f.bancos.length) fatosConhecidosPares.push(`banco=${f.bancos.join(', ')}`);
  if (f.valorAproximado) fatosConhecidosPares.push(`valor=${f.valorAproximado}`);
  if (f.documento) fatosConhecidosPares.push(`documento=${f.documento}`);

  const linhaFatos = fatosConhecidosPares.length
    ? `FATOS JÁ CONHECIDOS: ${fatosConhecidosPares.join('; ')}`
    : 'FATOS JÁ CONHECIDOS: (nenhum ainda)';

  const lacunasEmOrdem = [];

  if (!f.situacaoJudicial || !f.urgencia) {
    lacunasEmOrdem.push('situação judicial vs. cobrança informal');
  }
  if (!f.bancos || !f.bancos.length) {
    lacunasEmOrdem.push('banco(s) envolvido(s) na dívida');
  }
  if (f.notificacaoOrigem === 'desconhecida') {
    lacunasEmOrdem.push('origem da notificação recebida (banco ou judicial)');
  }
  if (!f.causaEconomica) {
    lacunasEmOrdem.push('causa econômica do atraso/dificuldade');
  }
  if (typeof f.outrosContratosOuDividas === 'undefined') {
    lacunasEmOrdem.push('existência de outros contratos ou dívidas bancárias');
  }
  if (typeof f.tentativaRenegociacao === 'undefined') {
    lacunasEmOrdem.push('tentativa anterior de renegociação com o banco');
  }

  if (lacunasEmOrdem.length === 0) {
    return [
      linhaFatos,
      'LACUNA PRIORITÁRIA EM ABERTO: nenhuma — todas as lacunas conhecidas foram resolvidas',
      'NUNCA PERGUNTE O QUE JÁ ESTÁ EM "FATOS JÁ CONHECIDOS"',
    ].join('\n');
  }

  const [prioritaria, ...outras] = lacunasEmOrdem;
  const linhas = [linhaFatos, `LACUNA PRIORITÁRIA EM ABERTO: ${prioritaria}`];
  if (outras.length) {
    linhas.push(`OUTRAS LACUNAS (só considerar se a prioritária já foi resolvida): ${outras.join('; ')}`);
  }
  linhas.push('NUNCA PERGUNTE O QUE JÁ ESTÁ EM "FATOS JÁ CONHECIDOS"');
  return linhas.join('\n');
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `node --test docs/superpowers/specs/2026-09-18-mayara-v3/calcular-lacunas.test.mjs`
Expected: PASS (7 testes)

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-09-18-mayara-v3/
git commit -m "feat(mayara-v3): adiciona funcao determinista calcularLacunas com testes"
```

---

### Task 2: Clonar o Núcleo em `Mayara — Núcleo do Agente [DRAFT V3]`

**Files:** nenhum arquivo do repo — só chamadas MCP contra o n8n.

**Interfaces:**
- Consumes: workflow `KLdDHFsr1gJhnHkF` (produção atual, não será alterado nesta task).
- Produces: um novo `V3_WORKFLOW_ID` (anote o valor retornado — todas as tasks seguintes usam esse id, não o de produção).

- [ ] **Step 1: Buscar o workflow atual completo**

Chamar `mcp__n8n-mcp__n8n_get_workflow` com `id: "KLdDHFsr1gJhnHkF"`, `mode: "full"`. Guarde o JSON completo (nodes, connections, settings) retornado.

- [ ] **Step 2: Criar o clone**

Chamar `mcp__n8n-mcp__n8n_create_workflow` com os mesmos `nodes`/`connections`/`settings` do passo 1, mas:
- `name: "Mayara — Núcleo do Agente [DRAFT V3]"`
- `active: false` (nunca criar já ativo)

Anote o `id` retornado como `V3_WORKFLOW_ID`.

- [ ] **Step 3: Verificar que o clone é idêntico ao original**

Chamar `mcp__n8n-mcp__n8n_get_workflow` com `id: V3_WORKFLOW_ID`, `mode: "structure"`.
Expected: `nodeCount: 21`, `connectionCount: 19` (mesmos valores do workflow original nesta data).

- [ ] **Step 4: Registrar o id no plano**

Edite este arquivo de plano substituindo toda ocorrência de `V3_WORKFLOW_ID` (nas tasks 3, 5 e 9 abaixo) pelo id real retornado, para as próximas tasks não precisarem adivinhar.

---

### Task 3: Inserir o node `Calcular Lacunas` no clone V3

**Files:** nenhum arquivo do repo — só chamadas MCP contra `V3_WORKFLOW_ID`.

**Interfaces:**
- Consumes: `calcularLacunas` (lógica da Task 1, colada inline — o Code node do n8n não importa módulos).
- Produces: campo `lacunas` (string) disponível no `$json` que chega no node `AI Agent` — a Task 4 referencia isso no prompt como `{{ $json.lacunas }}`.

- [ ] **Step 1: Adicionar o node de código**

Chamar `mcp__n8n-mcp__n8n_update_partial_workflow` em `V3_WORKFLOW_ID` com operação `addNode`:

```json
{
  "type": "addNode",
  "node": {
    "name": "Calcular Lacunas",
    "type": "n8n-nodes-base.code",
    "position": [1080, 832],
    "parameters": {
      "jsCode": "const item = $input.first().json;\nlet fatosJson = {};\ntry {\n  fatosJson = item.fatosJson ? JSON.parse(item.fatosJson) : {};\n} catch (e) {\n  fatosJson = {};\n}\n\nconst fatosConhecidosPares = [];\nif (fatosJson.tipoDivida) fatosConhecidosPares.push(`tipo=${fatosJson.tipoDivida}`);\nif (fatosJson.bancos && fatosJson.bancos.length) fatosConhecidosPares.push(`banco=${fatosJson.bancos.join(', ')}`);\nif (fatosJson.valorAproximado) fatosConhecidosPares.push(`valor=${fatosJson.valorAproximado}`);\nif (fatosJson.documento) fatosConhecidosPares.push(`documento=${fatosJson.documento}`);\n\nconst linhaFatos = fatosConhecidosPares.length\n  ? `FATOS JÁ CONHECIDOS: ${fatosConhecidosPares.join('; ')}`\n  : 'FATOS JÁ CONHECIDOS: (nenhum ainda)';\n\nconst lacunasEmOrdem = [];\nif (!fatosJson.situacaoJudicial || !fatosJson.urgencia) {\n  lacunasEmOrdem.push('situação judicial vs. cobrança informal');\n}\nif (!fatosJson.bancos || !fatosJson.bancos.length) {\n  lacunasEmOrdem.push('banco(s) envolvido(s) na dívida');\n}\nif (fatosJson.notificacaoOrigem === 'desconhecida') {\n  lacunasEmOrdem.push('origem da notificação recebida (banco ou judicial)');\n}\nif (!fatosJson.causaEconomica) {\n  lacunasEmOrdem.push('causa econômica do atraso/dificuldade');\n}\nif (typeof fatosJson.outrosContratosOuDividas === 'undefined') {\n  lacunasEmOrdem.push('existência de outros contratos ou dívidas bancárias');\n}\nif (typeof fatosJson.tentativaRenegociacao === 'undefined') {\n  lacunasEmOrdem.push('tentativa anterior de renegociação com o banco');\n}\n\nlet lacunas;\nif (lacunasEmOrdem.length === 0) {\n  lacunas = [\n    linhaFatos,\n    'LACUNA PRIORITÁRIA EM ABERTO: nenhuma — todas as lacunas conhecidas foram resolvidas',\n    'NUNCA PERGUNTE O QUE JÁ ESTÁ EM \"FATOS JÁ CONHECIDOS\"',\n  ].join('\\n');\n} else {\n  const [prioritaria, ...outras] = lacunasEmOrdem;\n  const linhas = [linhaFatos, `LACUNA PRIORITÁRIA EM ABERTO: ${prioritaria}`];\n  if (outras.length) {\n    linhas.push(`OUTRAS LACUNAS (só considerar se a prioritária já foi resolvida): ${outras.join('; ')}`);\n  }\n  linhas.push('NUNCA PERGUNTE O QUE JÁ ESTÁ EM \"FATOS JÁ CONHECIDOS\"');\n  lacunas = linhas.join('\\n');\n}\n\nreturn [{ json: { ...item, lacunas } }];"
    }
  }
}
```

- [ ] **Step 2: Rewire — inserir o node entre `Buscar Estado da Sessao` e `Montar Contexto`**

Chamar `n8n_update_partial_workflow` em `V3_WORKFLOW_ID` com três operações, na ordem:
1. `{"type": "removeConnection", "source": "Buscar Estado da Sessao", "target": "Montar Contexto"}`
2. `{"type": "addConnection", "source": "Buscar Estado da Sessao", "target": "Calcular Lacunas"}`
3. `{"type": "addConnection", "source": "Calcular Lacunas", "target": "Montar Contexto"}`

- [ ] **Step 3: Verificar se `Montar Contexto` precisa de ajuste**

Chamar `mcp__n8n-mcp__n8n_get_workflow` em `V3_WORKFLOW_ID`, `mode: "full"`, e localizar o node `Montar Contexto`.
- Se `parameters.mode` ou equivalente indicar que ele já inclui todos os campos de entrada (passthrough), nenhuma mudança é necessária — o campo `lacunas` já vai fluir automaticamente.
- Se ele lista campos explicitamente (`assignments`), use `updateNode` (substituição completa do node, não `patchNodeField`) adicionando uma nova entrada `{"name": "lacunas", "type": "string", "value": "={{ $json.lacunas }}"}` à lista já existente, preservando todas as entradas atuais (`estadoAtual`, `fatosJson`, etc.) sem removê-las.

- [ ] **Step 4: Testar isoladamente**

Chamar `mcp__n8n-mcp__n8n_test_workflow` em `V3_WORKFLOW_ID` com `method: "direct"`, fixando um `fatosJson` de teste vazio (`{}`) na entrada. Inspecionar a execução: o node `Calcular Lacunas` deve produzir a string com `LACUNA PRIORITÁRIA EM ABERTO: situação judicial vs. cobrança informal`, e esse valor deve estar presente no `$json` que chega no node `AI Agent`.

- [ ] **Step 5: Commit (nada no repo mudou nesta task — pular commit; a rastreabilidade fica no n8n)**

---

### Task 4: Reescrever o prompt (arquivo fonte da verdade)

**Files:**
- Modify: `docs/superpowers/specs/2026-09-09-mayara-prompt-revisado.txt`

**Interfaces:**
- Consumes: `{{ $json.lacunas }}` (produzido pela Task 3).
- Produces: o texto final do prompt, consumido pela Task 5 (que copia este arquivo para o node `AI Agent` do clone).

- [ ] **Step 1: Edit A — schema de fatos, FATO≠INFERÊNCIA, injeção das lacunas, regra de ouro**

Old string:
```
Use estas chaves quando o fato existir: `tipoDivida`, `bancos` (lista), `valorAproximado`, `documento` (CPF/CNPJ/ambos), `situacaoJudicial` (nenhuma, negativado, protestado, execução, recuperação_judicial, falência), `urgencia` (baixa/média/alta), `nomeCompleto`, `nomeEmpresa`, `telefone`, `email`, `clienteAtual` (true/false). Outras chaves são livres, mas reutilize as acima quando o conceito repetir.

REGRA CRÍTICA — NÃO PERGUNTE O QUE JÁ SABE
```

New string:
```
Use estas chaves quando o fato existir: `tipoDivida`, `bancos` (lista), `valorAproximado`, `documento` (CPF/CNPJ/ambos), `situacaoJudicial` (nenhuma, negativado, protestado, execução, recuperação_judicial, falência), `urgencia` (baixa/média/alta), `causaEconomica` (texto curto: por que a dívida ou o atraso aconteceu ou vai acontecer), `tentativaRenegociacao` (true/false), `outrosContratosOuDividas` (true/false), `notificacaoOrigem` (banco, judicial, ou desconhecida — grave "desconhecida" quando o cliente mencionar uma notificação sem deixar claro se é judicial ou do banco; atualize para "banco" ou "judicial" assim que descobrir), `nomeCompleto`, `nomeEmpresa`, `telefone`, `email`, `clienteAtual` (true/false). Outras chaves são livres, mas reutilize as acima quando o conceito repetir.

FATO NÃO É INFERÊNCIA — só grave como fato o que a pessoa disse literalmente, nunca o que você deduziu a partir disso.
Exemplo errado: cliente disse "recebi uma notificação" → não grave `situacaoJudicial: execução`. Grave `notificacaoOrigem: desconhecida` e pergunte para esclarecer.
Exemplo errado: cliente disse "estou vendo outras opções" → não grave que ele achou caro ou que vai desistir. Grave só o que ele disse, sem completar a intenção por ele.
Exemplo errado: cliente parou de responder → não grave que ele perdeu o interesse. A ausência de resposta não é um fato sobre a opinião dele.

LACUNAS DE DECISÃO (calculado automaticamente pelo sistema — nunca calcule isso sozinho, apenas leia)

{{ $json.lacunas }}

REGRA DE OURO: se a resposta a uma pergunta não for mudar sua próxima ação (classificação, prioridade, encaminhamento, ou proposta de consulta), não faça essa pergunta. Pergunte pela lacuna prioritária listada acima somente se ela realmente importar agora. Se o cliente já respondeu essa lacuna direta ou indiretamente em qualquer mensagem anterior, considere-a resolvida e vá para a próxima, ou avalie se já há contexto suficiente para propor a consulta.

REGRA CRÍTICA — NÃO PERGUNTE O QUE JÁ SABE
```

- [ ] **Step 2: Edit B — substituir o roteiro fixo pelo roteiro guiado por lacuna**

Old string:
```
ROTEIRO DE QUALIFICAÇÃO (uma coisa de cada vez, só o que falta e realmente importa)

- Tipo de dívida (empréstimo, financiamento, cheque especial, cartão PJ, antecipação de recebíveis, outro) e com qual banco. Se houver mais de um banco, registre todos — não pergunte ativamente, mas não ignore se o cliente mencionar.
- Valor aproximado da dívida.
- Se é dívida em CPF, CNPJ, ou ambos.
- Se já está negativado, protestado, ou já existe ação judicial em andamento, ou se por enquanto é só cobrança informal.
- Nível de urgência (intimação, penhora, bloqueio de conta?).

Pule qualquer item já respondido.
```

New string:
```
ROTEIRO DE QUALIFICAÇÃO (guiado pela lacuna de decisão, não é uma lista fixa em ordem)

Não existe mais uma ordem fixa de perguntas. A lacuna prioritária listada em LACUNAS DE DECISÃO (acima) indica o que perguntar agora — mas só pergunte se, pela REGRA DE OURO, isso realmente mudar sua próxima ação. Os temas que normalmente importam continuam sendo: tipo de dívida e banco(s) envolvido(s), valor aproximado, CPF/CNPJ, situação judicial real (negativado, protestado, execução, ou só cobrança informal), nível de urgência, causa econômica do problema, e se já houve tentativa de renegociação com o banco. Se o cliente mencionar espontaneamente um desses temas fora de ordem, ou responder vários de uma vez numa mensagem longa, registre tudo — nunca pergunte de novo o que já foi dito, mesmo que indiretamente.
```

- [ ] **Step 3: Edit C — reforçar STOP QUALIFICATION com precedência explícita**

Old string:
```
STOP QUALIFICATION — QUANDO PARAR IMEDIATAMENTE

Pare de qualificar e avalie encaminhamento/agendamento/handoff assim que detectar, mesmo faltando itens do roteiro:
- execução judicial confirmada, citação, intimação, oficial de justiça, bloqueio, penhora, apreensão/busca de bens, leilão, recuperação judicial, falência, ou situação patrimonial concreta ligada a processo;
- pedido direto do cliente para falar com advogado ou pessoa;
- o cliente já aceitou a consulta (ver seção abaixo);
- já existe informação suficiente para propor a consulta.

Ao detectar prioridade jurídica: reconheça objetivamente, sem dramatizar, sem diagnóstico jurídico, sem ensinar estratégia, sem aumentar medo — e encaminhe.
```

New string:
```
STOP QUALIFICATION — QUANDO PARAR IMEDIATAMENTE

Pare de qualificar e avalie encaminhamento/agendamento/handoff assim que detectar, mesmo faltando itens do roteiro ou lacunas ainda abertas:
- execução judicial confirmada, citação, intimação, oficial de justiça, bloqueio, penhora, apreensão/busca de bens, leilão, recuperação judicial, falência, ou situação patrimonial concreta ligada a processo;
- pedido direto do cliente para falar com advogado ou pessoa;
- o cliente já aceitou a consulta (ver seção abaixo);
- já existe informação suficiente para propor a consulta.

STOP QUALIFICATION tem prioridade absoluta sobre qualquer lacuna de decisão listada e sobre a regra de NÃO AGENDE CEDO DEMAIS (mais abaixo). Uma vez detectado, não faça mais nenhuma pergunta comercial (faturamento, banco, renegociação, outros contratos) só para completar contexto — vá direto para o reconhecimento e o encaminhamento.

Ao detectar prioridade jurídica: reconheça objetivamente, sem dramatizar, sem diagnóstico jurídico, sem ensinar estratégia, sem aumentar medo — e encaminhe.
```

- [ ] **Step 4: Edit D — nova seção NÃO AGENDE CEDO DEMAIS**

Old string:
```
Nesses casos, e só nesses: pare imediatamente qualquer qualificação. Responda: "Percebo que isso está pesando muito. Se sentir que não consegue lidar com isso sozinho, o CVV (188, ligação gratuita, 24h) pode ajudar." Encaminhe para atendimento humano imediatamente. Nunca trate como qualificação de lead.

QUANDO O CLIENTE ACEITAR A CONSULTA
```

New string:
```
Nesses casos, e só nesses: pare imediatamente qualquer qualificação. Responda: "Percebo que isso está pesando muito. Se sentir que não consegue lidar com isso sozinho, o CVV (188, ligação gratuita, 24h) pode ajudar." Encaminhe para atendimento humano imediatamente. Nunca trate como qualificação de lead.

NÃO AGENDE CEDO DEMAIS

Fora dos casos de STOP QUALIFICATION (que sempre tem prioridade), não proponha a consulta só porque já sabe o tipo de dívida, o banco e que há atraso — isso normalmente não é contexto suficiente. Antes de propor, pergunte-se internamente: "com o que já foi dito, o Dr. Santo vai entender por que essa pessoa está buscando ajuda agora?" Se a resposta for não, faça mais uma pergunta de alto valor (guiada pela lacuna prioritária) antes de oferecer a consulta. Se a resposta for sim, ou se o cliente já aceitou a consulta, avance normalmente.

QUANDO O CLIENTE ACEITAR A CONSULTA
```

- [ ] **Step 5: Edit E — reforçar persuasão via compreensão em EMPATIA SEM TEATRALIDADE**

Old string:
```
Nunca explore essa vulnerabilidade para forçar agendamento, e nunca acolha só como transição apressada para o próximo passo.

SE O CLIENTE FOR RÍSPIDO OU GROSSEIRO
```

New string:
```
Nunca explore essa vulnerabilidade para forçar agendamento, e nunca acolha só como transição apressada para o próximo passo.

A principal ferramenta de persuasão da Mayara é demonstrar que entendeu corretamente a situação do lead — não pressionar. Prefira mostrar compreensão dos fatos concretos ("Pelo que você me contou, a empresa ainda está pagando, mas a queda no movimento já pressiona o caixa.") a criar urgência artificial. Quando a compreensão for clara, a proposta de consulta vira consequência natural da conversa, não uma interrupção.

SE O CLIENTE FOR RÍSPIDO OU GROSSEIRO
```

- [ ] **Step 6: Conferir consistência do arquivo inteiro**

Ler o arquivo completo depois dos 5 edits e confirmar: nenhuma seção duplicada, `{{ $json.lacunas }}` aparece exatamente uma vez, as seções PROIBIÇÕES ABSOLUTAS/ESTILO DE ESCRITA/AGENDAMENTO/CRM continuam idênticas ao original.

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/specs/2026-09-09-mayara-prompt-revisado.txt
git commit -m "feat(mayara-v3): reescreve prompt com motor de lacunas de decisao, FATO!=INFERENCIA e nao-agende-cedo-demais"
```

---

### Task 5: Publicar o prompt atualizado no clone V3 e smoke test

**Files:** nenhum arquivo do repo — lê o arquivo da Task 4 e publica via MCP.

**Interfaces:**
- Consumes: conteúdo final de `docs/superpowers/specs/2026-09-09-mayara-prompt-revisado.txt` (Task 4).
- Consumes: campo `lacunas` no `$json` (Task 3).

- [ ] **Step 1: Ler o arquivo final**

Ler `docs/superpowers/specs/2026-09-09-mayara-prompt-revisado.txt` na íntegra.

- [ ] **Step 2: Publicar no node `AI Agent` do clone**

Chamar `mcp__n8n-mcp__n8n_update_partial_workflow` em `V3_WORKFLOW_ID` com operação `updateNode` (substituição completa, não `patchNodeField`) no node `AI Agent`, setando `parameters.options.systemMessage` para o texto lido no Step 1.

- [ ] **Step 3: Smoke test — sem crash, sem vazamento de raciocínio**

Chamar `mcp__n8n-mcp__n8n_test_workflow` em `V3_WORKFLOW_ID`, `method: "trigger"`, com uma mensagem simples de teste (ex: card de lead colado + "oi, vi o anúncio de vocês"). Inspecionar a resposta final enviada:
- Não deve conter as palavras literais "LACUNA", "FATOS JÁ CONHECIDOS", "PRIORITÁRIA" nem qualquer trecho do bloco de lacunas.
- Deve ser uma mensagem curta, natural, dentro do limite de 300 caracteres.

Se aparecer vazamento do bloco de raciocínio na resposta visível: voltar à Task 4 e reforçar, na seção ESTILO/FORMATO DA RESPOSTA existente, que o bloco LACUNAS DE DECISÃO é uso interno e nunca deve ser citado ou reproduzido na mensagem ao cliente.

---

### Task 6: Ledger de testes da Fase 1 (13 cenários)

**Files:**
- Create: `docs/superpowers/plans/2026-09-18-mayara-v3-testes.md`

- [ ] **Step 1: Escrever os 13 cenários com critério de sucesso**

```markdown
# Mayara V3 — Testes da Fase 1 (Motor de Raciocínio)

Workflow testado: Mayara — Núcleo do Agente [DRAFT V3] (V3_WORKFLOW_ID)
Método: mcp__n8n-mcp__n8n_test_workflow, method "trigger", card de lead colado como
primeira mensagem quando indicado.

## 1. Capital de giro + banco único + atraso
Entrada: card "Capital de Giro — CNPJ — R$200-500 mil — Em atraso", sem banco informado.
Sucesso: primeira pergunta é sobre o banco (não repete tipo/valor/documento do card).

## 2. Capital de giro + vários produtos/bancos
Entrada: cenário 1 seguido de "tenho também um cheque especial com o Itaú".
Sucesso: registra os dois bancos/produtos sem pedir para repetir o primeiro.

## 3. Adimplente prevendo atraso por queda de faturamento (base: caso André)
Entrada: "Ainda estou em dia mas o movimento caiu e acho que vou atrasar."
Sucesso: NÃO pergunta sobre cobrança/execução judicial (não é caso de atraso real);
pergunta a causa econômica ou se já tentou negociar antes de oferecer consulta;
não oferece consulta só com produto+banco+"vou atrasar".

## 4. Notificação ambígua (base: caso Wander)
Entrada: "Recebi uma notificação sobre minha dívida."
Sucesso: pergunta explicitamente se a notificação é judicial ou do banco antes de
qualquer outra coisa relacionada a essa dívida; não assume `situacaoJudicial: execução`
nem qualquer outro valor sem essa resposta.

## 5. Execução judicial confirmada
Entrada: "Já tem uma execução contra a empresa, fui citado o mês passado."
Sucesso: STOP QUALIFICATION dispara — sem mais nenhuma pergunta comercial (banco,
faturamento, renegociação); reconhece e encaminha/oferece consulta na mesma resposta
ou na seguinte.

## 6. Bloqueio de conta + apreensão + aceite de consulta (base: caso Jonison)
Entrada: "Bloquearam minha conta e já apreenderam um veículo. Quero falar com o advogado."
Sucesso: STOP QUALIFICATION dispara e, como o cliente já pediu para falar com
advogado, vai direto para agendamento sem perguntas de qualificação adicionais.

## 7. Imóvel em garantia + leilão (base: caso Robson)
Entrada: "Dei meu imóvel de garantia e já teve leilão dele."
Sucesso: STOP QUALIFICATION dispara; não pede detalhes financeiros adicionais
(faturamento, outros contratos); encaminha para consulta com reconhecimento breve.

## 8. Doença familiar como causa do atraso
Entrada: "Minha esposa teve câncer e isso pesou muito nas contas, atrasei tudo."
Sucesso: reconhece brevemente o fato humano (uma frase, sem dramatizar) antes de
continuar; não emenda a próxima pergunta de qualificação na mesma frase do
reconhecimento.

## 9. Cliente que já passou por outro advogado
Entrada: "Já contratei um advogado antes pra isso, não deu certo."
Sucesso: não avalia nem opina sobre o profissional anterior; reconhece e diz que o
Dr. Santo precisa conversar diretamente sobre isso.

## 10. Lead aceita consulta no meio da qualificação
Entrada: card de lead + "quero marcar uma consulta" como primeira resposta, antes de
qualquer pergunta de qualificação ter sido feita.
Sucesso: para imediatamente de qualificar (não pergunta banco, valor, situação
judicial); vai direto para coleta de dados de agendamento.

## 11. Resposta longa preenchendo 5+ campos de uma vez
Entrada: "Peguei um capital de giro de 200 mil com o Bradesco, já negativado, não
tentei renegociar ainda, e não tenho outras dívidas bancárias."
Sucesso: registra tipoDivida, bancos, valorAproximado, situacaoJudicial,
tentativaRenegociacao=false e outrosContratosOuDividas=false na mesma rodada — não
pergunta de novo nenhum desses itens nas mensagens seguintes.

## 12. Informação já conhecida no CRM sendo mencionada de novo
Entrada: cenário 11 seguido de "ah, é sobre o capital de giro que falei".
Sucesso: não repete pergunta sobre tipo de dívida/banco já registrados.

## 13. Lead fornece dia e horário exatos espontaneamente
Entrada: (a partir de um estado já qualificado) "pode ser segunda às 10h?"
Sucesso: usa a ferramenta Agendar Consulta com diaDaSemana="segunda" e hora="10:00"
sem antes oferecer os horários padrão de próximo dia útil.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/plans/2026-09-18-mayara-v3-testes.md
git commit -m "docs(mayara-v3): registra os 13 cenarios de teste da fase 1"
```

---

### Task 7: Executar os 13 cenários contra o clone V3

**Files:**
- Modify: `docs/superpowers/plans/2026-09-18-mayara-v3-testes.md`

- [ ] **Step 1: Rodar cada cenário**

Para cada um dos 13 cenários do arquivo da Task 6, chamar `mcp__n8n-mcp__n8n_test_workflow` em `V3_WORKFLOW_ID` reproduzindo a entrada descrita, e conferir o critério de sucesso lendo a resposta real e o `fatosJson` persistido em `mayara.session_state` para aquela sessão de teste.

- [ ] **Step 2: Registrar resultado de cada cenário**

Ao final de cada cenário no arquivo, adicionar uma linha `**Resultado:** PASS` ou `**Resultado:** FAIL — <descrição do que saiu diferente>`.

- [ ] **Step 3: Se algum cenário falhar, corrigir antes de continuar**

Para cada FAIL: voltar à Task 4 (arquivo do prompt) ou à Task 3 (node `Calcular Lacunas`), aplicar o ajuste mínimo, republicar no clone (repetir Task 5, Step 2), re-testar SÓ o cenário que falhou. Não seguir para a Task 8 enquanto houver algum FAIL.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-09-18-mayara-v3-testes.md docs/superpowers/specs/2026-09-09-mayara-prompt-revisado.txt
git commit -m "test(mayara-v3): registra resultado dos 13 cenarios da fase 1"
```

---

### Task 8: Regressão — re-rodar a bateria de 30 cenários existente

**Files:**
- Modify: `docs/superpowers/plans/2026-09-06-mayara-v2-testes-pendentes.md`

- [ ] **Step 1: Rodar a bateria de 30 cenários já documentada nesse arquivo contra `V3_WORKFLOW_ID`**

Usar os mesmos cenários e critérios já registrados nesse arquivo de sessões anteriores (alucinação de data, S6_AGENDADO prematuro, CRM persistindo vazio, nome errado no CRM, etc.), mas apontando para `V3_WORKFLOW_ID` em vez do workflow de produção.

- [ ] **Step 2: Registrar resultado**

Adicionar uma seção nova "18/09/2026 (ou data real da execução) — Regressão V3" no arquivo, listando PASS/FAIL por cenário.

- [ ] **Step 3: Se algum regressão for encontrada, usar systematic-debugging antes de corrigir**

Nenhum fix direto sem investigar a causa raiz primeiro — mesmo processo já usado nesta sessão para os bugs de data e CRM vazio.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-09-06-mayara-v2-testes-pendentes.md
git commit -m "test(mayara-v3): registra regressao da bateria de 30 cenarios contra o clone V3"
```

---

### Task 9: Cutover de produção e limpeza

**Files:**
- Modify: `docs/superpowers/plans/2026-09-18-mayara-v3-motor-raciocinio.md` (este arquivo, marcar concluído)

**Pré-condição:** Tasks 7 e 8 100% PASS.

- [ ] **Step 1: Trocar a Ponte para o V3**

Chamar `mcp__n8n-mcp__n8n_update_partial_workflow` no workflow `Mayara — Ponte WhatsApp` (`B1xdt1WotCQE3NOb`), operação `updateNode` no node `Chamar Mayara`, mudando `parameters.workflowId.value` de `KLdDHFsr1gJhnHkF` para `V3_WORKFLOW_ID`.

- [ ] **Step 2: Ativar o V3, desativar o V2 antigo**

Chamar `n8n_update_partial_workflow` operação `activateWorkflow` em `V3_WORKFLOW_ID`, e operação `deactivateWorkflow` em `KLdDHFsr1gJhnHkF`.

- [ ] **Step 3: Monitorar em tempo real**

Repetir o mesmo processo de monitoramento manual já usado na transição V1→V2 nesta sessão (acompanhar execuções da Ponte e do novo Núcleo por um período, com o número de testes) antes de considerar estável.

- [ ] **Step 4: Atualizar documentação**

- Marcar todos os checkboxes deste plano como concluídos.
- Atualizar `docs/superpowers/specs/2026-09-18-mayara-v3-motor-raciocinio-design.md` com uma seção "Conclusão" registrando a data e o `V3_WORKFLOW_ID` final.
- Adicionar `KLdDHFsr1gJhnHkF` (V2 antigo) à lista de workflows candidatos a desativação/limpeza no memory file `mayara_workflows_desativados_30dias.md`, seguindo o mesmo padrão de espera de ~30 dias antes de apagar.

- [ ] **Step 5: Commit final**

```bash
git add -A
git commit -m "feat(mayara-v3): cutover de producao para o motor de raciocinio por lacunas de decisao"
```

---

## Self-Review

**Cobertura da spec:** princípio central/regra de ouro → Task 4 Edit A; estados inalterados → nenhuma task toca nomes de estágio; novos campos `fatosJson` → Tasks 1, 3, 4; motor de lacunas → Tasks 1 e 3; as 5 mudanças de prompt (roteiro, FATO≠INFERÊNCIA, STOP, não-agende-cedo, persuasão) → Task 4 Edits A-E; plano de teste (13 + regressão 30) → Tasks 6, 7, 8; rollback → Task 2 (clone antes de tocar produção) e Task 9 (V2 continua existindo); pendências futuras (follow-up, ritmo de entrega, áudio) → intencionalmente fora deste plano, conforme a spec.

**Placeholders:** nenhum "TBD"/"implementar depois" — todo código e todo texto de prompt está escrito por extenso. `V3_WORKFLOW_ID` é um valor dinâmico gerado na Task 2, não um placeholder de conteúdo.

**Consistência de nomes:** `calcularLacunas` (Task 1) e a versão inline no Code node (Task 3) usam a mesma lógica e o mesmo nome de campo de saída `lacunas`; `{{ $json.lacunas }}` (Task 4) é o mesmo nome usado nas Tasks 3 e 5.
