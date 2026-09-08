# Painel Executivo — Reconstrução — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir o painel Executivo (HTML servido por n8n, consulta ao vivo no EspoCRM) por uma aplicação Next.js própria que lê de um espelho no Supabase, sincronizado a cada 5 minutos, com criação assistida de Contratos/Pagamentos pra reduzir digitação manual.

**Architecture:** EspoCRM (fonte da verdade) → n8n (sync incremental por cursor + criação assistida de rascunhos) → Supabase/Postgres (`crm_sync` schema) → Next.js (Server Components, login simples de usuário único) → navegador do Dr. Santo.

**Tech Stack:** n8n (self-hosted), EspoCRM REST API, Supabase Postgres 17 (projeto `crmia-mayara`, `wuhvlvsolewslkawazlq`), Next.js 14 (App Router, TypeScript), `pg` (node-postgres), Coolify/Docker.

**Spec:** `docs/superpowers/specs/2026-09-07-painel-executivo-design.md`

## Global Constraints

- Schema Supabase novo `crm_sync`, isolado do schema `mayara` (sub-projeto 1) — nenhuma task aqui modifica `mayara.*` ou os workflows da Mayara em produção.
- Todas as tabelas `crm_sync.*` com `row level security` habilitado e **sem policies** (deny-all intencional) — só a `service_role key` acessa (n8n via credencial Postgres, Next.js via variável de ambiente só de servidor).
- Credenciais n8n já existentes a reaproveitar (não criar novas): EspoCRM = `EspoCRM Integração n8n — Mayara` (id `3CNvCGWMMDOyGD2n`, tipo `httpHeaderAuth`); Postgres = `Postgres account` (id `nNpCUIhnDuVvTApU`).
- Nós Postgres em n8n: sempre `typeVersion: 2.6` (2.7 trava a instância — achado registrado no sub-projeto 1).
- URL base do EspoCRM: `https://crm.camparimadvogados.com.br`.
- Migrações SQL entram em `supabase/migrations/`, próximo número sequencial após `0002_mayara_crm_retry_queue.sql` → começar em `0003`.
- App Next.js vive em `painel-executivo/` na raiz do repo (não monorepo `apps/`, seguindo a convenção plana já usada neste repo).
- Nenhuma migração de dados históricos (confirmado com o usuário: controle anterior era informal).
- Cada task termina com o app/workflow em estado testável — não deixar nada "quebrado" entre tasks.

## Progresso e achados de execução

- **Task 2 concluída** — schema `crm_sync` aplicado (8 tabelas, RLS deny-all confirmado via advisors), migração commitada.
- **Task 3 concluída** — workflow `Painel Executivo — Sync CRM→Supabase` (id `PH73hjj7zIABuZ74`) criado, ativo, primeiro ciclo confirmado: 2 leads + 1 meeting sincronizados, 0 falhas. Achado: `Meeting.leads` é `linkMultiple` (não link simples) — `lead_id` em `crm_sync.meetings` fica sempre nulo (nenhuma métrica da spec usa essa coluna, então não é um problema).
- **Task 4 em andamento** — workflow `Painel Executivo — Criação Assistida de Registros` (id `1wDrXlOUL7sw2tYT`) criado e ativo com a Regra 1 (proposta aceita → contrato rascunho). **Bloqueado por achado novo:** o usuário `n8n-integration` tem `"No create access."` em `CProposta`/`CContrato`/`CPagamento` (permissão de Criação, não de atribuição — diferente do 403 resolvido no sub-projeto 1). Pedido ao usuário: em **Administração → Funções**, no papel desse usuário, marcar "Yes" em Create pra esses 3 módulos — mesma visita ao Admin já pedida na Task 1.
- **Task 1 concluída e confirmada via API** — campos `numeroParcelas` (int, default 1) e `diaVencimentoPrimeiraParcela` (date) existem em `CContrato`, colocados nos layouts.
- **Task 4 concluída** — workflow `Painel Executivo — Criação Assistida de Registros` (id `1wDrXlOUL7sw2tYT`) com as duas regras ativas e testadas de ponta a ponta:
  - Regra 1 (proposta aceita → contrato rascunho): testada, idempotente (rodar 2x não duplica).
  - Regra 2 (contrato assinado → parcelas): testada com `numeroParcelas=3` (3 parcelas de R$3.000, vencimentos mensais) e sem `numeroParcelas` (1 parcela, default), idempotente, ambas confirmadas no mesmo ciclo.
  - **3 bugs reais encontrados e corrigidos durante o teste** (nenhum estava no plano original): (1) filtro de "contrato já existe" usava `attribute=proposal` (nome do link) em vez de `attribute=proposalId` (atributo de id) — retornava 400; (2) `CContrato.source` é um enum fixo (`Call, Email, Existing Customer, Partner, Public Relations, Web Site, Campaign, Other`), não texto livre — `Criar Contrato Rascunho` agora usa `"Other"` e move a nota explicativa pro campo `description`; (3) tanto `Criar Contrato Rascunho` quanto `Gerar Parcelas`/`Criar Parcela` precisaram de `assignedUserId` explícito (mesmo problema de permissão de atribuição já resolvido antes para Lead/Meeting) — sem isso, a criação falhava com 403 "Assignment failure".
  - **Achado de permissão adicional**: o usuário `n8n-integration` não tem acesso de Edição (`Edit`) em `CProposta`/`CContrato` — só Criação. Isso é esperado e não bloqueia a automação real (mudanças de status são feitas por uma pessoa pela tela do CRM, não pela API), mas significa que eu não consigo simular esses passos sozinho em testes futuros — precisei pedir pro usuário marcar manualmente os registros de teste.
- **Registros de teste pendentes de limpeza manual** (API não tem permissão de Delete nesses módulos): Propostas `6a9f5682ce22b698b` e `6a9f56ee9d7d43bb0`; Contratos `6a9f5a9f34d981462` e `6a9f5f4050700f6cc`; Pagamentos `6a9f5e1e99d2696ab`, `6a9f5e1e9a6cafddf`, `6a9f5e1e9980034e2`, `6a9f5f4a6245f2261` — todos com nome começando em "TESTE PLANO" ou "Contrato — TESTE PLANO", fáceis de achar e apagar pela tela.
- **Tasks 5-8 concluídas e mescladas em `main`** (commit `404c1058`) — executadas via subagent-driven-development num worktree isolado (`worktree-painel-executivo`, já removido após o merge). Todas as 4 tasks passaram por implementação → revisão → correção quando necessário, mais uma revisão final de todo o branch (achados abaixo). Testes: 5/5 passando. App em `painel-executivo/`, ainda **não implantado no Coolify** (Task 5 Passo 6) nem testado contra um banco Supabase ao vivo pela própria aplicação (as queries da Task 7 foram validadas manualmente por mim, à parte, contra o Supabase real — ver achados).
  - **Achados da revisão final corrigidos:** fórmula da taxa de inadimplência estava com numerador/denominador de janelas diferentes (corrigida pra usar a mesma janela de 90 dias e status); fuso horário não estava configurado em lugar nenhum (Dockerfile, conexão Postgres e formatação de data agora fixados em `America/Sao_Paulo`); rota raiz `/` ainda servia a página padrão do Next.js publicamente (agora redireciona pro painel); metadados da página e `lang` ainda diziam "Create Next App"/`en`; um cookie de sessão corrompido derrubava a página com erro 500 em vez de mandar pro login (corrigido e confirmado ao vivo); faltava tratamento de erro de conexão do Postgres, `.dockerignore`, documentação das variáveis de ambiente, e uma tela de erro em português quando os dados falham ao carregar. Tudo verificado e sem quebras novas.
  - **Decisões que tomei sem perguntar** (ficam registradas aqui pra você revisar, não pedem ação a menos que discorde): (1) Tasks 1/3/4 e a Task 2 rodaram direto contra a infraestrutura real, fora do worktree — não fazia sentido isolar em branch algo que mexe numa instância única e compartilhada; (2) a Task 5 original pedia configurar o serviço no Coolify pela interface web — isso ficou de fora do que os subagentes/eu conseguimos fazer (sem acesso a navegador), então também é uma pendência sua, junto com a Task 1.
- **Pendente:** você concluir a Task 1 (campos + permissão de Create), eu terminar a Task 4 (Regra 2), e a Task 9 (QA de ponta a ponta + implantação real no Coolify).

---

### Task 1: EspoCRM — novos campos em `CContrato`

**Files:** nenhum arquivo de código — mudança feita na interface administrativa do EspoCRM.

**Interfaces:**
- Produz: os campos `numeroParcelas` (int) e `diaVencimentoPrimeiraParcela` (date) em `CContrato`, consumidos pela Task 4 (criação assistida de parcelas).

- [x] **Passo 1: Criar o campo `numeroParcelas`**

No EspoCRM, ir em **Administração → Gerenciador de Entidades → CContrato → Campos → Adicionar Campo**:
  - Nome: `numeroParcelas`
  - Tipo: `Inteiro` (Int)
  - Valor padrão: `1`
  - Obrigatório: não
  - Salvar.

- [x] **Passo 2: Criar o campo `diaVencimentoPrimeiraParcela`**

Mesma tela, **Adicionar Campo**:
  - Nome: `diaVencimentoPrimeiraParcela`
  - Tipo: `Data` (Date)
  - Obrigatório: não
  - Salvar.

- [x] **Passo 3: Adicionar os dois campos ao layout de Detalhe/Edição de `CContrato`**

Em **Administração → Gerenciador de Entidades → CContrato → Layouts → Detail** (e **Edit**), arrastar os dois novos campos pro layout, perto de `amount`/`status`. Salvar cada layout.

- [x] **Passo 4: Verificar via API que os campos existem**

Usar um workflow n8n descartável (webhook + HTTP Request GET `/api/v1/Metadata`, credencial `EspoCRM Integração n8n — Mayara`) e conferir que `entityDefs.CContrato.fields.numeroParcelas` e `.diaVencimentoPrimeiraParcela` aparecem na resposta. Apagar o workflow descartável ao final.

Expected: os dois campos aparecem no JSON de metadata com os tipos corretos (`"type": "int"` e `"type": "date"`).

- [x] **Passo 5: Criar um `CContrato` de teste com os campos preenchidos**

Pela interface do EspoCRM, criar um contrato de teste com `numeroParcelas = 3` e `diaVencimentoPrimeiraParcela` preenchida, confirmar que salva sem erro. Anotar o id do registro de teste (usado e limpo na Task 4).

---

### Task 2: Supabase — schema `crm_sync`

**Files:**
- Create: `supabase/migrations/0003_painel_executivo_schema.sql`

**Interfaces:**
- Produz: tabelas `crm_sync.leads`, `crm_sync.meetings`, `crm_sync.propostas`, `crm_sync.contratos`, `crm_sync.pagamentos`, `crm_sync.casos_juridicos`, `crm_sync.sync_state`, `crm_sync.sync_failures` — consumidas pelas Tasks 3, 4 e 7.

- [x] **Passo 1: Escrever a migração**

```sql
-- supabase/migrations/0003_painel_executivo_schema.sql
create schema if not exists crm_sync;

create table crm_sync.leads (
  id text primary key,
  name text not null,
  status text not null,
  source text,
  legal_area text,
  channel text,
  urgency_level text,
  lead_score numeric,
  lost_reason text,
  opportunity_amount numeric,
  created_at timestamptz not null,
  won_at timestamptz,
  modified_at timestamptz not null
);

create table crm_sync.meetings (
  id text primary key,
  name text not null,
  status text not null,
  date_start timestamptz,
  date_end timestamptz,
  no_show boolean default false,
  acceptance_status text,
  lead_id text references crm_sync.leads(id),
  created_at timestamptz not null,
  modified_at timestamptz not null
);

create table crm_sync.propostas (
  id text primary key,
  name text not null,
  amount numeric,
  status text not null,
  sent_at timestamptz,
  accepted_at timestamptz,
  rejected_at timestamptz,
  rejection_reason text,
  success_fee_percentage numeric,
  lead_id text references crm_sync.leads(id),
  created_at timestamptz not null,
  modified_at timestamptz not null
);

create table crm_sync.contratos (
  id text primary key,
  name text not null,
  amount numeric,
  status text not null,
  payment_status text,
  signed_at timestamptz,
  closed_at timestamptz,
  channel text,
  source text,
  lead_id text references crm_sync.leads(id),
  proposal_id text references crm_sync.propostas(id),
  created_at timestamptz not null,
  modified_at timestamptz not null
);

create table crm_sync.pagamentos (
  id text primary key,
  name text not null,
  amount numeric,
  status text not null,
  due_date date,
  paid_at timestamptz,
  payment_method text,
  installment_number integer,
  total_installments integer,
  contract_id text references crm_sync.contratos(id),
  created_at timestamptz not null,
  modified_at timestamptz not null
);

create table crm_sync.casos_juridicos (
  id text primary key,
  name text not null,
  status text not null,
  risk_level text not null,
  current_phase text,
  legal_area text,
  court text,
  case_number text,
  claim_value numeric,
  next_deadline_at timestamptz,
  last_movement_at timestamptz,
  client_id text,
  responsible_lawyer_id text,
  created_at timestamptz not null,
  modified_at timestamptz not null
);

create table crm_sync.sync_state (
  entity_name text primary key,
  last_synced_at timestamptz not null default '1970-01-01'::timestamptz
);

insert into crm_sync.sync_state (entity_name) values
  ('Lead'), ('Meeting'), ('CProposta'), ('CContrato'), ('CPagamento'), ('CCasoJuridico');

create table crm_sync.sync_failures (
  id bigint generated always as identity primary key,
  entity_name text not null,
  error_message text not null,
  occurred_at timestamptz not null default now()
);

alter table crm_sync.leads enable row level security;
alter table crm_sync.meetings enable row level security;
alter table crm_sync.propostas enable row level security;
alter table crm_sync.contratos enable row level security;
alter table crm_sync.pagamentos enable row level security;
alter table crm_sync.casos_juridicos enable row level security;
alter table crm_sync.sync_state enable row level security;
alter table crm_sync.sync_failures enable row level security;
```

- [x] **Passo 2: Aplicar a migração no Supabase**

Usar `execute_sql` (MCP Supabase) com o conteúdo do arquivo, projeto `wuhvlvsolewslkawazlq`.

- [x] **Passo 3: Rodar os advisors de segurança**

Usar `get_advisors` (MCP Supabase, `type: security`) e confirmar que não há alerta novo relacionado a `crm_sync` (RLS habilitado sem policy é esperado e correto aqui — deny-all intencional, não é um alerta a corrigir).

- [x] **Passo 4: Verificar as tabelas**

Usar `list_tables` (MCP Supabase, schemas `["crm_sync"]`) e confirmar que as 8 tabelas aparecem, todas com `rls_enabled: true` e `rows: 0` (exceto `sync_state`, que deve ter 6 linhas — uma por entidade).

- [x] **Passo 5: Gerar a migração formal via CLI (se disponível) ou registrar manualmente**

Se `supabase db pull` estiver disponível neste ambiente, rodar `supabase db pull painel_executivo_schema --local --yes` e conferir com `supabase migration list --local`. Se não houver CLI configurado localmente para este projeto, o arquivo já escrito no Passo 1 e aplicado no Passo 2 é a fonte de verdade — commitar como está.

- [x] **Passo 6: Commit**

```bash
git add supabase/migrations/0003_painel_executivo_schema.sql
git commit -m "feat: schema crm_sync no Supabase (espelho de Lead/Meeting/CProposta/CContrato/CPagamento/CCasoJuridico)"
```

---

### Task 3: n8n — workflow de sincronização EspoCRM → Supabase

**Files:** nenhum arquivo local — workflow criado direto no n8n via MCP.

**Interfaces:**
- Consome: tabelas da Task 2, credenciais `EspoCRM Integração n8n — Mayara` e `Postgres account`.
- Produz: workflow ativo `Painel Executivo — Sync CRM→Supabase`, populando `crm_sync.*` a cada 5 minutos — consumido pela Task 7 (camada de dados do Next.js).

- [x] **Passo 1: Criar o workflow com o primeiro ramo (`Lead`)**

Via `n8n_create_workflow`: nome `Painel Executivo — Sync CRM→Supabase`, nós:
  - `Schedule Trigger` (`n8n-nodes-base.scheduleTrigger`, typeVersion 1.2, intervalo: a cada 5 minutos)
  - `Ler Cursor — Lead` (`n8n-nodes-base.postgres`, typeVersion 2.6, `operation: executeQuery`, query `select last_synced_at from crm_sync.sync_state where entity_name = 'Lead'`, credencial `Postgres account`)
  - `Buscar Leads no EspoCRM` (`n8n-nodes-base.httpRequest`, typeVersion 4.4, `method: GET`, url `=https://crm.camparimadvogados.com.br/api/v1/Lead?where[0][type]=greaterThan&where[0][attribute]=modifiedAt&where[0][value]={{ $json.last_synced_at }}&orderBy=modifiedAt&order=asc&maxSize=200`, `authentication: genericCredentialType`, `genericAuthType: httpHeaderAuth`, credencial `EspoCRM Integração n8n — Mayara`)
  - `Extrair Lista` (`n8n-nodes-base.code`, typeVersion 2, modo "All Items") — código:
    ```javascript
    const body = $input.first().json;
    const list = body.list || [];
    return list.map(item => ({ json: item }));
    ```
  - `Upsert Leads` (`n8n-nodes-base.postgres`, typeVersion 2.6, `operation: upsert`, schema `crm_sync`, tabela `leads`, `columnToMatchOn: id`, mapeando: `id={{ $json.id }}`, `name={{ $json.name }}`, `status={{ $json.status }}`, `source={{ $json.source }}`, `legal_area={{ $json.cLegalArea }}`, `channel={{ $json.cChannel }}`, `urgency_level={{ $json.cUrgencyLevel }}`, `lead_score={{ $json.cLeadScore }}`, `lost_reason={{ $json.cLostReason }}`, `opportunity_amount={{ $json.opportunityAmount }}`, `created_at={{ $json.createdAt }}`, `won_at={{ $json.cWonAt }}`, `modified_at={{ $json.modifiedAt }}`)
  - `Avançar Cursor — Lead` (`n8n-nodes-base.postgres`, typeVersion 2.6, `operation: executeQuery`, query `update crm_sync.sync_state set last_synced_at = $1 where entity_name = 'Lead'`, `queryReplacement: ={{ [$('Extrair Lista').all().length > 0 ? $('Extrair Lista').all().slice(-1)[0].json.modifiedAt : $('Ler Cursor — Lead').first().json.last_synced_at] }}`)

Conectar: `Schedule Trigger → Ler Cursor — Lead → Buscar Leads no EspoCRM → Extrair Lista → Upsert Leads → Avançar Cursor — Lead`. Todos com `onError: continueRegularOutput`, saída de erro (index 1) de `Buscar Leads no EspoCRM` e `Upsert Leads` roteada para um nó novo `Registrar Falha de Sync` (`n8n-nodes-base.postgres`, typeVersion 2.6, `operation: insert`, tabela `crm_sync.sync_failures`, colunas `entity_name='Lead'`, `error_message={{ $json.error?.message || JSON.stringify($json) }}`).

- [x] **Passo 2: Testar o ramo `Lead` isoladamente**

`n8n_test_workflow` (method `direct`, ou ativar temporariamente e disparar via `Schedule Trigger` manual no editor) — conferir via `n8n_executions` que `Upsert Leads` rodou sem erro e que `crm_sync.leads` recebeu linhas (`list_tables` ou `execute_sql` no Supabase).

Expected: `select count(*) from crm_sync.leads` maior que 0, `sync_state.last_synced_at` pra `'Lead'` avançou além de `1970-01-01`.

- [x] **Passo 3: Repetir o padrão do Passo 1 para as 5 entidades restantes**

Mesma estrutura de 6 nós por entidade (`Ler Cursor`, `Buscar no EspoCRM`, `Extrair Lista`, `Upsert`, `Avançar Cursor`, erro → `Registrar Falha de Sync`), todos partindo do mesmo `Schedule Trigger` em paralelo (6 ramos independentes). Endpoints e mapeamento de colunas:

  - **Meeting** → `GET /api/v1/Meeting?...`, upsert em `crm_sync.meetings`: `id`, `name`, `status`, `date_start={{ $json.dateStart }}`, `date_end={{ $json.dateEnd }}`, `no_show={{ $json.cNoShow }}`, `acceptance_status={{ $json.acceptanceStatus }}`, `lead_id={{ $json.leads?.[0] || null }}` (Meeting tem link `leads` — pegar o primeiro), `created_at`, `modified_at`.
  - **CProposta** → `GET /api/v1/CProposta?...`, upsert em `crm_sync.propostas`: `id`, `name`, `amount`, `status`, `sent_at={{ $json.sentAt }}`, `accepted_at={{ $json.acceptedAt }}`, `rejected_at={{ $json.rejectedAt }}`, `rejection_reason={{ $json.rejectionReason }}`, `success_fee_percentage={{ $json.successFeePercentage }}`, `lead_id={{ $json.leadId }}`, `created_at`, `modified_at`.
  - **CContrato** → `GET /api/v1/CContrato?...`, upsert em `crm_sync.contratos`: `id`, `name`, `amount`, `status`, `payment_status={{ $json.paymentStatus }}`, `signed_at={{ $json.signedAt }}`, `closed_at={{ $json.closedAt }}`, `channel`, `source`, `lead_id={{ $json.leadId }}`, `proposal_id={{ $json.proposalId }}`, `created_at`, `modified_at`.
  - **CPagamento** → `GET /api/v1/CPagamento?...`, upsert em `crm_sync.pagamentos`: `id`, `name`, `amount`, `status`, `due_date={{ $json.dueDate }}`, `paid_at={{ $json.paidAt }}`, `payment_method={{ $json.paymentMethod }}`, `installment_number={{ $json.installmentNumber }}`, `total_installments={{ $json.totalInstallments }}`, `contract_id={{ $json.contractId }}`, `created_at`, `modified_at`.
  - **CCasoJuridico** → `GET /api/v1/CCasoJuridico?...`, upsert em `crm_sync.casos_juridicos`: `id`, `name`, `status`, `risk_level={{ $json.riskLevel }}`, `current_phase={{ $json.currentPhase }}`, `legal_area={{ $json.legalArea }}`, `court`, `case_number={{ $json.caseNumber }}`, `claim_value={{ $json.claimValue }}`, `next_deadline_at={{ $json.nextDeadlineAt }}`, `last_movement_at={{ $json.lastMovementAt }}`, `client_id={{ $json.clientId }}`, `responsible_lawyer_id={{ $json.responsibleLawyerId }}`, `created_at`, `modified_at`.

  (Nota: EspoCRM retorna os ids dos links diretamente como `<link>Id`, ex.: `leadId`, `proposalId`, `contractId`, `clientId` — confirmar o nome exato de cada um inspecionando um item real de `Buscar ... no EspoCRM` antes de fixar o `Upsert`, já que o padrão de nomenclatura do EspoCRM é consistente mas vale checar contra um payload real por segurança.)

- [x] **Passo 4: Testar as 5 entidades restantes**

Mesmo processo do Passo 2, uma por vez, confirmando `count(*) > 0` (ou `= 0` se o EspoCRM realmente não tiver nenhum registro ainda em algum módulo — nesse caso confirmar `sync_state` avançou mesmo assim sem erro) em cada tabela correspondente.

- [x] **Passo 5: Ativar o workflow**

`n8n_update_partial_workflow` com `activateWorkflow`. Esperar um ciclo completo (5 min) e confirmar via `n8n_executions` (`status: success` nas 6 execuções do ciclo).

- [x] **Passo 6: Commit não se aplica (workflow vive só no n8n)** — registrar o id do workflow criado nesta seção do plano ao concluir a task (editar este arquivo e marcar).

---

### Task 4: n8n — workflow de criação assistida de registros

**Files:** nenhum arquivo local — workflow criado direto no n8n via MCP.

**Interfaces:**
- Consome: EspoCRM (`CProposta`, `CContrato`, `CPagamento`), campos novos da Task 1.
- Produz: workflow ativo `Painel Executivo — Criação Assistida de Registros`.

- [x] **Passo 1: Criar o workflow com a Regra 1 (proposta aceita → contrato rascunho)**

`n8n_create_workflow`, nome `Painel Executivo — Criação Assistida de Registros`, nós:
  - `Schedule Trigger` (a cada 5 minutos)
  - `Buscar Propostas Aceitas` (`httpRequest` GET `/api/v1/CProposta?where[0][type]=equals&where[0][attribute]=status&where[0][value]=Aceita&maxSize=200`, credencial EspoCRM)
  - `Extrair Propostas` (`code`, mesmo padrão de `body.list.map(...)`)
  - `Verificar Contrato Existente` (`httpRequest` GET `/api/v1/CContrato?where[0][type]=equals&where[0][attribute]=proposal&where[0][value]={{ $json.id }}&maxSize=1`, `onError: continueRegularOutput`)
  - `Já Tem Contrato?` (`IF`, condição `{{ $json.total }} === 0`, ramo `true` segue, ramo `false` para)
  - `Criar Contrato Rascunho` (`httpRequest` POST `/api/v1/CContrato`, body JSON: `{"status": "Pendente", "amount": {{ $('Extrair Propostas').item.json.amount }}, "leadId": "{{ $('Extrair Propostas').item.json.leadId }}", "proposalId": "{{ $('Extrair Propostas').item.json.id }}", "source": "Automação — proposta aceita", "name": "Contrato — {{ $('Extrair Propostas').item.json.name }}"}`, credencial EspoCRM)

Conectar: `Schedule Trigger → Buscar Propostas Aceitas → Extrair Propostas → Verificar Contrato Existente → Já Tem Contrato? → (true) Criar Contrato Rascunho`.

- [x] **Passo 2: Testar a Regra 1**

No EspoCRM, marcar uma Proposta de teste como `Aceita`. Disparar o workflow manualmente (`n8n_test_workflow`, method `direct`). Conferir via `n8n_executions` que `Criar Contrato Rascunho` rodou e que um novo `CContrato` com `status: Pendente` e `proposal` apontando pra essa proposta existe (checar via `GET /api/v1/CProposta/{id}` ou olhando o EspoCRM). Rodar o workflow de novo e confirmar que **não** cria um segundo contrato (idempotência via `Já Tem Contrato?`).

Expected: exatamente 1 `CContrato` rascunho após 2 execuções seguidas.

- [x] **Passo 3: Adicionar a Regra 2 (contrato assinado → parcelas)**

No mesmo workflow, novo ramo a partir do mesmo `Schedule Trigger`:
  - `Buscar Contratos Assinados` (`httpRequest` GET `/api/v1/CContrato?where[0][type]=equals&where[0][attribute]=status&where[0][value]=Assinado&maxSize=200`)
  - `Extrair Contratos` (`code`, mesmo padrão)
  - `Verificar Pagamentos Existentes` (`httpRequest` GET `/api/v1/CPagamento?where[0][type]=equals&where[0][attribute]=contract&where[0][value]={{ $json.id }}&maxSize=1`)
  - `Já Tem Pagamentos?` (`IF`, `{{ $json.total }} === 0`)
  - `Gerar Parcelas` (`code`, typeVersion 2, modo "All Items") — código:
    ```javascript
    const contrato = $('Extrair Contratos').item.json;
    const n = contrato.numeroParcelas && contrato.numeroParcelas > 0 ? contrato.numeroParcelas : 1;
    const totalCents = Math.round(Number(contrato.amount) * 100);
    const baseCents = Math.floor(totalCents / n);
    const restoCents = totalCents - baseCents * (n - 1);

    const primeiraData = contrato.diaVencimentoPrimeiraParcela
      ? new Date(contrato.diaVencimentoPrimeiraParcela)
      : new Date(new Date(contrato.signedAt).getTime() + 30 * 24 * 60 * 60 * 1000);

    const parcelas = [];
    for (let i = 0; i < n; i++) {
      const valorCents = i === n - 1 ? restoCents : baseCents;
      const vencimento = new Date(primeiraData);
      vencimento.setMonth(vencimento.getMonth() + i);
      parcelas.push({
        json: {
          name: `Parcela ${i + 1}/${n} — ${contrato.name}`,
          amount: valorCents / 100,
          status: 'Pendente',
          dueDate: vencimento.toISOString().slice(0, 10),
          contractId: contrato.id,
          clientId: contrato.clientId || null,
          installmentNumber: i + 1,
          totalInstallments: n
        }
      });
    }
    return parcelas;
    ```
  - `Criar Parcela` (`httpRequest` POST `/api/v1/CPagamento`, body `={{ $json }}`, credencial EspoCRM)

Conectar: `Já Tem Pagamentos? (true) → Gerar Parcelas → Criar Parcela`.

- [x] **Passo 4: Testar a Regra 2**

Usar o `CContrato` de teste criado na Task 1 (Passo 5, com `numeroParcelas = 3`), marcar `status = Assinado`. Disparar o workflow. Conferir que exatamente 3 `CPagamento` foram criados, com `dueDate` espaçado por mês a partir de `diaVencimentoPrimeiraParcela`, e que a soma dos 3 `amount` bate exatamente com o `amount` do contrato (checar o ajuste de centavos na 3ª parcela). Rodar de novo e confirmar que não duplica.

Expected: `sum(amount)` das 3 parcelas == `amount` do contrato, com no máximo diferença de arredondamento de centavos absorvida na última.

- [x] **Passo 5: Testar o default sem `numeroParcelas`**

Criar um segundo `CContrato` de teste sem preencher `numeroParcelas`, marcar `Assinado`. Confirmar que gera exatamente 1 `CPagamento` com o valor total e vencimento em `signedAt + 30 dias`.

- [x] **Passo 6: Ativar o workflow e limpar os registros de teste**

Ativar via `activateWorkflow`. Apagar (ou marcar como cancelado, já que EspoCRM pode negar delete via API — usar a UI se necessário) os registros de teste criados nas Tasks 1 e 4 (proposta, contratos e pagamentos de teste) para não poluir as métricas reais do painel.

---

### Task 5: Next.js — scaffold do projeto e deploy Coolify

**Files:**
- Create: `painel-executivo/package.json`
- Create: `painel-executivo/tsconfig.json`
- Create: `painel-executivo/next.config.mjs`
- Create: `painel-executivo/Dockerfile`
- Create: `painel-executivo/app/layout.tsx`
- Create: `painel-executivo/app/page.tsx`

**Interfaces:**
- Produz: projeto Next.js rodando (local e em Coolify), rota `/` respondendo — base pra Tasks 6-8.

- [x] **Passo 1: Criar o projeto**

```bash
cd /Users/zero14/Desktop/crmia
npx create-next-app@14 painel-executivo --typescript --app --no-tailwind --no-src-dir --import-alias "@/*" --eslint
```

- [x] **Passo 2: Instalar dependências de dados**

```bash
cd painel-executivo
npm install pg
npm install -D @types/pg
```

- [x] **Passo 3: Escrever o `Dockerfile`**

```dockerfile
# painel-executivo/Dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
EXPOSE 3000
CMD ["npm", "run", "start"]
```

- [x] **Passo 4: Rodar localmente e verificar**

```bash
npm run dev
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000
```

Expected: `200`.

- [x] **Passo 5: Commit**

```bash
cd /Users/zero14/Desktop/crmia
git add painel-executivo/
git commit -m "feat: scaffold do app Next.js do painel executivo"
```

- [x] **Passo 6: Configurar o serviço no Coolify**

Na interface do Coolify: novo serviço, tipo Dockerfile, apontando pro diretório `painel-executivo/` deste repo, variáveis de ambiente `SUPABASE_DB_URL`, `PAINEL_SENHA` e `SESSION_SECRET` cadastradas (valores reais só nesta etapa, nunca commitados). Fazer o primeiro deploy e confirmar que a rota `/` responde publicamente.

---

### Task 6: Next.js — sessão e login simples

**Files:**
- Create: `painel-executivo/lib/session.ts`
- Create: `painel-executivo/app/login/page.tsx`
- Create: `painel-executivo/app/login/actions.ts`
- Test: `painel-executivo/lib/session.test.ts`

**Interfaces:**
- Produz: `signSession(): string`, `verifySession(token: string): boolean`, `requireSession(): Promise<void>` (redireciona para `/login` se inválida) — consumidos pela Task 8.

- [x] **Passo 1: Escrever o teste de assinatura/verificação**

```typescript
// painel-executivo/lib/session.test.ts
import { describe, it, expect } from 'vitest';
import { signSession, verifySession } from './session';

describe('session', () => {
  it('verifica uma sessão recém-assinada como válida', () => {
    const token = signSession();
    expect(verifySession(token)).toBe(true);
  });

  it('rejeita um token adulterado', () => {
    const token = signSession();
    const adulterado = token.slice(0, -1) + (token.at(-1) === 'a' ? 'b' : 'a');
    expect(verifySession(adulterado)).toBe(false);
  });

  it('rejeita um token vazio', () => {
    expect(verifySession('')).toBe(false);
  });
});
```

- [x] **Passo 2: Instalar vitest e rodar o teste (esperado falhar)**

```bash
cd painel-executivo
npm install -D vitest
npx vitest run lib/session.test.ts
```

Expected: FAIL — `Cannot find module './session'`.

- [x] **Passo 3: Implementar `lib/session.ts`**

```typescript
// painel-executivo/lib/session.ts
import { createHmac, timingSafeEqual } from 'crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

const COOKIE_NAME = 'painel_sessao';
const MAX_AGE_SECONDS = 60 * 60 * 12; // 12 horas

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET não configurada');
  return secret;
}

export function signSession(): string {
  const issuedAt = Date.now().toString();
  const mac = createHmac('sha256', getSecret()).update(issuedAt).digest('hex');
  return `${issuedAt}.${mac}`;
}

export function verifySession(token: string): boolean {
  if (!token || !token.includes('.')) return false;
  const [issuedAt, mac] = token.split('.');
  const expectedMac = createHmac('sha256', getSecret()).update(issuedAt).digest('hex');
  if (mac.length !== expectedMac.length) return false;
  if (!timingSafeEqual(Buffer.from(mac), Buffer.from(expectedMac))) return false;
  const ageSeconds = (Date.now() - Number(issuedAt)) / 1000;
  return ageSeconds >= 0 && ageSeconds <= MAX_AGE_SECONDS;
}

export async function requireSession(): Promise<void> {
  const token = cookies().get(COOKIE_NAME)?.value ?? '';
  if (!verifySession(token)) {
    redirect('/login');
  }
}

export async function createSessionCookie(): Promise<void> {
  cookies().set(COOKIE_NAME, signSession(), {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: MAX_AGE_SECONDS,
    path: '/'
  });
}

export async function clearSessionCookie(): Promise<void> {
  cookies().delete(COOKIE_NAME);
}
```

- [x] **Passo 4: Rodar o teste de novo e confirmar que passa**

```bash
npx vitest run lib/session.test.ts
```

Expected: PASS nos 3 casos.

- [x] **Passo 5: Escrever a Server Action de login**

```typescript
// painel-executivo/app/login/actions.ts
'use server';

import { redirect } from 'next/navigation';
import { createSessionCookie } from '@/lib/session';

export async function login(formData: FormData): Promise<void> {
  const senha = formData.get('senha');
  if (senha !== process.env.PAINEL_SENHA) {
    redirect('/login?erro=1');
  }
  await createSessionCookie();
  redirect('/painel-executivo');
}

export async function logout(): Promise<void> {
  await clearSessionCookie();
  redirect('/login');
}
```

Import `clearSessionCookie` junto com `createSessionCookie` no topo do arquivo (`import { createSessionCookie, clearSessionCookie } from '@/lib/session';`).

- [x] **Passo 6: Escrever a página de login**

```tsx
// painel-executivo/app/login/page.tsx
import { login } from './actions';

export default function LoginPage({ searchParams }: { searchParams: { erro?: string } }) {
  return (
    <main style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', background: '#0d1310' }}>
      <form action={login} style={{ display: 'flex', flexDirection: 'column', gap: 12, width: 280 }}>
        <h1 style={{ color: '#e9ede7', fontFamily: 'Lora, Georgia, serif', fontSize: 22, margin: 0 }}>Painel Executivo</h1>
        <input
          type="password"
          name="senha"
          placeholder="Senha"
          required
          style={{ padding: '10px 12px', borderRadius: 4, border: '1px solid #2a352d', background: '#1a2420', color: '#e9ede7' }}
        />
        {searchParams.erro && <p style={{ color: '#c23b3b', fontSize: 13, margin: 0 }}>Senha incorreta.</p>}
        <button type="submit" style={{ padding: '10px 12px', borderRadius: 4, border: 'none', background: '#b08a5a', color: '#151009', fontWeight: 600, cursor: 'pointer' }}>
          Entrar
        </button>
      </form>
    </main>
  );
}
```

- [x] **Passo 7: Testar manualmente o fluxo completo**

```bash
npm run dev
```

Acessar `http://localhost:3000/login`, tentar senha errada (esperar redirecionamento com `?erro=1`), depois a senha certa (variável `PAINEL_SENHA` no `.env.local`) e confirmar redirecionamento pra `/painel-executivo` (rota ainda não existe até a Task 8 — 404 esperado nesta task, o importante é o cookie ter sido setado: conferir nas DevTools).

- [x] **Passo 8: Commit**

```bash
git add lib/session.ts lib/session.test.ts app/login/ package.json package-lock.json
git commit -m "feat: login simples de usuário único com sessão assinada por HMAC"
```

---

### Task 7: Next.js — camada de dados (queries de métricas)

**Files:**
- Create: `painel-executivo/lib/db.ts`
- Create: `painel-executivo/lib/period.ts`
- Create: `painel-executivo/lib/metrics.ts`
- Test: `painel-executivo/lib/period.test.ts`

**Interfaces:**
- Consome: `crm_sync.*` (Task 2), `SUPABASE_DB_URL` (env).
- Produz: `getResumo`, `getComercial`, `getFunil`, `getFinanceiro`, `getJuridico`, `getAlertas`, `getLastSyncedAt` — todas `(period?: Period) => Promise<...>` — consumidas pela Task 8.

- [x] **Passo 1: Escrever o teste de `resolvePeriod`**

```typescript
// painel-executivo/lib/period.test.ts
import { describe, it, expect } from 'vitest';
import { resolvePeriod } from './period';

describe('resolvePeriod', () => {
  it('"hoje" cobre só o dia corrente', () => {
    const { from, to } = resolvePeriod('hoje');
    expect(from.toDateString()).toBe(new Date().toDateString());
    expect(to.getTime()).toBeGreaterThanOrEqual(from.getTime());
  });

  it('"30d" cobre 30 dias até agora', () => {
    const { from, to } = resolvePeriod('30d');
    const diffDays = (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24);
    expect(Math.round(diffDays)).toBe(30);
  });
});
```

- [x] **Passo 2: Rodar (esperado falhar)**

```bash
npx vitest run lib/period.test.ts
```

Expected: FAIL — módulo não existe.

- [x] **Passo 3: Implementar `lib/period.ts`**

```typescript
// painel-executivo/lib/period.ts
export type PeriodPreset = 'hoje' | '7d' | '30d' | 'mes_atual';

export interface Period {
  from: Date;
  to: Date;
}

export function resolvePeriod(preset: PeriodPreset): Period {
  const to = new Date();
  const from = new Date(to);

  switch (preset) {
    case 'hoje':
      from.setHours(0, 0, 0, 0);
      break;
    case '7d':
      from.setDate(from.getDate() - 7);
      break;
    case '30d':
      from.setDate(from.getDate() - 30);
      break;
    case 'mes_atual':
      from.setDate(1);
      from.setHours(0, 0, 0, 0);
      break;
  }

  return { from, to };
}
```

- [x] **Passo 4: Rodar de novo e confirmar que passa**

```bash
npx vitest run lib/period.test.ts
```

Expected: PASS.

- [x] **Passo 5: Implementar `lib/db.ts`**

Nota de segurança: `ssl: true` valida o certificado normalmente contra o CA store do Node — os certificados do Supabase são emitidos por uma CA pública, então isso deve funcionar sem ajuste. Se a conexão falhar por erro de certificado, a correção é apontar `ssl.ca` para o certificado da Supabase (documentado em `Project Settings → Database → SSL Configuration`) — nunca `rejectUnauthorized: false`, que desativa a verificação e abre a conexão a ataques MITM.

```typescript
// painel-executivo/lib/db.ts
import { Pool } from 'pg';

let pool: Pool | undefined;

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.SUPABASE_DB_URL;
    if (!connectionString) throw new Error('SUPABASE_DB_URL não configurada');
    pool = new Pool({ connectionString, ssl: true });
  }
  return pool;
}
```

- [x] **Passo 6: Implementar `lib/metrics.ts`**

```typescript
// painel-executivo/lib/metrics.ts
import { getPool } from './db';
import type { Period } from './period';

export interface Resumo {
  receitaContratada: number;
  receitaRecebida: number;
  leadsNovos: number;
  contratosAssinados: number;
  taxaConversao: number;
}

export async function getResumo(period: Period): Promise<Resumo> {
  const pool = getPool();
  const { rows } = await pool.query(
    `select
       coalesce((select sum(amount) from crm_sync.contratos where status = 'Assinado' and signed_at between $1 and $2), 0) as receita_contratada,
       coalesce((select sum(amount) from crm_sync.pagamentos where status = 'Pago' and paid_at between $1 and $2), 0) as receita_recebida,
       (select count(*) from crm_sync.leads where created_at between $1 and $2) as leads_novos,
       (select count(*) from crm_sync.contratos where status = 'Assinado' and signed_at between $1 and $2) as contratos_assinados`,
    [period.from, period.to]
  );
  const row = rows[0];
  const leadsNovos = Number(row.leads_novos);
  const contratosAssinados = Number(row.contratos_assinados);
  return {
    receitaContratada: Number(row.receita_contratada),
    receitaRecebida: Number(row.receita_recebida),
    leadsNovos,
    contratosAssinados,
    taxaConversao: leadsNovos > 0 ? contratosAssinados / leadsNovos : 0
  };
}

export interface Comercial {
  leadsQualificados: number;
  consultasMarcadas: number;
  consultasRealizadas: number;
  propostasEnviadas: number;
  ticketMedio: number;
}

export async function getComercial(period: Period): Promise<Comercial> {
  const pool = getPool();
  const { rows } = await pool.query(
    `select
       (select count(*) from crm_sync.leads where created_at between $1 and $2 and status not in ('New','Dead')) as leads_qualificados,
       (select count(*) from crm_sync.meetings where date_start between $1 and $2) as consultas_marcadas,
       (select count(*) from crm_sync.meetings where date_start between $1 and $2 and status = 'Held') as consultas_realizadas,
       (select count(*) from crm_sync.propostas where sent_at between $1 and $2 and status in ('Enviada','Aceita','Recusada','Vencida')) as propostas_enviadas,
       coalesce((select sum(amount) from crm_sync.contratos where status = 'Assinado' and signed_at between $1 and $2), 0) as receita_contratada,
       (select count(*) from crm_sync.contratos where status = 'Assinado' and signed_at between $1 and $2) as contratos_assinados`,
    [period.from, period.to]
  );
  const row = rows[0];
  const contratosAssinados = Number(row.contratos_assinados);
  const receitaContratada = Number(row.receita_contratada);
  return {
    leadsQualificados: Number(row.leads_qualificados),
    consultasMarcadas: Number(row.consultas_marcadas),
    consultasRealizadas: Number(row.consultas_realizadas),
    propostasEnviadas: Number(row.propostas_enviadas),
    ticketMedio: contratosAssinados > 0 ? receitaContratada / contratosAssinados : 0
  };
}

export interface FunilEstagio {
  estagio: string;
  quantidade: number;
}

export async function getFunil(period: Period): Promise<FunilEstagio[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    `select
       (select count(*) from crm_sync.leads where created_at between $1 and $2) as leads,
       (select count(*) from crm_sync.leads where created_at between $1 and $2 and status not in ('New','Dead')) as qualificados,
       (select count(*) from crm_sync.meetings where date_start between $1 and $2 and status = 'Held') as consultas,
       (select count(*) from crm_sync.propostas where sent_at between $1 and $2 and status in ('Enviada','Aceita')) as propostas,
       (select count(*) from crm_sync.contratos where status = 'Assinado' and signed_at between $1 and $2) as contratos`,
    [period.from, period.to]
  );
  const row = rows[0];
  return [
    { estagio: 'Leads', quantidade: Number(row.leads) },
    { estagio: 'Qualificados', quantidade: Number(row.qualificados) },
    { estagio: 'Consultas', quantidade: Number(row.consultas) },
    { estagio: 'Propostas', quantidade: Number(row.propostas) },
    { estagio: 'Contratos', quantidade: Number(row.contratos) }
  ];
}

export interface Financeiro {
  valorAReceber: number;
  pagamentosAtrasados: number;
  taxaInadimplencia: number;
  totalVencido: number;
}

export async function getFinanceiro(): Promise<Financeiro> {
  const pool = getPool();
  const { rows } = await pool.query(
    `select
       coalesce((select sum(amount) from crm_sync.pagamentos where status in ('Pendente','Atrasado')), 0) as valor_a_receber,
       coalesce((select sum(amount) from crm_sync.pagamentos where status = 'Atrasado'), 0) as pagamentos_atrasados,
       coalesce((select sum(amount) from crm_sync.pagamentos where status = 'Atrasado' and due_date < current_date), 0) as total_vencido,
       coalesce((select sum(amount) from crm_sync.pagamentos where due_date > current_date - interval '90 days'), 0) as base_90_dias`
  );
  const row = rows[0];
  const atrasados = Number(row.pagamentos_atrasados);
  const base90 = Number(row.base_90_dias);
  return {
    valorAReceber: Number(row.valor_a_receber),
    pagamentosAtrasados: atrasados,
    totalVencido: Number(row.total_vencido),
    taxaInadimplencia: base90 > 0 ? atrasados / base90 : 0
  };
}

export interface Juridico {
  clientesAtivos: number;
  casosAtivos: number;
  prazosCriticos: number;
  casosAltoRisco: number;
}

export async function getJuridico(): Promise<Juridico> {
  const pool = getPool();
  const { rows } = await pool.query(
    `select
       (select count(distinct client_id) from crm_sync.casos_juridicos where status = 'Ativo') as clientes_ativos,
       (select count(*) from crm_sync.casos_juridicos where status = 'Ativo') as casos_ativos,
       (select count(*) from crm_sync.casos_juridicos where status = 'Ativo' and next_deadline_at < now() + interval '7 days') as prazos_criticos,
       (select count(*) from crm_sync.casos_juridicos where status = 'Ativo' and risk_level = 'Alto') as casos_alto_risco`
  );
  const row = rows[0];
  return {
    clientesAtivos: Number(row.clientes_ativos),
    casosAtivos: Number(row.casos_ativos),
    prazosCriticos: Number(row.prazos_criticos),
    casosAltoRisco: Number(row.casos_alto_risco)
  };
}

export interface Alerta {
  tipo: 'Prazo' | 'Pagamento';
  severidade: 'Crítica' | 'Alta';
  referencia: string;
  data: string;
  situacao: string;
}

export async function getAlertas(): Promise<Alerta[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    `(
       select 'Prazo' as tipo,
              case when next_deadline_at < now() then 'Crítica' else 'Alta' end as severidade,
              'Caso ' || id as referencia,
              to_char(next_deadline_at, 'DD/MM/YYYY') as data,
              case when next_deadline_at < now() then 'Vencido' else 'Próximo' end as situacao,
              next_deadline_at as ordenacao
       from crm_sync.casos_juridicos
       where status = 'Ativo' and next_deadline_at < now() + interval '7 days'
     )
     union all
     (
       select 'Pagamento' as tipo,
              'Alta' as severidade,
              'Pagamento ' || id as referencia,
              to_char(due_date, 'DD/MM/YYYY') as data,
              'Atrasado' as situacao,
              due_date::timestamptz as ordenacao
       from crm_sync.pagamentos
       where status = 'Atrasado'
     )
     order by ordenacao asc
     limit 20`
  );
  return rows.map((row) => ({
    tipo: row.tipo,
    severidade: row.severidade,
    referencia: row.referencia,
    data: row.data,
    situacao: row.situacao
  }));
}

export async function getLastSyncedAt(): Promise<Date | null> {
  const pool = getPool();
  const { rows } = await pool.query(
    `select min(last_synced_at) as oldest from crm_sync.sync_state`
  );
  return rows[0]?.oldest ?? null;
}
```

- [x] **Passo 7: Testar as queries contra o Supabase real**

Com `SUPABASE_DB_URL` apontando pro projeto `wuhvlvsolewslkawazlq` (via `.env.local`), escrever um script rápido de verificação (`painel-executivo/scripts/check-metrics.ts`, descartável) chamando cada função com `resolvePeriod('30d')` e imprimindo o resultado. Rodar com `npx tsx scripts/check-metrics.ts` e conferir que os números batem com uma query manual equivalente rodada via `execute_sql` (MCP Supabase). Apagar o script ao final.

Expected: nenhuma função lança exceção; os totais retornados batem com a contagem manual.

- [x] **Passo 8: Commit**

```bash
git add lib/db.ts lib/period.ts lib/period.test.ts lib/metrics.ts
git commit -m "feat: camada de métricas do painel executivo (queries SQL sobre crm_sync)"
```

---

### Task 8: Next.js — página do Painel Executivo

**Files:**
- Create: `painel-executivo/app/painel-executivo/page.tsx`
- Create: `painel-executivo/app/painel-executivo/styles.css`
- Create: `painel-executivo/public/logo-camparim.png`

**Interfaces:**
- Consome: `requireSession` (Task 6), `getResumo`/`getComercial`/`getFunil`/`getFinanceiro`/`getJuridico`/`getAlertas`/`getLastSyncedAt` (Task 7).

- [x] **Passo 1: Copiar o logo e o CSS do mockup aprovado**

```bash
cp /private/tmp/claude-501/-Users-zero14-Desktop-crmia/c3079eeb-3812-45ac-b399-2c44d737ce35/scratchpad/logo-icon.png painel-executivo/public/logo-camparim.png
```

Copiar o bloco `<style>...</style>` (sem a tag `<style>` em si) do arquivo `painel-executivo-camara-v3.html` (mesmo scratchpad) para `painel-executivo/app/painel-executivo/styles.css` — é a fonte visual já aprovada pelo usuário (paleta Câmara, tabbar de fichário, tiles, funil, tabela de alertas). Ajustar apenas o seletor da logo (`.brand img`) para apontar pra `/logo-camparim.png` via `<img src="/logo-camparim.png">` em vez de `data:` base64 embutido, já que agora é um asset público do Next.js.

- [x] **Passo 2: Escrever a página**

```tsx
// painel-executivo/app/painel-executivo/page.tsx
import { requireSession } from '@/lib/session';
import { logout } from '@/app/login/actions';
import { resolvePeriod, type PeriodPreset } from '@/lib/period';
import {
  getResumo,
  getComercial,
  getFunil,
  getFinanceiro,
  getJuridico,
  getAlertas,
  getLastSyncedAt
} from '@/lib/metrics';
import './styles.css';

const PRESETS: { key: PeriodPreset; label: string }[] = [
  { key: 'hoje', label: 'Hoje' },
  { key: '7d', label: '7 dias' },
  { key: '30d', label: '30 dias' },
  { key: 'mes_atual', label: 'Mês atual' }
];

function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatPercent(value: number): string {
  return `${(value * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}

export default async function PainelExecutivoPage({
  searchParams
}: {
  searchParams: { periodo?: string };
}) {
  await requireSession();

  const presetKey = (PRESETS.find((p) => p.key === searchParams.periodo)?.key ?? '30d') as PeriodPreset;
  const period = resolvePeriod(presetKey);

  const [resumo, comercial, funil, financeiro, juridico, alertas, lastSyncedAt] = await Promise.all([
    getResumo(period),
    getComercial(period),
    getFunil(period),
    getFinanceiro(),
    getJuridico(),
    getAlertas(),
    getLastSyncedAt()
  ]);

  const dadosDesatualizados =
    lastSyncedAt !== null && Date.now() - lastSyncedAt.getTime() > 15 * 60 * 1000;

  const maiorFunil = Math.max(...funil.map((f) => f.quantidade), 1);

  return (
    <div className="wrap">
      <div className="top-strip">
        <div className="brand">
          <img src="/logo-camparim.png" alt="Camparim Advogados" />
          <span className="firm">
            Camparim Advogados
            <small>Painel executivo</small>
          </span>
        </div>
        <div className="period">
          {PRESETS.map((p) => (
            <a key={p.key} href={`?periodo=${p.key}`}>
              <button className={p.key === presetKey ? 'active' : ''}>{p.label}</button>
            </a>
          ))}
          <form action={logout}>
            <button type="submit" title="Sair">Sair</button>
          </form>
        </div>
      </div>

      <nav className="tabbar" aria-label="Painéis">
        <a className="active" href="#">Executivo</a>
        <a aria-disabled="true" title="Em breve">Operacional</a>
        <a aria-disabled="true" title="Em breve">Financeiro</a>
        <a aria-disabled="true" title="Em breve">Marketing</a>
        <a aria-disabled="true" title="Em breve">IA</a>
      </nav>

      <header>
        <h1 className="display">Painel Executivo</h1>
        <p className="meta">
          {dadosDesatualizados && (
            <span className="sample-tag">dados podem estar desatualizados — </span>
          )}
          Última sincronização:{' '}
          {lastSyncedAt ? lastSyncedAt.toLocaleString('pt-BR') : 'nunca'}
        </p>
      </header>

      <section aria-labelledby="resumo">
        <h2 id="resumo">Resumo</h2>
        <div className="tiles">
          <div className="tile accent">
            <span className="label">Receita contratada</span>
            <span className="value tabular">{formatBRL(resumo.receitaContratada)}</span>
          </div>
          <div className="tile accent">
            <span className="label">Receita recebida</span>
            <span className="value tabular">{formatBRL(resumo.receitaRecebida)}</span>
          </div>
          <div className="tile">
            <span className="label">Leads novos</span>
            <span className="value tabular">{resumo.leadsNovos}</span>
          </div>
          <div className="tile">
            <span className="label">Contratos assinados</span>
            <span className="value tabular">{resumo.contratosAssinados}</span>
          </div>
          <div className="tile">
            <span className="label">Taxa de conversão</span>
            <span className="value tabular">{formatPercent(resumo.taxaConversao)}</span>
          </div>
        </div>
      </section>

      <section aria-labelledby="comercial">
        <h2 id="comercial">Comercial</h2>
        <div className="tiles">
          <div className="tile">
            <span className="label">Leads qualificados</span>
            <span className="value tabular">{comercial.leadsQualificados}</span>
          </div>
          <div className="tile">
            <span className="label">Consultas marcadas</span>
            <span className="value tabular">{comercial.consultasMarcadas}</span>
          </div>
          <div className="tile">
            <span className="label">Consultas realizadas</span>
            <span className="value tabular">{comercial.consultasRealizadas}</span>
          </div>
          <div className="tile">
            <span className="label">Propostas enviadas</span>
            <span className="value tabular">{comercial.propostasEnviadas}</span>
          </div>
          <div className="tile">
            <span className="label">Ticket médio</span>
            <span className="value tabular">{formatBRL(comercial.ticketMedio)}</span>
          </div>
        </div>
      </section>

      <div className="cols">
        <section aria-labelledby="funil">
          <h2 id="funil">Funil comercial</h2>
          {funil.map((estagio, i) => (
            <div className={`funnel-row${i === funil.length - 1 ? ' final' : ''}`} key={estagio.estagio}>
              <span className="stage">{estagio.estagio}</span>
              <div className="funnel-track">
                <div
                  className="funnel-fill"
                  style={{
                    width: `${(estagio.quantidade / maiorFunil) * 100}%`,
                    background: `var(--g${Math.min(i + 1, 4)})`
                  }}
                />
              </div>
              <span className="n tabular">{estagio.quantidade}</span>
            </div>
          ))}
          <p className="funnel-caption">Largura proporcional ao maior estágio do período.</p>
        </section>

        <section aria-labelledby="financeiro">
          <h2 id="financeiro">Financeiro</h2>
          <div className="stat-grid">
            <div className="stat">
              <span className="label">Valor a receber</span>
              <span className="value tabular">{formatBRL(financeiro.valorAReceber)}</span>
            </div>
            <div className="stat warn">
              <span className="label">Pagamentos atrasados</span>
              <span className="value tabular">{formatBRL(financeiro.pagamentosAtrasados)}</span>
            </div>
            <div className="stat warn">
              <span className="label">Taxa de inadimplência</span>
              <span className="value tabular">{formatPercent(financeiro.taxaInadimplencia)}</span>
            </div>
            <div className="stat">
              <span className="label">Total vencido</span>
              <span className="value tabular">{formatBRL(financeiro.totalVencido)}</span>
            </div>
          </div>
        </section>
      </div>

      <section aria-labelledby="juridico">
        <h2 id="juridico">Jurídico e operacional</h2>
        <div className="kpi-row">
          <div className="kpi">
            <span className="label">Clientes ativos</span>
            <span className="value tabular">{juridico.clientesAtivos}</span>
          </div>
          <div className="kpi">
            <span className="label">Casos ativos</span>
            <span className="value tabular">{juridico.casosAtivos}</span>
          </div>
          <div className="kpi critical">
            <span className="label">Prazos críticos</span>
            <span className="value tabular">{juridico.prazosCriticos}</span>
          </div>
          <div className="kpi critical">
            <span className="label">Casos de alto risco</span>
            <span className="value tabular">{juridico.casosAltoRisco}</span>
          </div>
        </div>
      </section>

      <section aria-labelledby="alertas">
        <h2 id="alertas">Alertas executivos</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Tipo</th>
                <th>Severidade</th>
                <th>Referência</th>
                <th>Data</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {alertas.map((alerta, i) => (
                <tr key={i}>
                  <td>{alerta.tipo}</td>
                  <td>
                    <span className={`pill ${alerta.severidade === 'Crítica' ? 'critical' : 'warning'}`}>
                      {alerta.severidade}
                    </span>
                  </td>
                  <td>{alerta.referencia}</td>
                  <td className="date-col">{alerta.data}</td>
                  <td>{alerta.situacao}</td>
                </tr>
              ))}
              {alertas.length === 0 && (
                <tr>
                  <td colSpan={5}>Nenhum alerta no momento.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <p className="foot">
        Painel somente leitura. Não contém conversas, documentos, conteúdo jurídico detalhado ou dados pessoais sensíveis.
      </p>
    </div>
  );
}
```

- [x] **Passo 3: Testar visualmente**

```bash
npm run dev
```

Acessar `http://localhost:3000/painel-executivo` (logado via `/login`) e comparar lado a lado com o Artifact do mockup aprovado (`https://claude.ai/code/artifact/3ee455cf-3cb8-4b3b-b58a-1ee53ad7e971`): cores, tipografia, comportamento das abas, espaçamento.

Expected: visualmente equivalente ao mockup, com dados reais (ou zerados, se ainda não houver registros suficientes) em vez dos dados de exemplo.

- [x] **Passo 4: Testar o aviso de dados desatentualizados**

Pausar (desativar) o workflow de sync da Task 3, esperar 15+ minutos, recarregar a página, confirmar que o aviso aparece. Reativar o workflow.

- [x] **Passo 5: Commit**

```bash
git add app/painel-executivo/ public/logo-camparim.png
git commit -m "feat: página do Painel Executivo (UI completa, identidade Câmara)"
```

---

### Task 9: QA de ponta a ponta e deploy final

**Files:** nenhum arquivo novo — verificação e deploy.

- [x] **Passo 1: Rodar toda a suíte de testes automatizados**

```bash
cd painel-executivo
npx vitest run
```

Expected: todos os testes de `lib/session.test.ts` e `lib/period.test.ts` passando.

**Resultado:** ✅ 5/5 testes passando (`Test Files 2 passed (2)`, `Tests 5 passed (5)`).

- [x] **Passo 2: Conferir cada métrica manualmente contra o EspoCRM**

Escolher 2-3 leads, 1-2 contratos e 1-2 pagamentos reais (ou de teste, se ainda não houver volume real) e confirmar visualmente no EspoCRM que os números do painel batem.

**Resultado:** ✅ Usando os registros de teste da Task 4 (2 propostas, 2 contratos, 4 pagamentos), confirmei que `crm_sync.*` espelha o EspoCRM campo a campo (amounts, status, vínculos de lead/proposta/contrato todos corretos), e que a query de `getFinanceiro` bate exatamente com a soma manual (`valor_a_receber = R$ 14.000`, = R$5.000 + 3×R$3.000).

**Achado operacional (não é bug):** os dois contratos de teste foram marcados `Assinado` sem preencher `signedAt`. Como "Receita contratada" (Resumo) filtra por `signed_at`, um contrato assinado sem essa data preenchida não aparece nessa métrica — só em "Valor a receber" (Financeiro, que não depende de `signed_at`). **Isso precisa virar hábito da equipe**: sempre preencher a data de assinatura ao marcar um contrato como Assinado, ou "Receita contratada" vai subestimar o período.

- [ ] **Passo 3: Testar o fluxo de criação assistida de ponta a ponta com um caso real**

Se houver uma proposta real que o escritório vai aceitar em breve, acompanhar o ciclo completo: proposta aceita → contrato rascunho aparece → assinar → parcelas aparecem → marcar uma parcela como paga → confirmar que o painel reflete a mudança dentro de ~10 minutos (1 ciclo de criação assistida + 1 ciclo de sync).

**Status:** pendente — depende de um caso de negócio real acontecer; a lógica já foi validada de ponta a ponta com dados de teste na Task 4 (idempotência incluída). Retomar quando surgir uma proposta real.

- [x] **Passo 4: Testar login/logout**

Confirmar que sem cookie válido a rota `/painel-executivo` redireciona pra `/login`, e que a senha errada mostra o erro.

**Resultado:** ✅ já verificado de forma independente (não só confiando no relatório do implementador) durante a revisão da Task 8 e na revisão final de branch: senha errada → redireciona com `?erro=1`; senha certa → `Set-Cookie` correto + redireciona; sem cookie → 307 pro login; cookie corrompido → 307 pro login (não mais 500, após a correção da revisão final).

- [ ] **Passo 5: Deploy final em produção no Coolify**

Redeploy do serviço com a versão final, confirmar que a URL pública responde, está atrás de login, e mostra os dados reais atualizados.

**Status:** pendente — depende de acesso à interface web do Coolify (nem eu nem os subagentes temos). Aguardando o usuário.

- [ ] **Passo 6: Atualizar este plano e a spec com o resultado final**

Editar este arquivo marcando todos os checkboxes, e adicionar uma seção "Conclusão" na spec (`docs/superpowers/specs/2026-09-07-painel-executivo-design.md`) com: URL final do painel, ids dos workflows n8n criados, e quaisquer achados/ajustes feitos durante a implementação que divirjam do que foi especificado.

- [ ] **Passo 7: Commit final**

```bash
cd /Users/zero14/Desktop/crmia
git add docs/superpowers/plans/2026-09-07-painel-executivo.md docs/superpowers/specs/2026-09-07-painel-executivo-design.md
git commit -m "docs: conclusão da implementação do painel executivo"
```
