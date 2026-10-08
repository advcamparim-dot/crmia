# Painéis, Fase 1: Base de Dados Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar a base de dados que os painéis precisam (campo campanha, histórico de status, batimento da sincronização, gasto com anúncios, schema `painel` com papel somente leitura e views), sem alterar o painel atual.

**Architecture:** Tudo no Postgres do Supabase (migrations numeradas a partir da 0025, testadas em transação com rollback) mais três ajustes pequenos no n8n e um campo no EspoCRM. O histórico de status vem de um gatilho em `crm_sync.leads`, que dispensa editar o workflow de sincronização. O app Next.js só passa a usar o papel e as views na Fase 2.

**Tech Stack:** PostgreSQL (Supabase), EspoCRM API, n8n (workflows), Node/Vitest já existentes (sem mudança de código do app nesta fase).

**Spec:** `docs/superpowers/specs/2026-10-08-paineis-ceo-administrador-design.md` (seção "Base de dados (Fase 1)")

## Global Constraints

- Migrations em `supabase/migrations/0025_...` até `0029_...`; testes em `supabase/tests/00NN_*.test.sql` com `begin; ... rollback;` terminando em `select 'OK 00NN'`.
- Funções com `set search_path = ''`. Tabelas novas com RLS ligado e `revoke all ... from anon, authenticated`.
- Nenhuma view expõe telefone, e-mail, descrição ou texto de conversa.
- Eu não apago dados com as ferramentas; qualquer `delete` é SQL entregue ao usuário. Não usar `drop` nem `create or replace trigger` em migration (a ferramenta recusa); usar `create trigger`.
- n8n: depois de qualquer "Connection closed", reler o workflow antes de repetir; edições pequenas (notação de ponto, `addNode`/`addConnection`).
- Senhas e chaves nunca vão para o chat nem para o Git. O papel `painel_leitura` nasce `NOLOGIN`; a senha é definida pelo usuário depois (Fase 2).
- Commits terminam com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Projeto Supabase: `wuhvlvsolewslkawazlq`. Credencial n8n do banco: `nNpCUIhnDuVvTApU`. Credencial do CRM: `3CNvCGWMMDOyGD2n`.

## Review Focus

1. O gatilho grava histórico só quando o status muda de fato (e na criação), nunca em sincronização repetida com o mesmo status.
2. Nenhuma view tem coluna de telefone, e-mail, descrição ou conteúdo de conversa.
3. `painel_leitura` lê as views e não consegue ler `crm_sync.*`, `mayara.*` nem tabelas de origem.
4. Gasto: valor zero ou negativo rejeitado; mesmo par campanha+mês (ignorando caixa e espaços) atualiza em vez de duplicar; mês sempre normalizado para o dia 1.
5. Saúde da sincronização usa o **batimento**, não o cursor: entidade sem alterações no CRM não pode aparecer como "atrasada".

## File Structure

- Create: `supabase/migrations/0025_painel_schema_papel.sql`, `0026_crm_sync_historico_status.sql`, `0027_crm_sync_campanha_batimento.sql`, `0028_painel_gasto_anuncios.sql`, `0029_painel_views.sql`
- Create: `supabase/tests/0025_painel_schema_papel.test.sql` ... `0029_painel_views.test.sql`
- Create: `docs/superpowers/specs/2026-10-08-auditoria-campos-crm.md` (resultado da auditoria, Task 1)
- Modify (n8n, sem arquivo no repositório): workflow `PH73hjj7zIABuZ74` (sincronização), sub-workflow `LkiVmBMUzRm8q9Re` (lead do grupo)
- Modify: `docs/superpowers/specs/2026-10-07-lead-grupo-agencia/gerar-workflow.mjs` e o export `docs/superpowers/specs/workflows/mayara-lead-grupo-agencia.json`

---

### Task 1: Auditoria dos campos do CRM (somente leitura)

**Files:**
- Create: `docs/superpowers/specs/2026-10-08-auditoria-campos-crm.md`

**Interfaces:**
- Produces: a lista oficial de campos de `Lead`, `Meeting`, `CProposta`, `CContrato`, `CPagamento`, `CCasoJuridico` e `Task`, com a indicação de qual campo de `CContrato` representa **honorários** e de quais campos faltam (êxito, passivo do cliente). Tasks 3 a 5 e a Fase 4 consomem este documento.

- [ ] **Step 1: Tentar ler os metadados do CRM**

Criar um workflow temporário de leitura (webhook com caminho aleatório, credencial do CRM) que faça `GET https://crm.camparimadvogados.com.br/api/v1/Metadata?key=entityDefs` e devolva, por entidade, apenas `{campo: tipo}` (sem dados de registros). Entidades: `Lead`, `Meeting`, `CProposta`, `CContrato`, `CPagamento`, `CCasoJuridico`, `Task`.
Expected: JSON com os campos de cada entidade. Se responder 401/403, o usuário exporta pela interface (Administração > Gerenciador de entidades > entidade > Campos) e cola a lista; seguir com o que for colado.

- [ ] **Step 2: Gravar o resultado**

Escrever `docs/superpowers/specs/2026-10-08-auditoria-campos-crm.md` com uma tabela por entidade (campo, tipo, usado pela sincronização? sim/não) e uma seção "Lacunas" listando: campo de campanha no lead, campo que separa honorário fixo de êxito, campo de passivo do cliente, campo de próxima ação e data prevista.

- [ ] **Step 3: Desativar o workflow temporário e commitar**

```bash
git add docs/superpowers/specs/2026-10-08-auditoria-campos-crm.md
git commit -m "docs(painel): auditoria dos campos do CRM"
```

---

### Task 2: Schema `painel` e papel somente leitura

**Files:**
- Create: `supabase/migrations/0025_painel_schema_papel.sql`
- Test: `supabase/tests/0025_painel_schema_papel.test.sql`

**Interfaces:**
- Produces: schema `painel`; papel `painel_leitura` (`NOLOGIN`) com `usage` no schema `painel` e nenhum acesso a `crm_sync`, `mayara`, `public`. Tasks 5 e 6 concedem `select` às views.

- [ ] **Step 1: Escrever o teste (deve falhar)**

```sql
-- supabase/tests/0025_painel_schema_papel.test.sql
begin;
do $t$
begin
  assert exists (select 1 from pg_namespace where nspname = 'painel'), 'schema painel existe';
  assert exists (select 1 from pg_roles where rolname = 'painel_leitura'), 'papel existe';
  assert not (select rolcanlogin from pg_roles where rolname = 'painel_leitura'), 'papel nasce sem login';
  assert has_schema_privilege('painel_leitura', 'painel', 'usage'), 'usage no schema painel';
  assert not has_schema_privilege('painel_leitura', 'crm_sync', 'usage'), 'sem acesso a crm_sync';
  assert not has_schema_privilege('painel_leitura', 'mayara', 'usage'), 'sem acesso a mayara';
  assert not has_table_privilege('painel_leitura', 'crm_sync.leads', 'select'), 'nao le crm_sync.leads';
end $t$;
rollback;
select 'OK 0025' as resultado;
```

- [ ] **Step 2: Rodar e ver falhar**

Run: o conteúdo acima via `execute_sql`.
Expected: FAIL com `schema painel existe`.

- [ ] **Step 3: Escrever a migration**

```sql
-- supabase/migrations/0025_painel_schema_papel.sql
create schema if not exists painel;

do $r$
begin
  if not exists (select 1 from pg_roles where rolname = 'painel_leitura') then
    create role painel_leitura nologin;
  end if;
end $r$;

revoke all on schema painel from public, anon, authenticated;
grant usage on schema painel to painel_leitura;
alter default privileges in schema painel revoke all on tables from public, anon, authenticated;
```

- [ ] **Step 4: Aplicar (`apply_migration`, nome `painel_schema_papel`) e rodar o teste**

Expected: `OK 0025`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0025_painel_schema_papel.sql supabase/tests/0025_painel_schema_papel.test.sql
git commit -m "feat(painel): schema painel e papel somente leitura (migration 0025)"
```

---

### Task 3: Histórico de status dos leads

**Files:**
- Create: `supabase/migrations/0026_crm_sync_historico_status.sql`
- Test: `supabase/tests/0026_crm_sync_historico_status.test.sql`

**Interfaces:**
- Consumes: `crm_sync.leads(id, status, created_at, modified_at)`.
- Produces: `crm_sync.lead_historico_status(id, lead_id, status_anterior, status_novo, mudou_em, origem)`; gatilho `leads_historico_status`. A view da Task 6 lê esta tabela.

- [ ] **Step 1: Escrever o teste (deve falhar)**

```sql
-- supabase/tests/0026_crm_sync_historico_status.test.sql
begin;
do $t$
begin
  -- criacao registra o status inicial
  insert into crm_sync.leads (id, name, status, created_at, modified_at) values ('t-h1', 'Teste', 'New', '2026-10-01 10:00+00', '2026-10-01 10:00+00');
  assert (select count(*) from crm_sync.lead_historico_status where lead_id = 't-h1') = 1, 'criacao grava 1 linha';
  assert (select status_anterior from crm_sync.lead_historico_status where lead_id = 't-h1') is null, 'anterior nulo na criacao';
  assert (select mudou_em from crm_sync.lead_historico_status where lead_id = 't-h1') = '2026-10-01 10:00+00', 'data da criacao';

  -- sincronizacao repetida com o mesmo status nao grava
  update crm_sync.leads set status = 'New', name = 'Teste 2', modified_at = '2026-10-01 11:00+00' where id = 't-h1';
  assert (select count(*) from crm_sync.lead_historico_status where lead_id = 't-h1') = 1, 'mesmo status nao duplica';

  -- mudanca real grava anterior, novo e data do CRM
  update crm_sync.leads set status = 'Assigned', modified_at = '2026-10-02 09:30+00' where id = 't-h1';
  assert (select count(*) from crm_sync.lead_historico_status where lead_id = 't-h1') = 2, 'mudanca grava';
  assert (select status_anterior || '>' || status_novo from crm_sync.lead_historico_status where lead_id = 't-h1' order by id desc limit 1) = 'New>Assigned', 'anterior e novo';
  assert (select mudou_em from crm_sync.lead_historico_status where lead_id = 't-h1' order by id desc limit 1) = '2026-10-02 09:30+00', 'usa a data do CRM';

  -- upsert do n8n (insert ... on conflict do update) so grava quando o status muda
  insert into crm_sync.leads (id, name, status, created_at, modified_at) values ('t-h1', 'Teste 3', 'Assigned', '2026-10-01 10:00+00', '2026-10-03 08:00+00')
    on conflict (id) do update set name = excluded.name, status = excluded.status, modified_at = excluded.modified_at;
  assert (select count(*) from crm_sync.lead_historico_status where lead_id = 't-h1') = 2, 'upsert sem mudanca nao grava';
  insert into crm_sync.leads (id, name, status, created_at, modified_at) values ('t-h1', 'Teste 3', 'Dead', '2026-10-01 10:00+00', '2026-10-04 08:00+00')
    on conflict (id) do update set name = excluded.name, status = excluded.status, modified_at = excluded.modified_at;
  assert (select count(*) from crm_sync.lead_historico_status where lead_id = 't-h1') = 3, 'upsert com mudanca grava';

  -- os leads existentes receberam uma linha de partida
  assert not exists (select 1 from crm_sync.leads l where l.id not like 't-%' and not exists (select 1 from crm_sync.lead_historico_status h where h.lead_id = l.id)), 'todo lead tem ao menos uma linha';
  assert (select count(distinct origem) from crm_sync.lead_historico_status where origem = 'snapshot') in (0, 1), 'origem snapshot valida';

  -- acesso fechado
  assert not has_table_privilege('anon', 'crm_sync.lead_historico_status', 'select'), 'anon sem select';
  assert not has_table_privilege('authenticated', 'crm_sync.lead_historico_status', 'select'), 'authenticated sem select';
end $t$;
rollback;
select 'OK 0026' as resultado;
```

- [ ] **Step 2: Rodar e ver falhar**

Expected: FAIL (`relation "crm_sync.lead_historico_status" does not exist`).

- [ ] **Step 3: Escrever a migration**

```sql
-- supabase/migrations/0026_crm_sync_historico_status.sql
create table crm_sync.lead_historico_status (
  id bigserial primary key,
  lead_id text not null,
  status_anterior text,
  status_novo text,
  mudou_em timestamptz not null default now(),
  origem text not null default 'evento' check (origem in ('evento', 'snapshot'))
);
create index lead_historico_status_lead_idx on crm_sync.lead_historico_status (lead_id, mudou_em);
alter table crm_sync.lead_historico_status enable row level security;
revoke all on crm_sync.lead_historico_status from anon, authenticated;

create or replace function crm_sync.registrar_mudanca_status()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into crm_sync.lead_historico_status (lead_id, status_anterior, status_novo, mudou_em)
    values (new.id, null, new.status, coalesce(new.created_at, now()));
  elsif new.status is distinct from old.status then
    insert into crm_sync.lead_historico_status (lead_id, status_anterior, status_novo, mudou_em)
    values (new.id, old.status, new.status, coalesce(new.modified_at, now()));
  end if;
  return new;
end $$;

create trigger leads_historico_status
  after insert or update of status on crm_sync.leads
  for each row execute function crm_sync.registrar_mudanca_status();

-- ponto de partida para os leads que ja existem: o historico real so existe daqui para frente
insert into crm_sync.lead_historico_status (lead_id, status_anterior, status_novo, mudou_em, origem)
select id, null, status, now(), 'snapshot' from crm_sync.leads;
```

- [ ] **Step 4: Aplicar (`apply_migration`, nome `crm_sync_historico_status`) e rodar o teste**

Expected: `OK 0026`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0026_crm_sync_historico_status.sql supabase/tests/0026_crm_sync_historico_status.test.sql
git commit -m "feat(painel): historico de status dos leads por gatilho (migration 0026)"
```

---

### Task 4: Coluna campanha e batimento da sincronização

**Files:**
- Create: `supabase/migrations/0027_crm_sync_campanha_batimento.sql`
- Test: `supabase/tests/0027_crm_sync_campanha_batimento.test.sql`

**Interfaces:**
- Produces: coluna `crm_sync.leads.campaign text`; tabela `crm_sync.sync_batimento` (uma linha) e função `crm_sync.registrar_batimento()`. Task 6 lê o batimento; Task 7 liga o n8n a ele.

- [ ] **Step 1: Escrever o teste (deve falhar)**

```sql
-- supabase/tests/0027_crm_sync_campanha_batimento.test.sql
begin;
do $t$
begin
  assert exists (select 1 from information_schema.columns where table_schema = 'crm_sync' and table_name = 'leads' and column_name = 'campaign'), 'coluna campaign existe';
  insert into crm_sync.leads (id, name, status, campaign) values ('t-c1', 'Teste', 'New', '[MF] GESTÃO DE PASSIVO');
  assert (select campaign from crm_sync.leads where id = 't-c1') = '[MF] GESTÃO DE PASSIVO', 'guarda a campanha';

  perform crm_sync.registrar_batimento();
  assert (select count(*) from crm_sync.sync_batimento) = 1, 'uma linha';
  assert (select executou_em from crm_sync.sync_batimento) > now() - interval '1 minute', 'batimento recente';
  update crm_sync.sync_batimento set executou_em = now() - interval '1 hour';
  perform crm_sync.registrar_batimento();
  assert (select count(*) from crm_sync.sync_batimento) = 1, 'segue com uma linha';
  assert (select executou_em from crm_sync.sync_batimento) > now() - interval '1 minute', 'atualiza o horario';

  assert not has_function_privilege('anon', 'crm_sync.registrar_batimento()', 'execute'), 'anon sem execute';
  assert not has_function_privilege('authenticated', 'crm_sync.registrar_batimento()', 'execute'), 'authenticated sem execute';
  assert not has_table_privilege('anon', 'crm_sync.sync_batimento', 'select'), 'anon sem select';
end $t$;
rollback;
select 'OK 0027' as resultado;
```

- [ ] **Step 2: Rodar e ver falhar**

Expected: FAIL em `coluna campaign existe`.

- [ ] **Step 3: Escrever a migration**

```sql
-- supabase/migrations/0027_crm_sync_campanha_batimento.sql
alter table crm_sync.leads add column campaign text;

-- O cursor de sync_state so avanca quando ha alteracao no CRM; ele nao prova que a sincronizacao esta viva.
-- O batimento e gravado a cada execucao do workflow (a cada 5 min).
create table crm_sync.sync_batimento (
  id int primary key default 1 check (id = 1),
  executou_em timestamptz not null default now()
);
alter table crm_sync.sync_batimento enable row level security;
revoke all on crm_sync.sync_batimento from anon, authenticated;

create or replace function crm_sync.registrar_batimento()
returns void language plpgsql set search_path = '' as $$
begin
  insert into crm_sync.sync_batimento (id, executou_em) values (1, now())
  on conflict (id) do update set executou_em = now();
end $$;
revoke all on function crm_sync.registrar_batimento() from public, anon, authenticated;
```

- [ ] **Step 4: Aplicar (`apply_migration`, nome `crm_sync_campanha_batimento`) e rodar o teste**

Expected: `OK 0027`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0027_crm_sync_campanha_batimento.sql supabase/tests/0027_crm_sync_campanha_batimento.test.sql
git commit -m "feat(painel): coluna campaign e batimento da sincronizacao (migration 0027)"
```

---

### Task 5: Gasto com anúncios

**Files:**
- Create: `supabase/migrations/0028_painel_gasto_anuncios.sql`
- Test: `supabase/tests/0028_painel_gasto_anuncios.test.sql`

**Interfaces:**
- Produces: tabela `painel.gasto_anuncios` e função `painel.registrar_gasto(p_campanha text, p_mes date, p_valor numeric) returns jsonb`. O formulário do painel (Fase 3) chama a função; até lá o lançamento é feito por SQL assistido.

- [ ] **Step 1: Escrever o teste (deve falhar)**

```sql
-- supabase/tests/0028_painel_gasto_anuncios.test.sql
begin;
do $t$
declare r jsonb;
begin
  r := painel.registrar_gasto('[MF] GESTÃO DE PASSIVO', '2026-10-17', 1500.50);
  assert (r ->> 'mes') = '2026-10-01', 'normaliza o mes para o dia 1: ' || r::text;
  assert (select valor from painel.gasto_anuncios) = 1500.50, 'guarda o valor';

  -- mesma campanha e mes (ignorando caixa e espacos) atualiza
  r := painel.registrar_gasto('  [mf] gestão de passivo ', '2026-10-01', 2000);
  assert (select count(*) from painel.gasto_anuncios) = 1, 'nao duplica';
  assert (select valor from painel.gasto_anuncios) = 2000, 'atualiza o valor';

  -- outro mes cria nova linha
  perform painel.registrar_gasto('[MF] GESTÃO DE PASSIVO', '2026-11-05', 900);
  assert (select count(*) from painel.gasto_anuncios) = 2, 'outro mes';

  -- valores invalidos
  begin perform painel.registrar_gasto('X', '2026-10-01', 0); assert false, 'zero deveria falhar';
  exception when check_violation then null; end;
  begin perform painel.registrar_gasto('X', '2026-10-01', -5); assert false, 'negativo deveria falhar';
  exception when check_violation then null; end;
  begin perform painel.registrar_gasto('   ', '2026-10-01', 10); assert false, 'campanha vazia deveria falhar';
  exception when check_violation then null; end;

  assert not has_function_privilege('anon', 'painel.registrar_gasto(text,date,numeric)', 'execute'), 'anon sem execute';
  assert not has_function_privilege('painel_leitura', 'painel.registrar_gasto(text,date,numeric)', 'execute'), 'leitura nao grava';
  assert not has_table_privilege('painel_leitura', 'painel.gasto_anuncios', 'insert'), 'leitura sem insert';
end $t$;
rollback;
select 'OK 0028' as resultado;
```

- [ ] **Step 2: Rodar e ver falhar**

Expected: FAIL (`function painel.registrar_gasto ... does not exist`).

- [ ] **Step 3: Escrever a migration**

```sql
-- supabase/migrations/0028_painel_gasto_anuncios.sql
create table painel.gasto_anuncios (
  id bigserial primary key,
  campanha text not null check (btrim(campanha) <> ''),
  mes date not null check (mes = date_trunc('month', mes)::date),
  valor numeric(12, 2) not null check (valor > 0),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create unique index gasto_anuncios_chave on painel.gasto_anuncios (lower(btrim(campanha)), mes);
alter table painel.gasto_anuncios enable row level security;
revoke all on painel.gasto_anuncios from public, anon, authenticated, painel_leitura;

create or replace function painel.registrar_gasto(p_campanha text, p_mes date, p_valor numeric)
returns jsonb language plpgsql set search_path = '' as $$
declare v_mes date := date_trunc('month', p_mes)::date;
begin
  insert into painel.gasto_anuncios (campanha, mes, valor)
  values (btrim(p_campanha), v_mes, p_valor)
  on conflict (lower(btrim(campanha)), mes) do update
    set valor = excluded.valor, atualizado_em = now();
  return jsonb_build_object('campanha', btrim(p_campanha), 'mes', v_mes, 'valor', p_valor);
end $$;
revoke all on function painel.registrar_gasto(text, date, numeric) from public, anon, authenticated, painel_leitura;
```

- [ ] **Step 4: Aplicar (`apply_migration`, nome `painel_gasto_anuncios`) e rodar o teste**

Expected: `OK 0028`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0028_painel_gasto_anuncios.sql supabase/tests/0028_painel_gasto_anuncios.test.sql
git commit -m "feat(painel): gasto com anuncios e funcao de lancamento (migration 0028)"
```

---

### Task 6: Views do painel e concessões

**Files:**
- Create: `supabase/migrations/0029_painel_views.sql`
- Test: `supabase/tests/0029_painel_views.test.sql`

**Interfaces:**
- Consumes: `crm_sync.leads`, `crm_sync.lead_historico_status`, `crm_sync.sync_state`, `crm_sync.sync_batimento`, `painel.gasto_anuncios`.
- Produces: `painel.v_leads`, `painel.v_lead_status_historico`, `painel.v_gasto`, `painel.v_sync_cursores`, `painel.v_sync_batimento`, todas legíveis por `painel_leitura`.

- [ ] **Step 1: Escrever o teste (deve falhar)**

```sql
-- supabase/tests/0029_painel_views.test.sql
begin;
do $t$
declare colunas text;
begin
  insert into crm_sync.leads (id, name, status, campaign, source, legal_area, channel, urgency_level, lost_reason, created_at, modified_at)
    values ('t-v1', 'Teste', 'New', '[MF] GESTÃO DE PASSIVO', 'Web Site', 'Renegociação de Dívida', 'WhatsApp', 'Baixa', 'Não Respondeu', now(), now());
  perform painel.registrar_gasto('[MF] GESTÃO DE PASSIVO', '2026-10-01', 100);
  perform crm_sync.registrar_batimento();

  -- as views existem e devolvem dados
  assert (select count(*) from painel.v_leads where id = 't-v1') = 1, 'v_leads';
  assert (select campanha from painel.v_leads where id = 't-v1') = '[MF] GESTÃO DE PASSIVO', 'campanha na view';
  assert (select count(*) from painel.v_lead_status_historico where lead_id = 't-v1') = 1, 'historico';
  assert (select valor from painel.v_gasto) = 100, 'gasto';
  assert (select count(*) from painel.v_sync_cursores) >= 1, 'cursores';

  -- cursor 1970 aparece como "nunca sincronizado" e nao como atraso gigante
  update crm_sync.sync_state set last_synced_at = '1970-01-01 00:00:00+00' where entity_name = 'CCasoJuridico';
  assert (select ultima_alteracao from painel.v_sync_cursores where entidade = 'CCasoJuridico') is null, 'nunca sincronizado vira nulo';

  -- batimento recente: nao atrasado; antigo: atrasado
  assert (select atrasado from painel.v_sync_batimento) = false, 'batimento recente nao atrasa';
  update crm_sync.sync_batimento set executou_em = now() - interval '2 hours';
  assert (select atrasado from painel.v_sync_batimento) = true, 'batimento antigo atrasa';
  delete from crm_sync.sync_batimento;
  assert (select atrasado from painel.v_sync_batimento) = true, 'sem batimento algum conta como atrasado';

  -- nenhuma coluna sensivel nas views
  select string_agg(column_name, ',') into colunas from information_schema.columns
   where table_schema = 'painel' and table_name like 'v\_%' and (column_name ilike '%telefone%' or column_name ilike '%phone%' or column_name ilike '%email%' or column_name ilike '%descri%' or column_name ilike '%description%' or column_name ilike '%mensagem%');
  assert colunas is null, 'colunas sensiveis nas views: ' || coalesce(colunas, '');
end $t$;

-- papel de leitura: le as views, nao le as tabelas de origem
set local role painel_leitura;
do $t$
begin
  perform count(*) from painel.v_leads;
  perform count(*) from painel.v_gasto;
  begin perform count(*) from crm_sync.leads; assert false, 'nao deveria ler crm_sync.leads';
  exception when insufficient_privilege then null; end;
  begin perform count(*) from mayara.leads_autorizados; assert false, 'nao deveria ler mayara';
  exception when insufficient_privilege then null; end;
  begin perform count(*) from painel.gasto_anuncios; assert false, 'nao deveria ler a tabela de gasto';
  exception when insufficient_privilege then null; end;
end $t$;
reset role;
rollback;
select 'OK 0029' as resultado;
```

- [ ] **Step 2: Rodar e ver falhar**

Expected: FAIL (`relation "painel.v_leads" does not exist`).

- [ ] **Step 3: Escrever a migration**

```sql
-- supabase/migrations/0029_painel_views.sql
create view painel.v_leads as
select id, name as nome, status, campaign as campanha, source as origem, legal_area as area,
       channel as canal, urgency_level as urgencia, lost_reason as motivo_perda,
       created_at as criado_em, modified_at as modificado_em
from crm_sync.leads;

create view painel.v_lead_status_historico as
select lead_id, status_anterior, status_novo, mudou_em, origem from crm_sync.lead_historico_status;

create view painel.v_gasto as
select campanha, mes, valor from painel.gasto_anuncios;

create view painel.v_sync_cursores as
select entity_name as entidade,
       case when last_synced_at <= '1970-01-02'::timestamptz then null else last_synced_at end as ultima_alteracao
from crm_sync.sync_state;

create view painel.v_sync_batimento as
select b.executou_em,
       coalesce(b.executou_em < now() - interval '30 minutes', true) as atrasado
from (select 1) x left join crm_sync.sync_batimento b on true;

revoke all on painel.v_leads, painel.v_lead_status_historico, painel.v_gasto, painel.v_sync_cursores, painel.v_sync_batimento from public, anon, authenticated;
grant select on painel.v_leads, painel.v_lead_status_historico, painel.v_gasto, painel.v_sync_cursores, painel.v_sync_batimento to painel_leitura;
```

- [ ] **Step 4: Aplicar (`apply_migration`, nome `painel_views`) e rodar o teste**

Expected: `OK 0029`. (O teste usa `delete` dentro da transação com rollback; se `execute_sql` recusar o `delete`, trocar essa asserção por `update ... set executou_em = null` não é possível; nesse caso remover as duas linhas do `delete` e a asserção seguinte e cobrir "sem batimento" com um teste manual documentado.)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0029_painel_views.sql supabase/tests/0029_painel_views.test.sql
git commit -m "feat(painel): views do painel e concessoes ao papel de leitura (migration 0029)"
```

---

### Task 7: Ligar o n8n ao batimento e ao campo campanha

**Files:**
- Modify (n8n): workflow `PH73hjj7zIABuZ74` (sincronização)
- Modify (n8n): sub-workflow `LkiVmBMUzRm8q9Re` (lead do grupo)
- Modify: `docs/superpowers/specs/2026-10-07-lead-grupo-agencia/gerar-workflow.mjs`, `docs/superpowers/specs/workflows/mayara-lead-grupo-agencia.json`

**Interfaces:**
- Consumes: `crm_sync.registrar_batimento()` (Task 4); campo `cCampanha` do Lead (passo 1, criado pelo usuário).
- Produces: batimento gravado a cada 5 min; `crm_sync.leads.campaign` preenchido pela sincronização; leads novos do grupo nascem com `cCampanha`.

- [ ] **Step 1: Pedir ao usuário que crie o campo no EspoCRM**

Instruções para o usuário: Administração > Gerenciador de entidades > **Lead** > Campos > **Adicionar campo** > tipo **Varchar**, nome **campanha** (o EspoCRM grava como `cCampanha`) > Salvar. Depois, Administração > **Limpar cache** e **Reconstruir**.
Expected: o usuário responde "criei o campo".

- [ ] **Step 2: Confirmar o campo pela API**

Workflow temporário de leitura: `GET /api/v1/Lead?maxSize=1&select=id,cCampanha`.
Expected: resposta com a chave `cCampanha` (nula é aceitável); erro de campo desconhecido significa que o passo 1 não foi concluído.

- [ ] **Step 3: Gravar o batimento na sincronização**

`n8n_update_partial_workflow` em `PH73hjj7zIABuZ74`, uma única chamada:

```json
[
  {"type":"addNode","node":{"id":"e9000000-0000-4000-8000-000000000001","name":"Registrar Batimento","type":"n8n-nodes-base.postgres","typeVersion":2.6,"position":[240,-160],"onError":"continueRegularOutput","credentials":{"postgres":{"id":"nNpCUIhnDuVvTApU","name":"Postgres account"}},"parameters":{"operation":"executeQuery","query":"select crm_sync.registrar_batimento()","options":{}}}},
  {"type":"addConnection","source":"Schedule Trigger","target":"Registrar Batimento"}
]
```
Expected: `nodeCount` 33. Depois de 5 a 6 minutos: `select executou_em from crm_sync.sync_batimento` devolve um horário recente.

- [ ] **Step 4: Mapear a campanha na sincronização de leads**

```json
[{"type":"updateNode","nodeName":"Upsert Leads","updates":{"parameters.columns.value.campaign":"={{ $json.cCampanha }}"}}]
```
Expected: o nó passa a ter a chave `campaign`. Se a chamada fechar a conexão, reler antes de repetir; se não aplicar após 3 tentativas, pedir ao usuário que adicione a coluna `campaign` = `{{ $json.cCampanha }}` no nó "Upsert Leads" pela interface do n8n.

- [ ] **Step 5: Preencher a campanha dos leads que já existem (retroativo)**

Workflow temporário (webhook de caminho aleatório, credencial do CRM): `GET /Lead?maxSize=200&select=id,description,cCampanha`; para cada lead sem `cCampanha` cuja descrição tenha a linha `Campanha: <valor>`, `PUT /Lead/<id>` com `{"cCampanha": "<valor>"}`. Devolver só contagens (`atualizados`, `sem_campanha_na_descricao`).
Expected: `atualizados` ≈ 58; os leads sem a linha (ex.: o cartão de formato antigo) ficam sem campanha. Após a próxima sincronização: `select count(*) filter (where campaign is not null) from crm_sync.leads` igual a `atualizados`.

- [ ] **Step 6: Leads novos do grupo nascem com campanha**

No sub-workflow `LkiVmBMUzRm8q9Re`, `patchNodeField` no nó **Criar Lead**, campo `parameters.jsonBody`, trocando `assignedUserId: '6a899d5f8a2b61a29'` por `assignedUserId: '6a899d5f8a2b61a29', cCampanha: $('Decidir').first().json.lead.campanha`; e no gerador `gerar-workflow.mjs` a mesma troca, regenerando `mayara-lead-grupo-agencia.json`.
Run: `node docs/superpowers/specs/2026-10-07-lead-grupo-agencia/gerar-workflow.mjs && node --test docs/superpowers/specs/2026-10-07-lead-grupo-agencia/lead-grupo.test.mjs`
Expected: `ℹ pass 16`. Validar o workflow no n8n (`n8n_validate_workflow`) e aguardar o próximo cartão real para provar (ou simular com o fluxo de teste, usando um telefone já existente, que não cria).

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/specs/2026-10-07-lead-grupo-agencia/gerar-workflow.mjs docs/superpowers/specs/workflows/mayara-lead-grupo-agencia.json
git commit -m "feat(painel): campanha no lead criado pelo grupo da agencia"
```

---

### Task 8: Verificação da Fase 1 e registro

**Files:**
- Modify: `docs/superpowers/specs/2026-10-08-paineis-ceo-administrador-design.md` (marcar a Fase 1 como concluída, com a data)

- [ ] **Step 1: Conferir o conjunto**

```sql
select
 (select count(*) from crm_sync.leads) as leads,
 (select count(*) from crm_sync.leads where campaign is not null) as com_campanha,
 (select count(*) from crm_sync.lead_historico_status) as historico,
 (select min(mudou_em) filter (where origem = 'evento') from crm_sync.lead_historico_status) as historico_confiavel_desde,
 (select atrasado from painel.v_sync_batimento) as sync_atrasada,
 (select count(*) from painel.v_leads) as leads_na_view,
 has_table_privilege('painel_leitura', 'crm_sync.leads', 'select') as leitura_ve_origem;
```
Expected: `leads` 59 ou mais; `com_campanha` ≥ 58; `historico` ≥ `leads`; `sync_atrasada` false; `leads_na_view` = `leads`; `leitura_ve_origem` false.

- [ ] **Step 2: Rodar todos os testes SQL novos e a suíte existente do app**

Run: testes 0025 a 0029 via `execute_sql` e `cd painel-executivo && npx vitest run`.
Expected: todos `OK`; suíte do app verde (nenhum arquivo do app foi alterado).

- [ ] **Step 3: Registrar na especificação e commitar**

Acrescentar à especificação, sob "Fases de entrega", a linha `Fase 1 concluída em <data>; histórico de status confiável desde <data>`.

```bash
git add docs/superpowers/specs/2026-10-08-paineis-ceo-administrador-design.md
git commit -m "docs(painel): Fase 1 concluida"
```

- [ ] **Step 4: Entregar ao usuário**

Resumo do que passou a existir e o que ele precisa fazer na Fase 2 (definir a senha do papel `painel_leitura` com `alter role painel_leitura login password '...'`, SQL entregue por mim; ele grava a nova `SUPABASE_DB_URL` no Coolify).
