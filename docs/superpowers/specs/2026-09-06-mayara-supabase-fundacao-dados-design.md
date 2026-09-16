# Mayara — Fundação de Dados em Supabase (Design)

**Data:** 2026-09-06
**Sub-projeto 1 de 3** (dos 3 identificados no brainstorming: fundação de dados → dashboard de leads → portal/produto novo). Este spec cobre exclusivamente o primeiro.

## Contexto

Hoje a Mayara (agente de IA no n8n, workflow `Mayara — Núcleo do Agente [DRAFT V2]`, id `KLdDHFsr1gJhnHkF`) guarda estado em duas n8n Data Tables:
- `Mayara Estado Sessao` (sessionKey, estado, fatosJson como string)
- `Mayara Respostas Ponte` (sessionKey, output)

E persiste no CRM (EspoCRM) através de 4 ferramentas que o próprio AI Agent decide chamar: `Buscar Lead por Telefone`, `Criar Lead no CRM`, `Atualizar Status do Lead`, `Criar Consulta no CRM`.

Testes registrados em `RELATORIO_MAYARA_V2_TESTES_PENDENTES.md` (achados C1–C3) mostraram que esse desenho tem duas fragilidades:
- **C2:** em 2/2 fluxos completos de agendamento testados, a Mayara confirmou sucesso ao cliente sem que a sequência de CRM tivesse realmente rodado até o fim — porque essa sequência depende do modelo de IA "lembrar" de chamar as 4 ferramentas certas, na ordem certa, toda vez.
- Um erro **403 real e reproduzível** foi encontrado na chamada `Criar Lead no CRM` (a mesma credencial lê Lead com sucesso via GET, mas falha ao criar via POST) — suspeita de ACL/Role afetado pelo incidente de usuários apagados no EspoCRM relatado no início desta sessão. Esse problema é **do lado do EspoCRM** e está fora do escopo deste spec — mas o desenho abaixo precisa tornar o sistema resiliente a esse tipo de falha (transitória ou não) em vez de simplesmente engolir o erro.

n8n Data Tables também são limitadas para qualquer necessidade futura de consulta/relatório (schema simples tipo planilha, sem relações, sem JSONB de verdade).

## Objetivo deste sub-projeto

Migrar o armazenamento de estado da Mayara para Postgres (Supabase), e tornar a persistência no CRM **determinística** (não mais dependente de o LLM decidir chamar ferramentas), com uma fila de retry para absorver falhas reais da API do EspoCRM.

## Fora de escopo (explicitamente, para sub-projetos futuros)

- pgvector / RAG para a Mayara.
- Dashboard de leads/atendimento (sub-projeto 2).
- Portal/produto novo (sub-projeto 3).
- Corrigir a causa raiz do erro 403 no EspoCRM (ação separada, do lado do EspoCRM — ver `RELATORIO_MAYARA_V2_TESTES_PENDENTES.md`).
- Migração de dados históricos das Data Tables atuais — decidido começar do zero (linhas existentes são majoritariamente sessões de teste, `T##-`/`Cen#-`/`VERIF#-`, sem valor de negócio).
- Trocar a Ponte de produção para apontar para este draft — só depois de validação completa e aprovação explícita separada.

## Decisões já fechadas no brainstorming

| Decisão | Escolha |
|---|---|
| Ambientes Supabase | Um projeto só (produção); testes rodam no mesmo projeto usando `sessionKey` de teste bem marcado, como já é prática no projeto |
| Conexão n8n ↔ Supabase | Postgres nativo (nó Postgres do n8n), não REST/PostgREST |
| Schema | Schema dedicado `mayara` (não `public`) — nunca fica exposto pela API REST automática do Supabase por padrão |
| RLS | Habilitado em todas as tabelas do schema `mayara`, como defesa em profundidade, mesmo não estando exposto via Data API |
| Dados históricos | Não migrar — começar do zero |
| Persistência no CRM | Sai do conjunto de ferramentas do AI Agent; vira lógica determinística no workflow, rodando sempre que uma consulta é criada no Calendar |
| Mecanismo de retry | Fila `pgmq` + workflow worker no n8n com Schedule Trigger (não pg_cron/Edge Function do lado do Supabase — mantém tudo numa única plataforma de automação) |

## Arquitetura

```
Cliente (WhatsApp/chat)
  → Ponte → Núcleo (Mayara)
       → SELECT mayara.session_state (Postgres/Supabase)
       → AI Agent (tools: Salvar Estado da Conversa [Postgres], Verificar Disponibilidade, Create Event)
            [returnIntermediateSteps: true]
       → IF "Create an event in Google Calendar" está nos intermediateSteps desta execução?
            SIM → Execute Workflow: "Mayara — Persistir Consulta no CRM [Sub-workflow]"
                     (com os dados REAIS extraídos do tool call, não texto do LLM)
                     → sucesso: segue
                     → falha em qualquer chamada: Enfileirar em mayara_crm_retry (pgmq) → segue mesmo assim
            NÃO → segue direto
       → UPSERT mayara.bridge_responses (Postgres/Supabase)
       → resposta pro cliente

Worker separado: "Mayara — Retry CRM Falhas [Worker]"
  Schedule Trigger (a cada 5 min)
    → pgmq.read('mayara_crm_retry', vt=60, qty=10)
    → para cada mensagem: Execute Workflow "Mayara — Persistir Consulta no CRM [Sub-workflow]"
         → sucesso: pgmq.delete
         → falha e read_ct <= 5: não faz nada (mensagem volta a ficar visível após vt expirar)
         → falha e read_ct > 5: grava em mayara.crm_retry_failed, pgmq.archive
```

## Modelo de dados

Schema `mayara`, extensão `pgmq` habilitada no projeto.

**Convenção de nomenclatura:** colunas em `snake_case` (idiomático em Postgres), mas todo `SELECT` lido por um nó do n8n deve aliasar as colunas pra camelCase (ex: `select session_key as "sessionKey", estado, fatos_json as "fatosJson", ... from mayara.session_state`), pra bater com o que os nós existentes do workflow já esperam (`$json.estado`, `$json.fatosJson`) sem precisar reescrever essas expressões. `INSERT`/`UPDATE` continuam usando os nomes de coluna reais (`snake_case`).

### `mayara.session_state`
| Coluna | Tipo | Notas |
|---|---|---|
| `session_key` | `text` | PK |
| `estado` | `text` | not null |
| `fatos_json` | `jsonb` | not null, default `'{}'` — JSONB de verdade (hoje é string solta na Data Table) |
| `created_at` | `timestamptz` | not null, default `now()` |
| `updated_at` | `timestamptz` | not null, default `now()`, atualizado via trigger `BEFORE UPDATE` |

### `mayara.bridge_responses`
| Coluna | Tipo | Notas |
|---|---|---|
| `session_key` | `text` | PK |
| `output` | `text` | not null |
| `created_at` | `timestamptz` | not null, default `now()` |
| `updated_at` | `timestamptz` | not null, default `now()`, trigger igual acima |

### Fila `mayara_crm_retry` (via `pgmq.create('mayara_crm_retry')`)
Payload da mensagem (JSONB) — chaves em camelCase, pra bater com a convenção já usada em todo o resto do workflow (`sessionId`, `chatInput`, `estadoAtual`, `fatosJson`):
```json
{
  "sessionKey": "string",
  "nome": "string",
  "telefone": "string",
  "email": "string",
  "empresa": "string",
  "descricaoLead": "string",
  "eventoCalendarioId": "string",
  "horarioInicio": "ISO 8601",
  "horarioFim": "ISO 8601"
}
```

### `mayara.crm_retry_failed`
| Coluna | Tipo | Notas |
|---|---|---|
| `id` | `bigserial` | PK |
| `payload` | `jsonb` | mesma forma da mensagem da fila |
| `motivo_falha` | `text` | último erro registrado (mensagem/status HTTP) |
| `tentativas` | `int` | `read_ct` da fila no momento do descarte |
| `criado_em` | `timestamptz` | default `now()` |

## Mudanças no workflow `Mayara — Núcleo do Agente [DRAFT V2]`

- `Buscar Estado da Sessao` (n8n Data Table) → nó Postgres, `SELECT` em `mayara.session_state` por `session_key`.
- `Salvar Estado da Conversa` (ferramenta do agente, hoje `dataTableTool`) → vira ferramenta Postgres (`UPSERT` em `mayara.session_state`). Continua sendo ferramenta do agente — não é business-critical do mesmo jeito que o CRM, sem evidência de falha em uso.
- `Upsert row(s)` (final, grava em `Mayara Respostas Ponte`) → nó Postgres, `UPSERT` em `mayara.bridge_responses`.
- **Removidas do AI Agent:** `Criar Lead no CRM`, `Buscar Lead por Telefone`, `Atualizar Status do Lead`, `Criar Consulta no CRM` (saem do conjunto de tools).
- **AI Agent:** adicionar `options.returnIntermediateSteps: true`.
- **Novo nó** logo após o AI Agent: extrai do `$json.intermediateSteps` se a ferramenta `Create an event in Google Calendar` foi chamada nesta execução, e se sim, os valores reais de `start`, `end`, `summary`, `attendees` retornados por ela (não os `$fromAI` originalmente enviados — usar o que a ferramenta de fato confirmou).
- **Novo IF:** ramifica com base nisso.
- **Novo nó Execute Workflow** (branch verdadeiro): chama `Mayara — Persistir Consulta no CRM [Sub-workflow]`.

## Novo sub-workflow: `Mayara — Persistir Consulta no CRM [Sub-workflow]`

Recebe via Execute Workflow Trigger: `sessionKey, nome, telefone, email, empresa, descricaoLead, eventoCalendarioId, horarioInicio, horarioFim`.

Nós (portados das antigas ferramentas HTTP, mesma configuração de credencial/URL, agora como sequência determinística):
1. `Buscar Lead por Telefone` (GET) — `onError: continueErrorOutput` → Enfileirar Retry
2. IF lead encontrado → pula para (4); senão →
3. `Criar Lead no CRM` (POST) — `onError: continueErrorOutput` → Enfileirar Retry
4. `Atualizar Status do Lead` (PUT) — `onError: continueErrorOutput` → Enfileirar Retry
5. `Criar Consulta no CRM` (POST) — `onError: continueErrorOutput` → Enfileirar Retry

`Enfileirar Retry` (nó Postgres, `select pgmq.send('mayara_crm_retry', <payload>::jsonb)`) — único nó de erro, todas as saídas de erro convergem nele. Depois de enfileirar, o sub-workflow termina normalmente (não propaga erro pro workflow principal — o cliente já recebeu a confirmação do agendamento, que é real).

## Novo workflow: `Mayara — Retry CRM Falhas [Worker]`

1. Schedule Trigger — a cada 5 minutos (`*/5 * * * *`).
2. Postgres — `select * from pgmq.read('mayara_crm_retry', 60, 10)`.
3. Loop (per item, execução automática por item já cobre isso):
   - Execute Workflow → `Mayara — Persistir Consulta no CRM [Sub-workflow]`.
   - Sucesso → Postgres `select pgmq.delete('mayara_crm_retry', msg_id)`.
   - Falha e `read_ct <= 5` → não faz nada (mensagem some da leitura até o `vt` expirar e volta a ficar visível).
   - Falha e `read_ct > 5` → INSERT em `mayara.crm_retry_failed` + `select pgmq.archive('mayara_crm_retry', msg_id)`.

## Credencial nova

Credencial Postgres no n8n, escopo local/user (nunca `project` com secret) — connection string do projeto Supabase. **Verificar na hora da implementação** (não confiar em memória de treinamento) qual modo de conexão o Supabase recomenda atualmente para esse padrão de uso (pooler de sessão vs. transação vs. conexão direta) — a doc do Supabase muda com frequência nisso.

## Tratamento de erro (resumo)

- Nenhuma chamada de CRM bloqueia a resposta ao cliente — ela já saiu, baseada no sucesso real do Calendar.
- Toda falha do bloco de CRM vira mensagem na fila, nunca é descartada silenciosamente.
- Depois de 5 tentativas automáticas, vira registro em `mayara.crm_retry_failed` para revisão humana — nunca fica tentando pra sempre nem desaparece.

## Testes

Reaproveitar o harness `[TEST HARNESS] Mayara V2` (`n8n_test_workflow`).

1. **Fluxo feliz determinístico:** agendamento completo (nome/telefone/email/empresa/dívida + horário exato) → confirmar via `n8n_get_workflow`/execução que o sub-workflow de CRM rodou e criou Lead + Meeting reais, **sem depender de o modelo ter decidido chamar nada** — é sempre executado.
2. **Falha real do CRM (usa o 403 atual como teste vivo):** mesmo fluxo → confirmar que (a) cliente recebe confirmação normal do agendamento, (b) mensagem aparece em `mayara_crm_retry`, (c) rodar o worker manualmente e, depois que o 403 for corrigido no EspoCRM, confirmar que a mensagem é reprocessada com sucesso e sai da fila.
3. **Regressão dos testes já aprovados** (T14–T30, Cenários A–E) — confirmar que nada relacionado a conversa/qualificação regrediu com a mudança de armazenamento de estado.

## Limpeza / rollback

- Cada edição no draft via n8n-mcp já gera snapshot de versão local automático — rollback disponível via `n8n_workflow_versions` se algo quebrar.
- Dados de teste no Postgres novo devem seguir a mesma convenção de `sessionKey` de teste (`T##-`, `Cen#-`, `CONFIRM-`) já usada, para facilitar limpeza depois.
- Eventos de teste reais criados no Google Calendar durante os testes deste sub-projeto devem ser apagados manualmente ao final (mesma rotina já seguida nos testes anteriores).

## Riscos / suposições abertas

- Assume-se que o erro 403 do EspoCRM será corrigido separadamente (fora deste sub-projeto) — a fila de retry só funciona quando a causa raiz permitir sucesso eventual; ela não resolve um erro permanente sozinha, só evita que o problema seja invisível.
- O modo exato de conexão do n8n ao Postgres do Supabase (pooler/porta) precisa ser confirmado contra a documentação atual do Supabase no momento da implementação, não fixado aqui.
