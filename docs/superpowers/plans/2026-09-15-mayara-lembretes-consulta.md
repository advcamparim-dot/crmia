# Mayara — Lembretes de Consulta Agendada Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Depois que uma consulta é confirmada (`S6_AGENDADO`), mandar automaticamente 3 lembretes (T-1dia, T-1h, T-15min) e, no último, encerrar definitivamente a automação da Mayara para aquele lead — sem depender do LLM lembrar de nada.

**Architecture:** Um novo campo determinístico (`consulta_agendada_em`) gravado no Núcleo no exato momento em que uma consulta é confirmada de verdade (mesmo padrão já usado para `last_lead_message_at`). Um único worker agendado (`Mayara — Lembretes de Consulta [Worker]`), rodando a cada 5 minutos, reserva atomicamente os leads cujo horário da consulta cruzou um dos 3 limiares, calcula qual é o estágio mais urgente ainda não enviado (nunca o mais antigo, para não mandar "amanhã" 10 minutos antes de uma janela perdida), monta o template certo e envia via Graph API. O terceiro lembrete marca `follow_up_status = 'transferido_consulta'`, que passa a excluir esse lead de qualquer worker automático futuro.

**Tech Stack:** n8n (remoto, `https://n8n.camparimadvogados.com.br`), n8n-mcp, Supabase Postgres (projeto `crmia-mayara`, id `wuhvlvsolewslkawazlq`), Meta WhatsApp Cloud API (Graph API, mensagens de template).

**Spec:** `docs/superpowers/specs/2026-09-10-mayara-followup-funil-design.md` (seção "Lembretes de consulta agendada (T-1dia / T-1h / T-15min)").

## Global Constraints

- Nunca usar `localhost` para n8n/EspoCRM/Supabase — tudo remoto.
- Nunca colar segredos (tokens, senhas) em arquivos versionáveis ou texto de resposta.
- Node Postgres nesta instância n8n: **sempre `typeVersion: 2.6`** (2.7 quebra execução, achado já registrado no plano da fundação de dados).
- Ler `jsonb` via Postgres sempre com `::text` quando o valor for usado como string em outro node (evita `[object Object]`, achado real já confirmado em produção nesta mesma automação).
- Credencial Postgres no n8n já existe, nome real (confirmado ao vivo, **não** é o nome do spec original): `Postgres account`, id `nNpCUIhnDuVvTApU`.
- Credencial WhatsApp Graph API já existe: tipo `httpBearerAuth`, nome `Bearer Auth account`, id `SChAKcHay4ghJVwe`. Endpoint base: `https://graph.facebook.com/v25.0/{{phoneNumberId}}/messages`.
- `phoneNumberId` real do negócio: `1365007506685934`.
- `session_key` tem o formato `whatsapp:{phoneNumberId}:{telefone}` (telefone no formato `+55DDDNNNNNNNNN`).
- Toda query Postgres que usa `FOR UPDATE SKIP LOCKED` + `UPDATE ... RETURNING` numa CTE é o padrão já estabelecido nesta automação para reserva atômica (worker de follow-up "sumiu no meio") — seguir o mesmo padrão aqui, não inventar outro.
- **Bloqueio externo real, não contornável por este plano:** os 3 templates de lembrete (`lembrete_consulta_1dia`, `lembrete_consulta_1hora`, `lembrete_consulta_transferencia`) ainda não foram submetidos/aprovados pela Meta. O envio real só funciona depois da aprovação — este plano constrói e testa o pipeline inteiro até a chamada da Graph API; a chamada em si vai falhar (template inexistente) até lá, e isso é esperado, não um bug do pipeline (mesmo padrão já usado com o erro 403 do EspoCRM no plano da fundação de dados).
- Antes de qualquer ação n8n, invocar `n8n-mcp-skills:using-n8n-mcp-skills` se ainda não tiver sido invocada nesta sessão.
- Validar (`n8n_validate_workflow`) e inspecionar `connections` via `n8n_get_workflow` depois de toda edição de workflow.
- Só o draft `Mayara — Núcleo do Agente [DRAFT V2]` (id `KLdDHFsr1gJhnHkF`) é tocado no Núcleo — a Ponte de produção não muda.

---

### Task 1: Migration — colunas de lembrete de consulta

**Files:**
- Create: `supabase/migrations/0006_mayara_lembretes_consulta.sql`

**Interfaces:**
- Consumes: tabela `mayara.session_state` (já existe, ver `supabase/migrations/0001_mayara_schema.sql` + `0004_mayara_followup_funil.sql`).
- Produces: colunas `consulta_agendada_em`, `lembrete_consulta_estagio`, e o valor `'transferido_consulta'` habilitado em `follow_up_status` — consumidas pelas Tasks 2 e 3.

- [ ] **Passo 1: Escrever a migration**

```sql
-- supabase/migrations/0006_mayara_lembretes_consulta.sql
alter table mayara.session_state
  add column if not exists consulta_agendada_em timestamptz,
  add column if not exists lembrete_consulta_estagio text not null default 'nenhum';

alter table mayara.session_state
  add constraint lembrete_consulta_estagio_check
  check (lembrete_consulta_estagio in ('nenhum', '1dia', '1h', '15min'));

alter table mayara.session_state
  drop constraint if exists session_state_follow_up_status_check;

alter table mayara.session_state
  add constraint session_state_follow_up_status_check
  check (follow_up_status in (
    'ativo', 'resolvido_continua', 'resolvido_sem_interesse',
    'pausado_humano', 'excluido_seguranca', 'dormente', 'transferido_consulta'
  ));

create index if not exists idx_session_state_lembretes
  on mayara.session_state (consulta_agendada_em)
  where estado = 'S6_AGENDADO' and lembrete_consulta_estagio <> '15min';
```

- [ ] **Passo 2: Confirmar o nome real da constraint de `follow_up_status` antes de aplicar**

Antes de rodar o `drop constraint`, confirmar o nome real (pode não ser `session_state_follow_up_status_check` — nome depende de como foi criada originalmente):
```sql
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'mayara.session_state'::regclass and contype = 'c';
```
Ajustar o `drop constraint if exists <nome real>` no Passo 1 antes de aplicar, se o nome vier diferente.

- [ ] **Passo 3: Aplicar via Supabase MCP**
```
mcp__plugin_supabase_supabase__apply_migration({
  project_id: "wuhvlvsolewslkawazlq",
  name: "mayara_lembretes_consulta",
  query: "<conteúdo do arquivo>"
})
```

- [ ] **Passo 4: Testar manualmente**
```sql
insert into mayara.session_state (session_key, estado, consulta_agendada_em)
values ('smoke-lembretes', 'S6_AGENDADO', now() + interval '2 hours')
on conflict (session_key) do update set estado = 'S6_AGENDADO', consulta_agendada_em = now() + interval '2 hours';

update mayara.session_state set follow_up_status = 'transferido_consulta' where session_key = 'smoke-lembretes';
-- esperado: sem erro (valor novo aceito pela constraint)

update mayara.session_state set lembrete_consulta_estagio = 'nunca-existiu' where session_key = 'smoke-lembretes';
-- esperado: erro de check constraint (valor inválido rejeitado)

delete from mayara.session_state where session_key = 'smoke-lembretes';
```

- [ ] **Passo 5: Commit**
```bash
git add supabase/migrations/0006_mayara_lembretes_consulta.sql
git commit -m "feat(supabase): colunas de lembrete de consulta e estado transferido_consulta

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Gravar `consulta_agendada_em` no Núcleo quando a consulta é confirmada

**Files:** workflow n8n `Mayara — Núcleo do Agente [DRAFT V2]` (id `KLdDHFsr1gJhnHkF`) — editado via n8n-mcp, sem arquivo local.

**Interfaces:**
- Consumes: nó `Persistir Consulta no CRM` (existente, id `37431e63-f21c-46ab-a7c8-ccdcde5eafaf`), nó `Extrair Consulta Criada` (existente, produz `horarioInicio` no formato ISO), nó `Montar Contexto` (produz `sessionId`).
- Produces: `mayara.session_state.consulta_agendada_em` preenchido de forma determinística — consumido pela Task 4 (worker de lembretes).

- [ ] **Passo 1: Confirmar a cadeia atual ao vivo antes de editar**
```javascript
n8n_get_workflow({ id: "KLdDHFsr1gJhnHkF", mode: "structure" })
```
Confirmar que a conexão `Persistir Consulta no CRM → Call 'Logging IA - Mayara (Fail-Open)'2` ainda existe exatamente assim (confirmado nesta sessão, mas o workflow pode ter mudado desde então).

- [ ] **Passo 2: Adicionar o novo nó `Registrar Consulta Agendada`**
```javascript
n8n_update_partial_workflow({
  id: "KLdDHFsr1gJhnHkF",
  operations: [{
    type: "addNode",
    node: {
      name: "Registrar Consulta Agendada",
      type: "n8n-nodes-base.postgres",
      typeVersion: 2.6,
      position: [2320, 700],
      onError: "continueRegularOutput",
      parameters: {
        operation: "executeQuery",
        query: "update mayara.session_state set consulta_agendada_em = $2::timestamptz where session_key = $1;",
        options: {
          queryReplacement: "={{ [$('Montar Contexto').item.json.sessionId, $('Extrair Consulta Criada').item.json.horarioInicio] }}"
        }
      },
      credentials: {
        postgres: { id: "nNpCUIhnDuVvTApU", name: "Postgres account" }
      }
    }
  }]
})
```

- [ ] **Passo 3: Reconectar em série entre `Persistir Consulta no CRM` e `Call 'Logging IA - Mayara (Fail-Open)'2`**

Este ponto do workflow fica **depois** do `AI Agent` — os nodes seguintes (`Preparar Retorno para Ponte`, etc.) já leem tudo por lookup nomeado (`$('Guardrail - Bloquear Opiniao Juridica').item.json...`), não pelo `$json` encadeado do node anterior. Diferente do achado da Task de debounce (que quebrou a Simple Memory antes do AI Agent), inserir um node Postgres em série **aqui** é seguro.

```javascript
n8n_update_partial_workflow({
  id: "KLdDHFsr1gJhnHkF",
  operations: [
    { type: "removeConnection", source: "Persistir Consulta no CRM", target: "Call 'Logging IA - Mayara (Fail-Open)'2" },
    { type: "addConnection", source: "Persistir Consulta no CRM", target: "Registrar Consulta Agendada", sourceOutput: "main" },
    { type: "addConnection", source: "Registrar Consulta Agendada", target: "Call 'Logging IA - Mayara (Fail-Open)'2", sourceOutput: "main" }
  ]
})
```

- [ ] **Passo 4: Validar**
```javascript
n8n_validate_workflow({ id: "KLdDHFsr1gJhnHkF" })
```
Esperado: 0 erros.

- [ ] **Passo 5: Verificar conexões**
```javascript
n8n_get_workflow({ id: "KLdDHFsr1gJhnHkF", mode: "structure" })
```
Confirmar: `Persistir Consulta no CRM → Registrar Consulta Agendada → Call 'Logging IA - Mayara (Fail-Open)'2`, e que o branch falso de `Consulta Criada?` continua indo direto pro Fail-Open sem passar por `Registrar Consulta Agendada`.

- [ ] **Passo 6: Testar de ponta a ponta**
```javascript
n8n_test_workflow({
  workflowId: "9dMnpX51XMG57O1l",
  method: "trigger", triggerType: "webhook", httpMethod: "POST",
  data: { sessionId: "LEMBRETE-T2-nome-real", message: "Meu nome e Carla Lembretes, empresa Lembretes LTDA, telefone 11966665555, email carla.lembretes.mayara@teste.invalid, divida de cartao PJ com o Itau uns 60 mil, so cobranca" }
})
n8n_test_workflow({
  workflowId: "9dMnpX51XMG57O1l",
  method: "trigger", triggerType: "webhook", httpMethod: "POST",
  data: { sessionId: "LEMBRETE-T2-nome-real", message: "quero marcar pra sexta as 10h" }
})
```
Depois, no SQL Editor do Supabase (ou `execute_sql`):
```sql
select session_key, estado, consulta_agendada_em from mayara.session_state
where session_key like 'whatsapp:%LEMBRETE-T2-nome-real%' or session_key = 'LEMBRETE-T2-nome-real';
```
(O harness de teste usa `sessionId` cru como `session_key`, não o formato `whatsapp:...` — confirmar qual das duas formas aparece de fato antes de escrever o filtro final.)
Esperado: `consulta_agendada_em` preenchido com o horário real confirmado pela ferramenta de agendamento (mesmo valor de `horarioInicio` que apareceu na mensagem de confirmação ao cliente).

- [ ] **Passo 7: Limpeza do evento real de teste**
Anotar o ID do evento real criado no Google Calendar durante o Passo 6 (via `n8n_executions` no node `Agendar Consulta`) para apagar manualmente ao final do plano (Task 6).

---

### Task 3: Criar o worker `Mayara — Lembretes de Consulta [Worker]`

**Files:** novo workflow n8n (via `n8n_create_workflow`).

**Interfaces:**
- Consumes: `mayara.session_state.consulta_agendada_em`/`lembrete_consulta_estagio` (Task 1), credencial `Postgres account`, credencial `Bearer Auth account`.
- Produces: workflow ativo, agendado a cada 5 minutos, que envia os 3 lembretes na ordem certa e nunca duplica.

- [ ] **Passo 1: Criar o workflow com o Schedule Trigger + Webhook de teste**
```javascript
n8n_create_workflow({
  name: "Mayara — Lembretes de Consulta [Worker]",
  nodes: [
    {
      name: "Agendamento Horario",
      type: "n8n-nodes-base.scheduleTrigger",
      typeVersion: 1.2,
      position: [0, 0],
      parameters: { rule: { interval: [{ field: "minutes", minutesInterval: 5 }] } }
    },
    {
      name: "Teste Manual (Webhook)",
      type: "n8n-nodes-base.webhook",
      typeVersion: 2.1,
      position: [0, 200],
      parameters: { httpMethod: "POST", path: "lembretes-consulta-teste", options: {} }
    },
    {
      name: "Segredo de Teste OK?",
      type: "n8n-nodes-base.if",
      typeVersion: 2.2,
      position: [220, 200],
      parameters: {
        conditions: {
          options: { version: 2, leftValue: "", caseSensitive: true, typeValidation: "strict" },
          combinator: "and",
          conditions: [{
            leftValue: "={{ $json.headers['x-test-secret'] }}",
            rightValue: "<GERAR_SEGREDO_NOVO_AQUI>",
            operator: { type: "string", operation: "equals" },
            id: "sc1"
          }]
        },
        options: {}
      }
    }
  ],
  connections: {
    "Teste Manual (Webhook)": { main: [[{ node: "Segredo de Teste OK?", type: "main", index: 0 }]] }
  }
})
```
No Passo 1, gerar um segredo novo (não reaproveitar o segredo do worker "Sumiu no Meio" — cada webhook de teste deve ter o seu). Gerar com `openssl rand -hex 16` localmente e colar só na configuração do node (nunca em texto de resposta ou arquivo versionado).

- [ ] **Passo 2: Adicionar o nó de reserva atômica (a peça central)**
```javascript
n8n_update_partial_workflow({
  id: "<id do worker>",
  operations: [{
    type: "addNode",
    node: {
      name: "Buscar e Reservar Lembretes",
      type: "n8n-nodes-base.postgres",
      typeVersion: 2.6,
      position: [440, 0],
      onError: "continueRegularOutput",
      parameters: {
        operation: "executeQuery",
        query: "with elegivel as (\n  select session_key,\n    case\n      when now() >= consulta_agendada_em - interval '15 minutes' and lembrete_consulta_estagio <> '15min' then '15min'\n      when now() >= consulta_agendada_em - interval '1 hour' and lembrete_consulta_estagio not in ('1h', '15min') then '1h'\n      when now() >= consulta_agendada_em - interval '1 day' and lembrete_consulta_estagio = 'nenhum' then '1dia'\n      else null\n    end as proximo_estagio\n  from mayara.session_state\n  where estado = 'S6_AGENDADO'\n    and follow_up_status not in ('excluido_seguranca')\n    and consulta_agendada_em is not null\n    and consulta_agendada_em > now()\n    and lembrete_consulta_estagio <> '15min'\n  for update skip locked\n)\nupdate mayara.session_state s\nset lembrete_consulta_estagio = e.proximo_estagio,\n    follow_up_status = case when e.proximo_estagio = '15min' then 'transferido_consulta' else s.follow_up_status end\nfrom elegivel e\nwhere s.session_key = e.session_key\n  and e.proximo_estagio is not null\nreturning s.session_key, s.phone, s.phone_number_id, s.estado, s.fatos_json::text as \"fatosJson\", s.consulta_agendada_em, e.proximo_estagio;",
        options: {}
      },
      credentials: { postgres: { id: "nNpCUIhnDuVvTApU", name: "Postgres account" } }
    }
  }]
})
```

**Nota de design (por que a ordem do `CASE` importa):** os `WHEN` checam do estágio mais urgente (15min) para o menos urgente (1dia). Se o worker ficar fora do ar e perder o limiar de 1 dia inteiro, ele nunca vai mandar "sua consulta é amanhã" quando na verdade faltam 10 minutos — sempre pula direto pro lembrete correto do momento real. Isso é intencional, não um bug.

- [ ] **Passo 3: Adicionar `Reserva Valida?` (IF)**
```javascript
{
  name: "Reserva Valida?",
  type: "n8n-nodes-base.if",
  typeVersion: 2.2,
  position: [660, 0],
  parameters: {
    conditions: {
      options: { version: 2, leftValue: "", caseSensitive: true, typeValidation: "loose" },
      combinator: "and",
      conditions: [
        { leftValue: "={{ $json.session_key }}", rightValue: "", operator: { type: "string", operation: "notEmpty" }, id: "v1" },
        { leftValue: "={{ $json.phone }}", rightValue: "", operator: { type: "string", operation: "notEmpty" }, id: "v2" }
      ]
    },
    options: {}
  }
}
```

- [ ] **Passo 4: Adicionar `Montar Template do Lembrete` (Set/Code) — decide nome do template e variáveis**
```javascript
{
  name: "Montar Template do Lembrete",
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position: [880, 0],
  parameters: {
    jsCode: `const item = $input.first().json;\nconst fatos = JSON.parse(item.fatosJson || '{}');\nconst nome = (fatos.nomeCompleto || fatos.nome || '').split(' ')[0] || 'tudo bem';\nconst dataHora = new Date(item.consulta_agendada_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });\nconst horaCurta = new Date(item.consulta_agendada_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });\n\nconst templates = {\n  '1dia': { nome: 'lembrete_consulta_1dia', variaveis: [nome, dataHora, horaCurta] },\n  '1h':   { nome: 'lembrete_consulta_1hora', variaveis: [nome, horaCurta] },\n  '15min':{ nome: 'lembrete_consulta_transferencia', variaveis: [nome] }\n};\n\nconst escolhido = templates[item.proximo_estagio];\nif (!escolhido) {\n  return [{ json: { ...item, templateValido: false } }];\n}\n\nreturn [{ json: { ...item, templateValido: true, templateNome: escolhido.nome, templateVariaveis: escolhido.variaveis } }];`
  }
}
```
(Ajustar os textos/variáveis exatas depois que os templates forem de fato aprovados pela Meta — o número e a ordem de `{{n}}` no template aprovado precisam bater exatamente com `templateVariaveis`; conferir no Business Manager antes de ligar isso em produção.)

- [ ] **Passo 5: Adicionar `Template Valido?` (IF)**
```javascript
{
  name: "Template Valido?",
  type: "n8n-nodes-base.if",
  typeVersion: 2.2,
  position: [1100, 0],
  parameters: {
    conditions: {
      options: { version: 2, leftValue: "", caseSensitive: true, typeValidation: "loose" },
      combinator: "and",
      conditions: [{ leftValue: "={{ $json.templateValido }}", rightValue: true, operator: { type: "boolean", operation: "true", singleValue: true }, id: "t1" }]
    },
    options: {}
  }
}
```

- [ ] **Passo 6: Adicionar `Enviar Lembrete via Graph API`**
```javascript
{
  name: "Enviar Lembrete via Graph API",
  type: "n8n-nodes-base.httpRequest",
  typeVersion: 4.4,
  position: [1320, 0],
  onError: "continueRegularOutput",
  parameters: {
    method: "POST",
    url: "=https://graph.facebook.com/v25.0/{{ $json.phone_number_id }}/messages",
    authentication: "genericCredentialType",
    genericAuthType: "httpBearerAuth",
    sendBody: true,
    specifyBody: "json",
    jsonBody: "={{ JSON.stringify({ messaging_product: 'whatsapp', to: $json.phone.replace(/\\D/g, ''), type: 'template', template: { name: $json.templateNome, language: { code: 'pt_BR' }, components: [{ type: 'body', parameters: $json.templateVariaveis.map(v => ({ type: 'text', text: String(v) })) }] } }) }}",
    options: { timeout: 25000 }
  },
  credentials: { httpBearerAuth: { id: "SChAKcHay4ghJVwe", name: "Bearer Auth account" } }
}
```

- [ ] **Passo 7: Conectar tudo**
```javascript
n8n_update_partial_workflow({
  id: "<id do worker>",
  operations: [
    { type: "addConnection", source: "Agendamento Horario", target: "Buscar e Reservar Lembretes", sourceOutput: "main" },
    { type: "addConnection", source: "Segredo de Teste OK?", target: "Buscar e Reservar Lembretes", sourceOutput: "main", sourceIndex: 0 },
    { type: "addConnection", source: "Buscar e Reservar Lembretes", target: "Reserva Valida?", sourceOutput: "main" },
    { type: "addConnection", source: "Reserva Valida?", target: "Montar Template do Lembrete", sourceOutput: "main", sourceIndex: 0 },
    { type: "addConnection", source: "Montar Template do Lembrete", target: "Template Valido?", sourceOutput: "main" },
    { type: "addConnection", source: "Template Valido?", target: "Enviar Lembrete via Graph API", sourceOutput: "main", sourceIndex: 0 }
  ]
})
```

- [ ] **Passo 8: Validar**
```javascript
n8n_validate_workflow({ id: "<id do worker>" })
```
Esperado: 0 erros.

- [ ] **Passo 9: Testar os 3 estágios manualmente, um de cada vez**

Criar 3 sessões de teste com `consulta_agendada_em` já dentro de cada janela, via `execute_sql`:
```sql
insert into mayara.session_state (session_key, estado, phone, phone_number_id, consulta_agendada_em, lembrete_consulta_estagio, fatos_json)
values
  ('LEMBRETE-TESTE-1dia', 'S6_AGENDADO', '+5514999990001', '1365007506685934', now() + interval '23 hours', 'nenhum', '{"nomeCompleto":"Teste UmDia"}'::jsonb),
  ('LEMBRETE-TESTE-1h',   'S6_AGENDADO', '+5514999990002', '1365007506685934', now() + interval '50 minutes', '1dia', '{"nomeCompleto":"Teste UmaHora"}'::jsonb),
  ('LEMBRETE-TESTE-15min','S6_AGENDADO', '+5514999990003', '1365007506685934', now() + interval '10 minutes', '1h', '{"nomeCompleto":"Teste QuinzeMin"}'::jsonb);
```
Depois:
```javascript
n8n_test_workflow({ workflowId: "<id do worker>", method: "trigger", triggerType: "webhook", httpMethod: "POST", data: {}, headers: { "x-test-secret": "<segredo do Passo 1>" } })
```
Verificar via SQL:
```sql
select session_key, lembrete_consulta_estagio, follow_up_status from mayara.session_state where session_key like 'LEMBRETE-TESTE-%';
```
Esperado: `1dia → estagio='1dia'`, `1h → estagio='1h'`, `15min → estagio='15min'` e `follow_up_status='transferido_consulta'` só na terceira. O envio real via Graph API deve **falhar** (template não existe ainda na Meta) — confirmar via `n8n_executions` que a falha ocorreu exatamente no node `Enviar Lembrete via Graph API` (não antes), o que confirma que o resto do pipeline (reserva, decisão de estágio, montagem do payload) está correto.

- [ ] **Passo 10: Rodar de novo imediatamente e confirmar que não duplica**
```javascript
n8n_test_workflow({ workflowId: "<id do worker>", method: "trigger", triggerType: "webhook", httpMethod: "POST", data: {}, headers: { "x-test-secret": "<segredo do Passo 1>" } })
```
```sql
select session_key, lembrete_consulta_estagio from mayara.session_state where session_key like 'LEMBRETE-TESTE-%';
```
Esperado: nenhuma linha muda de estágio de novo (a reserva atômica já marcou o estágio anterior, então a query de elegibilidade não pega mais essas linhas pro mesmo estágio).

- [ ] **Passo 11: Limpeza dos dados de teste**
```sql
delete from mayara.session_state where session_key like 'LEMBRETE-TESTE-%';
```

- [ ] **Passo 12: Ativar o workflow**
```javascript
n8n_update_partial_workflow({ id: "<id do worker>", operations: [{ type: "activateWorkflow" }] })
```
(Ativar mesmo com o envio falhando por template ainda não aprovado — a reserva/estágio funcionam, e "enviar" falhando de forma visível é o comportamento correto até a aprovação, igual ao worker de retry de CRM antes do 403 ser corrigido.)

---

### Task 4: Excluir `transferido_consulta` de outros workers automáticos

**Files:** workflow `Mayara — Follow-up Sumiu no Meio [Worker]` (id `CxlC28G0S3uE8X66`), node `Buscar e Reservar Leads`.

**Interfaces:**
- Consumes: `follow_up_status = 'transferido_consulta'` (Task 1/3).
- Produces: query do worker de follow-up passa a nunca reengajar um lead que já foi transferido pro Dr. Santo.

- [ ] **Passo 1: Ler a query atual**
```javascript
n8n_get_workflow({ id: "CxlC28G0S3uE8X66", mode: "filtered", nodeNames: ["Buscar e Reservar Leads"] })
```

- [ ] **Passo 2: Adicionar a exclusão**
A query já filtra `follow_up_status = 'ativo'` no `WHERE` (confirmado ao vivo nesta sessão) — como `'ativo'` já exclui implicitamente qualquer outro valor de `follow_up_status` (incluindo `'transferido_consulta'`), **nenhuma mudança de código é necessária aqui**. Confirmar isso lendo a cláusula `where` retornada no Passo 1 antes de seguir — só editar se, contra a expectativa, a condição estiver usando `!= 'excluido_seguranca'` (exclusão por lista) em vez de `= 'ativo'` (inclusão por valor único); nesse caso, adicionar `and follow_up_status not in ('excluido_seguranca', 'transferido_consulta')`.

- [ ] **Passo 3: Testar (só se o Passo 2 exigiu mudança)**
Criar uma sessão de teste com `follow_up_status = 'transferido_consulta'` e `last_lead_message_at` antigo o bastante pra cair na janela do worker; rodar o worker manualmente; confirmar que essa sessão **não** foi reservada.

---

### Task 5: Regressão e documentação

**Files:** `docs/superpowers/specs/2026-09-10-mayara-followup-funil-design.md` (append).

**Interfaces:**
- Consumes: todas as tasks anteriores.
- Produces: spec atualizada com o resultado real, pendências claras pra quando os templates forem aprovados.

- [ ] **Passo 1: Re-rodar o teste de agendamento completo (Task 2) e confirmar que nada regrediu**
Repetir T2 do harness com uma nova sessão, confirmar confirmação normal ao cliente + `consulta_agendada_em` gravado.

- [ ] **Passo 2: Confirmar que o worker de lembretes não interfere com o worker de retry de CRM nem o de follow-up**
Rodar os 3 workers manualmente em sequência (`Mayara — Retry CRM Falhas`, `Mayara — Follow-up Sumiu no Meio`, `Mayara — Lembretes de Consulta`) e conferir nas execuções que nenhum afetou dados do outro (cada um só toca sessões com o `estado`/`follow_up_status` que já espera).

- [ ] **Passo 3: Atualizar a spec**
Adicionar seção "Implementado — Lembretes de Consulta (2026-09-15)" com: schema aplicado, worker criado (id), resultado dos testes de estágio, e a pendência explícita de aprovação dos 3 templates na Meta antes do envio real funcionar.

- [ ] **Passo 4: Commit**
```bash
git add docs/superpowers/specs/2026-09-10-mayara-followup-funil-design.md
git commit -m "docs: registra implementação dos lembretes de consulta (T-1dia/1h/15min)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

- [ ] **Passo 5: Limpeza de eventos reais de teste**
Apagar manualmente no Google Calendar o evento anotado na Task 2, Passo 7.

---

## Nota final

Este plano deixa o pipeline inteiro pronto e testado (reserva atômica, decisão de estágio, montagem de payload, estado terminal). A única peça que depende de terceiros é a aprovação dos 3 templates pela Meta — quando isso acontecer, conferir no Business Manager o nome exato, `language.code` e a ordem/quantidade de variáveis de cada template antes de considerar o envio real validado (o texto usado no Passo 4 da Task 3 é o rascunho já proposto na spec, sujeito a ajuste na aprovação).
