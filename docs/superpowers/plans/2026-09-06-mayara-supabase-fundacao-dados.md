# Mayara — Fundação de Dados em Supabase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrar o estado da Mayara (n8n Data Tables) para Postgres/Supabase, e tornar a persistência da consulta no EspoCRM determinística (fora do tool-calling do AI Agent), com fila de retry para falhas reais da API.

**Architecture:** Um projeto Supabase (schema dedicado `mayara`, RLS ligado), acessado pelo n8n via credencial Postgres nativa. O AI Agent perde as 4 ferramentas de CRM; um bloco determinístico de nós, acionado por `returnIntermediateSteps` do agente, chama um sub-workflow reaproveitável que persiste Lead/Consulta no EspoCRM; falhas caem numa fila `pgmq` drenada por um workflow worker separado (Schedule Trigger a cada 5 min).

**Tech Stack:** n8n (remoto, `https://n8n.camparimadvogados.com.br`), n8n-mcp, Supabase (Postgres 15+, extensão `pgmq`), EspoCRM (API REST via credencial HTTP Header Auth já existente).

**Spec:** `docs/superpowers/specs/2026-09-06-mayara-supabase-fundacao-dados-design.md`

## Global Constraints

- Nunca usar `localhost` para n8n/EspoCRM/MariaDB — tudo remoto, VPS/Coolify.
- Nunca tocar o MariaDB do EspoCRM diretamente.
- Nunca colar segredos (senha do Postgres do Supabase, API keys) em arquivos versionáveis, texto de resposta, ou parâmetros de tool call — sempre via UI de credenciais do n8n, colado manualmente pelo usuário.
- Escopo local do n8n-mcp para qualquer credencial (nunca `project`).
- Schema Postgres: `mayara`, nunca `public` — RLS ligado em toda tabela do schema mesmo assim (defesa em profundidade).
- Colunas Postgres em `snake_case`; toda leitura (`SELECT`) usada por um nó do n8n deve aliasar pra `camelCase` no próprio SQL, pra bater com as expressões já existentes no workflow (`$json.estado`, `$json.fatosJson`, etc.).
- Sem migração de dados históricos das Data Tables atuais — o Postgres novo começa vazio.
- Antes de qualquer ação n8n, invocar a skill `n8n-mcp-skills:using-n8n-mcp-skills` (e as especialistas que ela apontar) se ainda não tiver sido invocada nesta sessão.
- Validar (`validate_workflow`/`n8n_validate_workflow`) e inspecionar `connections` via `n8n_get_workflow` depois de toda edição de workflow — validação sozinha não garante que as conexões estão certas.
- Só o draft `Mayara — Núcleo do Agente [DRAFT V2]` (id `KLdDHFsr1gJhnHkF`) é tocado. A Ponte de produção continua apontando pro Núcleo atual — trocar isso é decisão separada, fora deste plano.
- Verificar contra a documentação atual do Supabase (não confiar em memória de treinamento) a sintaxe exata de habilitar `pgmq` e o modo de conexão recomendado (pooler de sessão/transação/direta) — a doc muda com frequência.
- **Achado da Task 5 (drift real de instância):** o node Postgres (`n8n-nodes-base.postgres`/`postgresTool`) em `typeVersion: 2.7` quebra a ATIVAÇÃO/EXECUÇÃO nesta instância n8n especificamente (`Cannot read properties of undefined (reading 'execute')` — reproduzido isolado, sem relação com credencial/schema/query). **Usar sempre `typeVersion: 2.6`** para qualquer node Postgres novo (Tasks 7 e 9 inclusive). Reportado como feedback de produto.
- **Achado da Task 5:** `fatos_json` é `jsonb` nativo — ao ler via `SELECT`, sempre fazer `fatos_json::text as "fatosJson"` (sem o cast, o node Postgres devolve objeto JS, não string, quebrando tudo que espera `JSON.parse`/interpolação de texto no prompt).

---

### Task 1: Provisionar o projeto Supabase

**Files:** nenhum arquivo de repositório — ação de infraestrutura fora do código.

**Interfaces:**
- Produces: connection info do projeto (host, porta, nome do banco, usuário, senha) — fica só no dashboard do Supabase e na credencial do n8n (Task 4), nunca em arquivo.

- [x] **Passo 1: Criar conta/organização/projeto no Supabase**
Ação manual do usuário (conta, billing e criação de projeto não são automatizáveis por aqui): criar projeto no [dashboard do Supabase](https://supabase.com/dashboard), região próxima ao Brasil (ex. `sa-east-1`), nome sugerido `crmia-mayara`.

- [x] **Passo 2: Confirmar via SQL Editor do Supabase que o projeto está no ar**
No SQL Editor do próprio dashboard, rodar:
```sql
select version();
```
Esperado: retorna a versão do Postgres (15+), sem erro.

- [x] **Passo 3: Habilitar a extensão `pgmq`**
Antes de rodar, consultar a documentação atual do Supabase (`https://supabase.com/docs/guides/queues` ou o changelog) pro método correto na versão vigente — historicamente:
```sql
create extension if not exists pgmq;
```
(ou habilitar via Dashboard → Database → Extensions → `pgmq`, se o SQL direto não for o caminho suportado na versão atual).

- [x] **Passo 4: Testar a fila crua (antes de criar a fila definitiva)**
```sql
select pgmq.create('smoke_test_queue');
select * from pgmq.send('smoke_test_queue', '{"ok": true}'::jsonb);
select * from pgmq.read('smoke_test_queue', 60, 1);
select pgmq.drop_queue('smoke_test_queue');
```
Esperado: `send` retorna um `msg_id`; `read` retorna a mensagem enviada; `drop_queue` limpa tudo sem erro.

---

### Task 2: Criar o schema, as tabelas e RLS

**Files:**
- Create: `supabase/migrations/0001_mayara_schema.sql` (versionado no repo, aplicado manualmente no SQL Editor do Supabase nesta fase — sem CLI local configurado ainda)

**Interfaces:**
- Consumes: projeto Supabase da Task 1.
- Produces: tabelas `mayara.session_state`, `mayara.bridge_responses`, `mayara.crm_retry_failed`, todas com RLS ligado e sem nenhuma policy (deny-all por padrão) — consumidas pelas Tasks 5, 7 e 9.

- [x] **Passo 1: Escrever a migration**

```sql
-- supabase/migrations/0001_mayara_schema.sql
create schema if not exists mayara;

create table mayara.session_state (
  session_key text primary key,
  estado text not null,
  fatos_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table mayara.bridge_responses (
  session_key text primary key,
  output text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table mayara.crm_retry_failed (
  id bigserial primary key,
  payload jsonb not null,
  motivo_falha text,
  tentativas int not null default 0,
  criado_em timestamptz not null default now()
);

-- trigger genérico de updated_at
create or replace function mayara.set_updated_at()
returns trigger
language plpgsql
security invoker
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_session_state_updated_at
  before update on mayara.session_state
  for each row execute function mayara.set_updated_at();

create trigger trg_bridge_responses_updated_at
  before update on mayara.bridge_responses
  for each row execute function mayara.set_updated_at();

-- RLS ligado em tudo, sem nenhuma policy (deny-all para anon/authenticated;
-- a conexão do n8n usa o usuário postgres direto, que não passa por RLS)
alter table mayara.session_state enable row level security;
alter table mayara.bridge_responses enable row level security;
alter table mayara.crm_retry_failed enable row level security;
```

- [x] **Passo 2: Aplicar no SQL Editor do Supabase**
Colar e rodar o conteúdo do arquivo acima no SQL Editor do dashboard.

- [x] **Passo 3: Testar manualmente**
```sql
insert into mayara.session_state (session_key, estado, fatos_json)
values ('smoke-test', 'S0_NOVO', '{}'::jsonb);

select session_key as "sessionKey", estado, fatos_json as "fatosJson", updated_at
from mayara.session_state
where session_key = 'smoke-test';

update mayara.session_state set estado = 'S1_ENGAJADO' where session_key = 'smoke-test';
select updated_at from mayara.session_state where session_key = 'smoke-test';
-- esperado: updated_at mudou sozinho (trigger funcionando)

delete from mayara.session_state where session_key = 'smoke-test';
```

- [x] **Passo 4: Commit**
```bash
git add supabase/migrations/0001_mayara_schema.sql
git commit -m "feat(supabase): schema mayara com session_state, bridge_responses, crm_retry_failed"
```
(Nota: repositório local ainda não é um repo git inicializado — se `git commit` falhar por isso, rodar `git init` antes, conforme já orientado em outras skills deste projeto.)

---

### Task 3: Criar a fila `mayara_crm_retry`

**Files:**
- Create: `supabase/migrations/0002_mayara_crm_retry_queue.sql`

**Interfaces:**
- Consumes: extensão `pgmq` da Task 1.
- Produces: fila `mayara_crm_retry` — consumida pelas Tasks 7 (envio) e 9 (leitura/consumo).

- [x] **Passo 1: Escrever a migration**
```sql
-- supabase/migrations/0002_mayara_crm_retry_queue.sql
select pgmq.create('mayara_crm_retry');
```

- [x] **Passo 2: Aplicar no SQL Editor do Supabase**

- [x] **Passo 3: Testar**
```sql
select * from pgmq.send('mayara_crm_retry', '{"sessionKey":"smoke-test","nome":"Teste"}'::jsonb);
select * from pgmq.read('mayara_crm_retry', 60, 1);
-- anotar o msg_id retornado
select pgmq.delete('mayara_crm_retry', <msg_id_anotado>);
select * from pgmq.read('mayara_crm_retry', 60, 1);
-- esperado: vazio, mensagem de teste já removida
```

- [x] **Passo 4: Commit**
```bash
git add supabase/migrations/0002_mayara_crm_retry_queue.sql
git commit -m "feat(supabase): fila pgmq mayara_crm_retry"
```

---

### Task 4: Criar a credencial Postgres no n8n

**Files:** nenhum (credencial vive só no n8n, nunca em arquivo).

**Interfaces:**
- Consumes: host/porta/usuário/senha do projeto Supabase (Task 1, aba "Connect" do dashboard).
- Produces: credencial n8n chamada exatamente `Supabase — Mayara (Postgres)` — referenciada por nome em todas as Tasks seguintes que usam nós Postgres.

- [x] **Passo 1: Verificar o modo de conexão recomendado atualmente**
No dashboard do Supabase, aba "Connect" do projeto, conferir se a recomendação vigente pra uma ferramenta como o n8n (conexões de curta duração, uma por execução) é o *Session pooler* ou *Transaction pooler* — copiar exatamente os valores de host/porta mostrados ali (não usar valores de memória, mudam entre versões do Supabase).

- [x] **Passo 2: Criar a credencial na UI do n8n**
No n8n (`https://n8n.camparimadvogados.com.br`) → Settings → Credentials → New → **Postgres**. Nome: `Supabase — Mayara (Postgres)`. Colar host/porta/database/user/password direto da tela do Supabase (o usuário faz esse passo manualmente — nunca colar a senha numa mensagem pra mim ou num arquivo).

- [x] **Passo 3: Testar a conexão**
Clicar em "Test" na própria tela de credencial do n8n. Esperado: sucesso.

---

### Task 5: Trocar as Data Tables por Postgres no workflow principal

**Files:** workflow n8n `Mayara — Núcleo do Agente [DRAFT V2]` (id `KLdDHFsr1gJhnHkF`) — editado via n8n-mcp, sem arquivo local.

**Interfaces:**
- Consumes: credencial `Supabase — Mayara (Postgres)` (Task 4), tabelas da Task 2.
- Produces: os 3 nós (`Buscar Estado da Sessao`, `Salvar Estado da Conversa`, `Upsert row(s)`) agora lendo/escrevendo Postgres em vez de Data Table — consumido pelas Tasks seguintes (nada muda no contrato de dados que os outros nós já esperam: `$json.estado`, `$json.fatosJson`).

- [x] **Passo 1: Confirmar o node type certo pra ferramenta de Postgres do agente**
Antes de editar, rodar (verificar contra o schema ao vivo, não assumir por memória):
```
search_nodes({query: "postgres tool"})
get_node({nodeType: "nodes-base.postgresTool", detail: "standard"})
```
Confirmar os parâmetros exatos de operação `upsert`/`update` disponíveis nesse node type.

- [x] **Passo 2: Trocar `Buscar Estado da Sessao`**
```javascript
n8n_update_partial_workflow({
  id: "KLdDHFsr1gJhnHkF",
  operations: [{
    type: "updateNode",
    nodeName: "Buscar Estado da Sessao",
    changes: {
      type: "n8n-nodes-base.postgres",
      typeVersion: 2.6,
      parameters: {
        operation: "select",
        schema: { mode: "list", value: "mayara" },
        table: { mode: "list", value: "session_state" },
        returnAll: false,
        limit: 1,
        where: {
          values: [{ column: "session_key", condition: "equal", value: "={{ $json.sessionId }}" }]
        },
        options: {
          queryReplacement: ""
        }
      },
      credentials: {
        postgres: { name: "Supabase — Mayara (Postgres)" }
      }
    }
  }]
})
```
(Ajustar a forma exata dos parâmetros conforme o retorno real de `get_node` no Passo 1 — o node Postgres nativo do n8n costuma preferir um SELECT via `select` + colunas, mas pode exigir o SQL cru via `additionalFields.query` dependendo da versão; nesse caso usar diretamente:
```sql
select session_key as "sessionKey", estado, fatos_json as "fatosJson"
from mayara.session_state
where session_key = $1
```
com `$1` mapeado pro `sessionId` recebido.)

- [x] **Passo 3: Trocar `Salvar Estado da Conversa` (ferramenta do agente)**
Mesma lógica do Passo 2, mas como `postgresTool` (confirmado no Passo 1), operação `upsert` em `mayara.session_state` por `session_key`, mantendo os dois parâmetros `$fromAI('estado', ...)` e `$fromAI('fatosJson', ...)` como estão hoje (só muda o node type/credencial, não o contrato com o LLM).

- [x] **Passo 4: Trocar `Upsert row(s)`**
Mesmo padrão: `postgres` node, operação `upsert` em `mayara.bridge_responses` por `session_key`, colunas `output`.

- [x] **Passo 5: Validar**
```javascript
validate_workflow({ id: "KLdDHFsr1gJhnHkF" }) // ou n8n_validate_workflow({id: "KLdDHFsr1gJhnHkF"})
```
Esperado: 0 erros.

- [x] **Passo 6: Verificar conexões**
```javascript
n8n_get_workflow({ id: "KLdDHFsr1gJhnHkF" })
```
Conferir que os 3 nós têm o node type/credencial novos e que as conexões (`main` pros dois primeiros, `ai_tool` pro terceiro) continuam intactas.

- [x] **Passo 7: Testar de ponta a ponta**
```javascript
n8n_test_workflow({
  workflowId: "9dMnpX51XMG57O1l", // harness
  method: "trigger", triggerType: "webhook", httpMethod: "POST",
  data: { sessionId: "PG-MIGRATION-T1", message: "Oi, tenho uma dúvida sobre dívida bancária" }
})
```
Depois, no SQL Editor do Supabase:
```sql
select * from mayara.session_state where session_key = 'PG-MIGRATION-T1';
select * from mayara.bridge_responses where session_key = 'PG-MIGRATION-T1';
```
Esperado: uma linha em cada tabela, com `estado`/`fatosJson`/`output` condizentes com a resposta recebida.

---

### Task 6: Ligar `returnIntermediateSteps` e extrair a confirmação de Calendar

**Files:** mesmo workflow (`KLdDHFsr1gJhnHkF`).

**Interfaces:**
- Consumes: nó `AI Agent` existente.
- Produces: novo nó `Extrair Consulta Criada` com saída `{ consultaCriada: boolean, eventoCalendarioId?: string, horarioInicio?: string, horarioFim?: string }` — consumido pela Task 8.

- [x] **Passo 1: Ligar a opção no AI Agent**
```javascript
n8n_update_partial_workflow({
  id: "KLdDHFsr1gJhnHkF",
  operations: [{
    type: "updateNode",
    nodeName: "AI Agent",
    changes: {
      "parameters.options.returnIntermediateSteps": true
    }
  }]
})
```

- [x] **Passo 2: Rodar um teste de agendamento e inspecionar a forma real de `intermediateSteps`**
```javascript
n8n_test_workflow({
  workflowId: "9dMnpX51XMG57O1l",
  method: "trigger", triggerType: "webhook", httpMethod: "POST",
  data: { sessionId: "PG-MIGRATION-T2", message: "Meu nome e Teste Extracao, empresa Teste LTDA, telefone 11988887777, email teste.extracao.mayara@teste.invalid, divida de cartao PJ com o Bradesco uns 50 mil, so cobranca" }
})
// segunda mensagem, mesma sessão, pedindo horário exato pra forçar a chamada de Calendar
n8n_test_workflow({
  workflowId: "9dMnpX51XMG57O1l",
  method: "trigger", triggerType: "webhook", httpMethod: "POST",
  data: { sessionId: "PG-MIGRATION-T2", message: "quero marcar pra sexta as 10h" }
})
```
Depois, `n8n_executions({action: "get", id: <id da 2a execução>, mode: "full"})` no nó `AI Agent` — anotar a forma exata do campo `intermediateSteps` (nome da tool, formato do `action`/`observation`) pra usar no Passo 3.

- [x] **Passo 3: Criar o nó de extração**
Node `Code` (JavaScript), inserido logo depois de `AI Agent`:
```javascript
const steps = $input.first().json.intermediateSteps || [];
const calStep = steps.find(s => s.action?.tool === "Create an event in Google Calendar");

if (!calStep) {
  return [{ json: { consultaCriada: false } }];
}

const obs = typeof calStep.observation === "string"
  ? JSON.parse(calStep.observation)
  : calStep.observation;

return [{
  json: {
    consultaCriada: true,
    eventoCalendarioId: obs.id,
    horarioInicio: obs.start?.dateTime,
    horarioFim: obs.end?.dateTime
  }
}];
```
(Ajustar `s.action?.tool` e o parse de `calStep.observation` conforme a forma real observada no Passo 2 — LangChain no n8n normalmente expõe `{action: {tool, toolInput}, observation}` por step, mas confirmar contra o dado real antes de finalizar.)

- [x] **Passo 4: Adicionar a conexão**
```javascript
n8n_update_partial_workflow({
  id: "KLdDHFsr1gJhnHkF",
  operations: [{
    type: "addConnection",
    source: "AI Agent",
    target: "Extrair Consulta Criada",
    sourceOutput: "main"
  }]
})
```
(Nó `Extrair Consulta Criada` precisa ter sido criado antes via `addNode` — incluir esse `addNode` no mesmo lote de operações.)

- [x] **Passo 5: Validar e verificar**
`validate_workflow` (0 erros) + `n8n_get_workflow` confirmando a conexão `AI Agent → Extrair Consulta Criada`.

- [x] **Passo 6: Testar**
Rodar de novo o par de mensagens do Passo 2 (sessão nova, ex. `PG-MIGRATION-T2b`) e usar `n8n_executions` pra confirmar que `Extrair Consulta Criada` retornou `consultaCriada: true` com `eventoCalendarioId` real preenchido.

---

### Task 7: Criar o sub-workflow `Mayara — Persistir Consulta no CRM [Sub-workflow]`

**Files:** novo workflow n8n (via `n8n_create_workflow`).

**Interfaces:**
- Consumes: fila `mayara_crm_retry` (Task 3), credencial EspoCRM já existente (`EspoCRM Integração n8n — Mayara`, id `3CNvCGWMMDOyGD2n`), credencial `Supabase — Mayara (Postgres)` (Task 4).
- Produces: workflow reutilizável com `Execute Workflow Trigger` de entrada `{ sessionKey, nome, telefone, email, empresa, descricaoLead, eventoCalendarioId, horarioInicio, horarioFim }` — consumido pelas Tasks 8 e 9.

- [x] **Passo 1: Criar o workflow com o Execute Workflow Trigger**
```javascript
n8n_create_workflow({
  name: "Mayara — Persistir Consulta no CRM [Sub-workflow]",
  nodes: [{
    name: "Execute Workflow Trigger",
    type: "n8n-nodes-base.executeWorkflowTrigger",
    typeVersion: 1.1,
    position: [0, 0],
    parameters: {
      workflowInputs: { values: [
        { name: "sessionKey" }, { name: "nome" }, { name: "telefone" },
        { name: "email" }, { name: "empresa" }, { name: "descricaoLead" },
        { name: "eventoCalendarioId" }, { name: "horarioInicio" }, { name: "horarioFim" }
      ] }
    }
  }],
  connections: {}
})
```

- [x] **Passo 2: Adicionar os 4 nós de CRM, portados das ferramentas atuais**
Copiar a configuração (URL, método, credencial) de cada um dos 4 nós existentes no draft principal (`Buscar Lead por Telefone`, `Criar Lead no CRM`, `Atualizar Status do Lead`, `Criar Consulta no CRM`), mas:
- trocar `$fromAI('campo', ...)` por `={{ $json.campo }}` (lendo direto do Execute Workflow Trigger, não mais decidido pelo LLM);
- setar `onError: "continueErrorOutput"` em todos os 4.

Exemplo (`Buscar Lead por Telefone`):
```javascript
{
  name: "Buscar Lead por Telefone",
  type: "n8n-nodes-base.httpRequest",
  typeVersion: 4.4,
  onError: "continueErrorOutput",
  parameters: {
    url: "https://crm.camparimadvogados.com.br/api/v1/Lead",
    authentication: "genericCredentialType",
    genericAuthType: "httpHeaderAuth",
    sendQuery: true,
    queryParameters: { parameters: [
      { name: "where[0][type]", value: "equals" },
      { name: "where[0][attribute]", value: "phoneNumber" },
      { name: "where[0][value]", value: "={{ (() => { let d = $json.telefone.replace(/\\D/g, ''); if (d.length > 11 && d.startsWith('55')) d = d.slice(2); return '+55' + d; })() }}" }
    ]},
    sendHeaders: true, headerParameters: { parameters: [{}] }, options: {}
  },
  credentials: { httpHeaderAuth: { id: "3CNvCGWMMDOyGD2n", name: "EspoCRM Integração n8n — Mayara" } }
}
```
Repetir o padrão pros outros 3 (mesma URL/método/credencial do node atual no draft, só trocando `$fromAI` por `$json.<campo>` e adicionando `onError`).

- [x] **Passo 3: Adicionar o IF de "lead já existe"**
Entre `Buscar Lead por Telefone` e `Criar Lead no CRM`: IF `{{ $json.total > 0 }}` → verdadeiro pula direto pra `Atualizar Status do Lead` (usando `{{ $json.list[0].id }}` como leadId); falso segue pra `Criar Lead no CRM` (usando o `id` retornado por ela como leadId).

- [x] **Passo 4: Adicionar o nó `Enfileirar Retry no CRM`**
Node Postgres, credencial `Supabase — Mayara (Postgres)`:
```sql
select pgmq.send('mayara_crm_retry', $1::jsonb);
```
com `$1` = JSON.stringify de todos os campos de entrada do trigger (o mesmo payload recebido, repassado inteiro — reprocessar do zero, como decidido no spec).

- [x] **Passo 5: Conectar as saídas de erro dos 4 nós HTTP em `Enfileirar Retry no CRM`**
```javascript
n8n_update_partial_workflow({
  id: "<id do novo sub-workflow>",
  operations: [
    { type: "addConnection", source: "Buscar Lead por Telefone", target: "Enfileirar Retry no CRM", sourceOutput: "main", sourceIndex: 1 },
    { type: "addConnection", source: "Criar Lead no CRM", target: "Enfileirar Retry no CRM", sourceOutput: "main", sourceIndex: 1 },
    { type: "addConnection", source: "Atualizar Status do Lead", target: "Enfileirar Retry no CRM", sourceOutput: "main", sourceIndex: 1 },
    { type: "addConnection", source: "Criar Consulta no CRM", target: "Enfileirar Retry no CRM", sourceOutput: "main", sourceIndex: 1 }
  ]
})
```

- [x] **Passo 6: Validar**
`validate_workflow` (0 erros) + `n8n_get_workflow` conferindo os 4 `onError: continueErrorOutput` e as 4 conexões de erro convergindo em `Enfileirar Retry no CRM`.

- [x] **Passo 7: Testar o caminho de sucesso**
```javascript
n8n_test_workflow({
  workflowId: "<id do sub-workflow>",
  method: "direct",
  data: {
    sessionKey: "PG-MIGRATION-T7-ok", nome: "Teste Subworkflow", telefone: "11977776666",
    email: "teste.subworkflow.mayara@teste.invalid", empresa: "Teste Sub LTDA",
    descricaoLead: "Cartao PJ, Bradesco, 50 mil, so cobranca",
    eventoCalendarioId: "smoke-test-nao-real", horarioInicio: "2026-09-11T10:00:00-03:00", horarioFim: "2026-09-11T11:00:00-03:00"
  }
})
```
Esperado: se o 403 do EspoCRM (achado do relatório da Mayara V2) ainda não tiver sido corrigido, essa chamada vai falhar em `Criar Lead no CRM` — **esperado e correto**: confirmar que a mensagem caiu em `mayara_crm_retry` (Passo 8) em vez de considerar isso uma falha do teste.

- [x] **Passo 8: Testar o caminho de falha (fila)**
```sql
select * from pgmq.read('mayara_crm_retry', 60, 5);
```
Esperado: mensagem com `sessionKey: "PG-MIGRATION-T7-ok"` presente. Limpar depois: `select pgmq.delete('mayara_crm_retry', <msg_id>);`

---

### Task 8: Ligar o sub-workflow ao workflow principal e remover as ferramentas antigas

**Files:** workflow `KLdDHFsr1gJhnHkF`.

**Interfaces:**
- Consumes: `Extrair Consulta Criada` (Task 6), sub-workflow da Task 7.
- Produces: draft com persistência de CRM 100% determinística; achado C2 do relatório fechado.

- [x] **Passo 1: Adicionar o IF de ramificação**
Node IF logo após `Extrair Consulta Criada`: condição `{{ $json.consultaCriada === true }}`.

- [x] **Passo 2: Adicionar o nó Execute Workflow (branch verdadeiro)**
```javascript
{
  name: "Persistir Consulta no CRM",
  type: "n8n-nodes-base.executeWorkflow",
  typeVersion: 1.3,
  onError: "continueRegularOutput",
  parameters: {
    workflowId: { value: "<id do sub-workflow da Task 7>" },
    workflowInputs: { mappingMode: "defineBelow", value: {
      sessionKey: "={{ $('Montar Contexto').item.json.sessionId }}",
      nome: "={{ JSON.parse($('Montar Contexto').item.json.fatosJson).nome || JSON.parse($('Montar Contexto').item.json.fatosJson).nome_completo || '' }}",
      telefone: "={{ JSON.parse($('Montar Contexto').item.json.fatosJson).telefone || '' }}",
      email: "={{ JSON.parse($('Montar Contexto').item.json.fatosJson).email || '' }}",
      empresa: "={{ JSON.parse($('Montar Contexto').item.json.fatosJson).empresa || '' }}",
      descricaoLead: "={{ (() => { const f = JSON.parse($('Montar Contexto').item.json.fatosJson); return [f.tipo_divida, f.banco, f.valor_aproximado, f.situacao].filter(Boolean).join(', '); })() }}",
      eventoCalendarioId: "={{ $json.eventoCalendarioId }}",
      horarioInicio: "={{ $json.horarioInicio }}",
      horarioFim: "={{ $json.horarioFim }}"
    }, matchingColumns: [] },
    options: { waitForSubWorkflow: true }
  }
}
```

- [x] **Passo 3: Conectar IF → Execute Workflow (branch true) e IF → segue direto (branch false)**
Branch falso conecta direto em `Call 'Logging IA - Mayara (Fail-Open)'2` (o próximo passo que já existia antes desta mudança), igual ao branch verdadeiro depois de terminar o Execute Workflow.

- [x] **Passo 4: Remover os 4 nós de CRM antigos do AI Agent**
```javascript
n8n_update_partial_workflow({
  id: "KLdDHFsr1gJhnHkF",
  operations: [
    { type: "removeNode", nodeName: "Criar Lead no CRM" },
    { type: "removeNode", nodeName: "Buscar Lead por Telefone" },
    { type: "removeNode", nodeName: "Atualizar Status do Lead" },
    { type: "removeNode", nodeName: "Criar Consulta no CRM" }
  ]
})
```

- [x] **Passo 5: Atualizar o system prompt do AI Agent**
Remover a seção inteira `VOCÊ TEM ACESSO REAL AO CRM (EspoCRM)` e `REGISTRO DE CONSULTA NO CRM É OBRIGATÓRIO...` (ficou obsoleta — o agente não tem mais essas ferramentas). Substituir por uma nota curta:
```
REGISTRO NO CRM
Você não precisa fazer nada manualmente pra registrar a consulta no CRM — isso acontece automaticamente, fora da sua responsabilidade, assim que você criar o evento de verdade na agenda com sucesso.
```
Usar `patchNodeField` no campo `parameters.options.systemMessage` pra essa edição cirúrgica, em vez de reescrever o prompt inteiro.

- [x] **Passo 6: Validar e verificar**
`validate_workflow` (0 erros, sem referência aos 4 nós removidos) + `n8n_get_workflow` confirmando: AI Agent só tem 3 tools (`Salvar Estado da Conversa`, `Verificar Disponibilidade na Agenda`, `Create an event in Google Calendar`); novo bloco IF → Execute Workflow conectado corretamente.

- [x] **Passo 7: Teste de ponta a ponta (fluxo feliz determinístico)**
```javascript
n8n_test_workflow({
  workflowId: "9dMnpX51XMG57O1l",
  method: "trigger", triggerType: "webhook", httpMethod: "POST",
  data: { sessionId: "PG-MIGRATION-T8-full", message: "Meu nome e Roberto Final, empresa Final Fix LTDA, telefone 11955554444, email roberto.final.mayara@teste.invalid, divida de emprestimo com o Santander uns 90 mil, so cobranca" }
})
n8n_test_workflow({
  workflowId: "9dMnpX51XMG57O1l",
  method: "trigger", triggerType: "webhook", httpMethod: "POST",
  data: { sessionId: "PG-MIGRATION-T8-full", message: "quero marcar pra sexta as 11h" }
})
```
Confirmar via `n8n_executions` que `Extrair Consulta Criada` → IF (true) → `Persistir Consulta no CRM` rodou, **sem que o AI Agent tenha chamado nenhuma ferramenta de CRM** (elas nem existem mais nele). Se o 403 do EspoCRM ainda não tiver sido corrigido: confirmar que a mensagem foi enfileirada em `mayara_crm_retry` em vez de simplesmente desaparecer.

---

### Task 9: Criar o workflow worker `Mayara — Retry CRM Falhas [Worker]`

**Files:** novo workflow n8n.

**Interfaces:**
- Consumes: fila `mayara_crm_retry` (Task 3), sub-workflow da Task 7, tabela `mayara.crm_retry_failed` (Task 2).
- Produces: workflow ativo, agendado, que drena a fila de forma autônoma.

- [x] **Passo 1: Criar o workflow**
```javascript
n8n_create_workflow({
  name: "Mayara — Retry CRM Falhas [Worker]",
  nodes: [{
    name: "Schedule Trigger",
    type: "n8n-nodes-base.scheduleTrigger",
    typeVersion: 1.2,
    parameters: { rule: { interval: [{ field: "minutes", minutesInterval: 5 }] } }
  }],
  connections: {}
})
```

- [x] **Passo 2: Adicionar o nó de leitura da fila**
Node Postgres, credencial `Supabase — Mayara (Postgres)`:
```sql
select * from pgmq.read('mayara_crm_retry', 60, 10);
```

- [x] **Passo 3: Adicionar o Execute Workflow por item**
Chama o sub-workflow da Task 7 — execução por item já é automática no n8n (sem precisar de Loop Over Items). `pgmq.read` retorna o payload aninhado na coluna `message`, então o mapeamento de cada input precisa ler dali, não da raiz do item:
```javascript
workflowInputs: { mappingMode: "defineBelow", value: {
  sessionKey: "={{ $json.message.sessionKey }}",
  nome: "={{ $json.message.nome }}",
  telefone: "={{ $json.message.telefone }}",
  email: "={{ $json.message.email }}",
  empresa: "={{ $json.message.empresa }}",
  descricaoLead: "={{ $json.message.descricaoLead }}",
  eventoCalendarioId: "={{ $json.message.eventoCalendarioId }}",
  horarioInicio: "={{ $json.message.horarioInicio }}",
  horarioFim: "={{ $json.message.horarioFim }}"
}, matchingColumns: [] }
```
Guardar também `{{ $json.msg_id }}` e `{{ $json.read_ct }}` (via um nó Set logo antes, ou referenciando o nó de leitura por nome mais adiante) — os Passos 5 e 6 precisam desses dois valores depois que o Execute Workflow já rodou.

- [x] **Passo 4: Adicionar o IF de sucesso/falha**
Baseado no `$json.error` presente ou não na saída do Execute Workflow (via `Enfileirar Retry no CRM` só rodar de novo no sub-workflow se falhar de novo — ou seja, se o Execute Workflow retornar sem erro real de negócio, considerar sucesso).

- [x] **Passo 5: Nó de sucesso — apagar da fila**
```sql
select pgmq.delete('mayara_crm_retry', $1);
```
com `$1` = `{{ $json.msg_id }}` do item lido no Passo 2.

- [x] **Passo 6: Nó de falha — checar `read_ct`**
IF `{{ $json.read_ct > 5 }}` → verdadeiro: INSERT em `mayara.crm_retry_failed` (`payload`, `motivo_falha`, `tentativas`) + `select pgmq.archive('mayara_crm_retry', $1);`. Falso: não faz nada (deixa a mensagem, ela volta a ficar visível quando o `vt` expirar).

- [x] **Passo 7: Validar**
`validate_workflow` (0 erros).

- [x] **Passo 8: Testar manualmente**
Reenfileirar a mensagem de teste que ficou pendente da Task 7 (ou enviar uma nova via `pgmq.send`), então rodar:
```javascript
n8n_test_workflow({ workflowId: "<id do worker>", method: "direct" })
```
Confirmar via SQL (`select * from pgmq.read('mayara_crm_retry', 1, 10);`) que a fila esvaziou (sucesso) ou que a mensagem foi movida pra `mayara.crm_retry_failed` depois de simular >5 tentativas.

- [x] **Passo 9: Ativar o workflow**
```javascript
n8n_update_partial_workflow({ id: "<id do worker>", operations: [{ type: "activateWorkflow" }] })
```

---

### Task 10: Regressão completa e limpeza

**Files:** `RELATORIO_MAYARA_V2_TESTES_PENDENTES.md` (append).

**Interfaces:**
- Consumes: todas as tasks anteriores.
- Produces: confirmação de que nada regrediu, relatório atualizado.

- [x] **Passo 1: Re-rodar os testes já aprovados**
Reexecutar T14, T25, T26, T27, T21, T15–T20, T28–T30 e Cenários A–E (sessionIds novos, ex. sufixo `-pg-final`) contra o draft já migrado, comparando com os resultados já documentados no relatório — confirmar que nenhum comportamento conversacional regrediu com a troca de armazenamento.

- [x] **Passo 2: Confirmar achado C2 fechado**
Repetir o teste do achado C2 original (fluxo completo de agendamento) e confirmar no relatório que agora **sempre** persiste no CRM (ou cai de forma visível na fila/`crm_retry_failed`, nunca silenciosamente).

- [x] **Passo 3: Limpeza**
- Apagar eventos reais de teste criados no Google Calendar durante as Tasks 6–10.
- Conferir Leads/Meetings de teste no EspoCRM (e-mails `*.teste.invalid` / `*.mayara@teste.invalid`) e remover.
- Limpar linhas de teste em `mayara.session_state`, `mayara.bridge_responses`, `mayara.crm_retry_failed` (sessionKeys `PG-MIGRATION-*`).

- [x] **Passo 4: Atualizar o relatório**
Adicionar seção "Fundação de dados em Supabase — concluída" no `RELATORIO_MAYARA_V2_TESTES_PENDENTES.md`, com data, resumo do que mudou, e status final dos achados C1/C2/C3 (C2 agora resolvido de forma estrutural, não só por regra de prompt).

- [x] **Passo 5: Commit**
```bash
git add RELATORIO_MAYARA_V2_TESTES_PENDENTES.md
git commit -m "docs: registra conclusão da fundação de dados em Supabase para a Mayara"
```

---

## IDs de referência entre tasks

- Sub-workflow `Mayara — Persistir Consulta no CRM [Sub-workflow]`: id `vf3iq6V7ztgsQS8G` (ativo) — usado pela Task 8 (Execute Workflow no draft principal) e Task 9 (worker de retry). **Redesenhado na Task 9:** ganhou um 10º input `isRetry` (boolean) — quando `true` (chamada do worker), uma falha NÃO reenfileira de novo (evitaria perder o `read_ct`/histórico de tentativas da mensagem original); quando `false`/ausente (chamada do draft principal), falha enfileira normalmente. Saída normalizada: `{success: true}` no sucesso, `{success: false, enfileirado: true|false}` na falha.
- Worker `Mayara — Retry CRM Falhas [Worker]`: id `Ikub97vZp1Pi9aCv` (ativo, Schedule Trigger a cada 5 min).
- **Achado da Task 9:** `Execute Workflow` node no modo padrão (`mode: "once"`) roda uma vez com TODOS os itens de entrada, usando só o primeiro item pro mapeamento — precisa `mode: "each"` explícito pra rodar uma vez por item da fila.
- **Achado da Task 9:** `pgmq.archive`/`pgmq.delete` chamados via query parametrizada do node Postgres (`$1` sem cast) dão erro "function is not unique" (múltiplos overloads, tipo `unknown` ambíguo) — sempre castar explicitamente: `$1::bigint`.
- **Achado da Task 9 (bug de n8n-mcp):** `n8n_update_partial_workflow` com `[addNode, addConnection, activateWorkflow]` no mesmo lote quebra (`Cannot read properties of undefined (reading 'map')`); funciona normalmente se `activateWorkflow` for uma chamada separada. Reportado como feedback de produto.

---

## Eventos reais de teste pendentes de limpeza (Task 10, Passo 3)

- `hgodijk913tpi3o8qurji56u4o` — sexta-feira 11/09/2026 14h-15h, "Verificacao Extracao" (Task 6)
- `tcr1vllu0b2okh1723ordjfokg` — sexta-feira 11/09/2026 10h-11h, "Teste Extracao" (Task 6)
- `brcllu86c60jrk44lfrjmurp9g` — quinta-feira 10/09/2026 10h-11h, "Roberto Final" (Task 8)

---

## Nota final

Este plano **não** troca a Ponte de produção para apontar pro draft — isso continua exigindo aprovação explícita separada, conforme já estabelecido. O erro 403 do EspoCRM (achado do relatório) também não é corrigido por este plano — ele é a causa que a fila de retry (Tasks 3, 7, 9) foi desenhada pra absorver, mas a correção da permissão em si é ação separada, do lado do EspoCRM.
