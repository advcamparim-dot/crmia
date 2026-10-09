# Abordagem Assistida, Fase 1: Banco de Dados Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar no banco a fila de propostas de abordagem (criar, notificar dentro da janela das 6h às 21h, lembrar, editar, aprovar, descartar, expirar e confirmar o envio), com as travas de segurança, sem alterar nenhum comportamento atual.

**Architecture:** Uma tabela `mayara.propostas_abordagem` e funções SQL. O n8n só chama funções: cria a proposta (`criar_proposta`), pega o que notificar (`reservar_notificacoes`), aprova (`aprovar_proposta`, que libera a janela de 24 h e devolve o texto e o destino) e confirma o envio (`confirmar_envio_proposta`, que só então grava a mensagem na memória da Mayara). Assim a memória nunca diz que o texto foi enviado se o envio falhar.

**Tech Stack:** PostgreSQL (Supabase).

**Spec:** `docs/superpowers/specs/2026-10-09-abordagem-assistida-design.md`

## Global Constraints

- Migrations `0033_...` a `0035_...` em `supabase/migrations/`; testes em `supabase/tests/00NN_*.test.sql`, com `begin; ... rollback;` terminando em `select 'OK 00NN'`.
- Funções com `set search_path = ''`; `revoke all ... from public, anon, authenticated`; tabela nova com RLS ligado e sem acesso para `anon`/`authenticated`.
- A ferramenta recusa `delete`, `drop` e `update` sem `where` (mesmo em transação revertida): testes com `where` explícito e sem `delete`.
- Telefones de teste fictícios `+55119999908xx`; nomes de teste com o sufixo "Teste". Produção tem leads reais: nunca assumir tabelas vazias (exceto a nova).
- Janela de notificação: hora de Brasília `>= 6` e `< 21`; no máximo 10 notificações novas por hora; lembrete após 30 minutos (uma vez); validade 24 h. Funções de horário recebem `p_agora timestamptz default now()` para serem testáveis.
- Abordagem liberada por 24 h (`autorizar_abordagem(..., 24)`); sessão `whatsapp:escritorio:<telefone>`.
- Chave `abordagem_assistida` em `mayara.config`, nasce `'false'`. Esta fase não lê a chave (quem lê é o workflow, na Fase 3).
- Não alterar `executar_central`, `confirmar_pendente` nem o Núcleo nesta fase.
- Commits terminam com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Projeto Supabase: `wuhvlvsolewslkawazlq`.

## Review Focus

1. Nunca existem duas propostas abertas/aprovadas para o mesmo telefone (nem por corrida entre duas chamadas).
2. `aprovar_proposta` não reenvia: segunda chamada devolve `ja_aprovada`; proposta expirada, descartada ou de lead que virou `sem_interesse`/`bloqueado` entre a proposta e o "sim" **não** é aprovada.
3. A memória da Mayara só recebe a mensagem depois de `confirmar_envio_proposta(id, true)`; em falha, a proposta vira `falhou` e a memória fica intocada.
4. Fora das 6h–21h (Brasília) nada é reservado para notificar; às 6h00 e às 20h59 sim; às 21h00 não.
5. O limite de 10 notificações por hora não deixa proposta nova "perdida": o que sobra é reservado na hora seguinte, em ordem de chegada.

## File Structure

- Create: `supabase/migrations/0033_mayara_propostas_abordagem.sql`, `0034_mayara_propostas_notificacao.sql`, `0035_mayara_propostas_acoes.sql`
- Create: `supabase/tests/0033_propostas_abordagem.test.sql`, `0034_propostas_notificacao.test.sql`, `0035_propostas_acoes.test.sql`

---

### Task 1: Tabela, trava de unicidade e `criar_proposta`

**Files:**
- Create: `supabase/migrations/0033_mayara_propostas_abordagem.sql`
- Test: `supabase/tests/0033_propostas_abordagem.test.sql`

**Interfaces:**
- Consumes: `mayara.chave_telefone(text)`, `mayara.leads_autorizados(telefone_chave, status, abordagem_ate)`, `mayara.session_state(phone, last_lead_message_at)`.
- Produces: tabela `mayara.propostas_abordagem`; `mayara.criar_proposta(p_telefone text, p_nome text, p_crm_lead_id text, p_texto text, p_fatos jsonb, p_lacuna text) returns jsonb` (`{"ok":true,"id":N}` ou `{"ok":false,"motivo":"..."}` com motivo em `telefone_invalido`, `texto_vazio`, `texto_longo`, `lead_inativo`, `conversa_recente`, `ja_abordado`); chave `abordagem_assistida`.

- [ ] **Step 1: Escrever o teste (deve falhar)**

```sql
-- supabase/tests/0033_propostas_abordagem.test.sql
begin;
do $t$
declare r jsonb; v_id bigint;
begin
  assert (select valor from mayara.config where chave = 'abordagem_assistida') = 'false', 'chave nasce desligada';

  -- caminho feliz
  r := mayara.criar_proposta('+5511999990801', 'Ana Teste', 'crm-t1', 'Boa tarde, Ana. Aqui é a Mayara. Qual banco?', '{"valorAproximado":"100 mil"}'::jsonb, 'banco(s) envolvido(s) na dívida');
  assert (r ->> 'ok') = 'true', 'cria: ' || r::text;
  v_id := (r ->> 'id')::bigint;
  assert (select estado from mayara.propostas_abordagem where id = v_id) = 'aberta', 'nasce aberta';
  assert (select expira_em from mayara.propostas_abordagem where id = v_id) > now() + interval '23 hours', 'validade de 24 h';
  assert (select telefone_chave from mayara.propostas_abordagem where id = v_id) = mayara.chave_telefone('+5511999990801'), 'guarda a chave do telefone';
  assert (select fatos ->> 'valorAproximado' from mayara.propostas_abordagem where id = v_id) = '100 mil', 'guarda os fatos';
  assert (select lacuna from mayara.propostas_abordagem where id = v_id) like 'banco%', 'guarda a lacuna';

  -- uma so aberta por telefone (mesmo com formatos diferentes)
  r := mayara.criar_proposta('5511999990801', 'Ana Teste', 'crm-t1', 'Outro texto', '{}'::jsonb, null);
  assert (r ->> 'motivo') = 'ja_abordado', 'segunda proposta recusada: ' || r::text;
  assert (select count(*) from mayara.propostas_abordagem where telefone_chave = mayara.chave_telefone('+5511999990801')) = 1, 'so uma gravada';

  -- indice unico protege contra corrida (insercao direta)
  begin
    insert into mayara.propostas_abordagem (telefone, telefone_chave, nome, texto, estado)
    values ('+5511999990801', mayara.chave_telefone('+5511999990801'), 'Ana Teste', 'x', 'aberta');
    assert false, 'indice unico deveria barrar';
  exception when unique_violation then null;
  end;

  -- entradas invalidas
  r := mayara.criar_proposta('123', 'X Teste', null, 'texto', '{}'::jsonb, null);
  assert (r ->> 'motivo') = 'telefone_invalido', 'telefone invalido: ' || r::text;
  r := mayara.criar_proposta('+5511999990802', 'X Teste', null, '   ', '{}'::jsonb, null);
  assert (r ->> 'motivo') = 'texto_vazio', 'texto vazio: ' || r::text;
  r := mayara.criar_proposta('+5511999990802', 'X Teste', null, repeat('x', 701), '{}'::jsonb, null);
  assert (r ->> 'motivo') = 'texto_longo', 'texto longo: ' || r::text;

  -- lead que pediu para parar ou foi assumido nao recebe proposta
  insert into mayara.leads_autorizados (telefone, nome, status) values ('+5511999990803', 'Parou Teste', 'sem_interesse'), ('+5511999990804', 'Assumido Teste', 'bloqueado');
  r := mayara.criar_proposta('+5511999990803', 'Parou Teste', null, 'Oi', '{}'::jsonb, null);
  assert (r ->> 'motivo') = 'lead_inativo', 'sem_interesse: ' || r::text;
  r := mayara.criar_proposta('+5511999990804', 'Assumido Teste', null, 'Oi', '{}'::jsonb, null);
  assert (r ->> 'motivo') = 'lead_inativo', 'bloqueado: ' || r::text;

  -- conversa recente (lead escreveu nas ultimas 48 h)
  insert into mayara.session_state (session_key, phone, estado, last_lead_message_at)
    values ('whatsapp:escritorio:+5511999990805', '+5511999990805', 'S2_QUALIFICACAO', now() - interval '3 hours');
  r := mayara.criar_proposta('+5511999990805', 'Conversa Teste', null, 'Oi', '{}'::jsonb, null);
  assert (r ->> 'motivo') = 'conversa_recente', 'conversa recente: ' || r::text;

  -- ja abordado antes (janela de abordagem aberta)
  insert into mayara.leads_autorizados (telefone, nome, status, abordagem_ate) values ('+5511999990806', 'Abordado Teste', 'ativo', now() + interval '10 hours');
  r := mayara.criar_proposta('+5511999990806', 'Abordado Teste', null, 'Oi', '{}'::jsonb, null);
  assert (r ->> 'motivo') = 'ja_abordado', 'abordagem ja liberada: ' || r::text;

  -- acesso fechado
  assert not has_function_privilege('anon', 'mayara.criar_proposta(text,text,text,text,jsonb,text)', 'execute'), 'anon sem execute';
  assert not has_function_privilege('authenticated', 'mayara.criar_proposta(text,text,text,text,jsonb,text)', 'execute'), 'authenticated sem execute';
  assert not has_table_privilege('anon', 'mayara.propostas_abordagem', 'select'), 'anon sem select';
  assert not has_table_privilege('authenticated', 'mayara.propostas_abordagem', 'select'), 'authenticated sem select';
end $t$;
rollback;
select 'OK 0033' as resultado;
```

- [ ] **Step 2: Rodar e ver falhar**

Run: o conteúdo acima via `execute_sql`.
Expected: FAIL com `chave nasce desligada`.

- [ ] **Step 3: Escrever a migration**

```sql
-- supabase/migrations/0033_mayara_propostas_abordagem.sql
insert into mayara.config (chave, valor) values ('abordagem_assistida', 'false') on conflict (chave) do nothing;

create table mayara.propostas_abordagem (
  id bigserial primary key,
  telefone text not null,
  telefone_chave text not null,
  nome text,
  crm_lead_id text,
  fatos jsonb not null default '{}'::jsonb,
  lacuna text,
  texto text not null,
  texto_original text,
  estado text not null default 'aberta' check (estado in ('aberta', 'aprovada', 'enviada', 'descartada', 'expirada', 'falhou')),
  criado_em timestamptz not null default now(),
  notificada_em timestamptz,
  lembrete_em timestamptz,
  expira_em timestamptz not null default (now() + interval '24 hours'),
  aprovada_por text,
  encerrada_em timestamptz,
  erro text
);
create unique index propostas_abordagem_uma_por_telefone
  on mayara.propostas_abordagem (telefone_chave) where estado in ('aberta', 'aprovada');
create index propostas_abordagem_estado on mayara.propostas_abordagem (estado, criado_em);
alter table mayara.propostas_abordagem enable row level security;
revoke all on mayara.propostas_abordagem from anon, authenticated;

create or replace function mayara.criar_proposta(
  p_telefone text, p_nome text, p_crm_lead_id text, p_texto text, p_fatos jsonb, p_lacuna text)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_chave text := mayara.chave_telefone(p_telefone);
  v_texto text := btrim(coalesce(p_texto, ''));
  v_status text;
  v_id bigint;
begin
  if v_chave is null then
    return jsonb_build_object('ok', false, 'motivo', 'telefone_invalido');
  end if;
  if v_texto = '' then
    return jsonb_build_object('ok', false, 'motivo', 'texto_vazio');
  end if;
  if char_length(v_texto) > 700 then
    return jsonb_build_object('ok', false, 'motivo', 'texto_longo');
  end if;
  select status into v_status from mayara.leads_autorizados where telefone_chave = v_chave;
  if v_status is not null and v_status <> 'ativo' then
    return jsonb_build_object('ok', false, 'motivo', 'lead_inativo');
  end if;
  if exists (select 1 from mayara.session_state s
             where mayara.chave_telefone(s.phone) = v_chave
               and s.last_lead_message_at > now() - interval '48 hours') then
    return jsonb_build_object('ok', false, 'motivo', 'conversa_recente');
  end if;
  if exists (select 1 from mayara.leads_autorizados la where la.telefone_chave = v_chave and la.abordagem_ate is not null)
     or exists (select 1 from mayara.propostas_abordagem p
                where p.telefone_chave = v_chave and p.estado in ('aberta', 'aprovada', 'enviada')) then
    return jsonb_build_object('ok', false, 'motivo', 'ja_abordado');
  end if;
  insert into mayara.propostas_abordagem (telefone, telefone_chave, nome, crm_lead_id, fatos, lacuna, texto, texto_original)
  values (p_telefone, v_chave, nullif(btrim(coalesce(p_nome, '')), ''), nullif(btrim(coalesce(p_crm_lead_id, '')), ''),
          coalesce(p_fatos, '{}'::jsonb), nullif(btrim(coalesce(p_lacuna, '')), ''), v_texto, v_texto)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
exception when unique_violation then
  return jsonb_build_object('ok', false, 'motivo', 'ja_abordado');
end $$;

revoke all on function mayara.criar_proposta(text, text, text, text, jsonb, text) from public, anon, authenticated;
```

- [ ] **Step 4: Aplicar (`apply_migration`, nome `mayara_propostas_abordagem`) e rodar o teste**

Expected: `OK 0033`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0033_mayara_propostas_abordagem.sql supabase/tests/0033_propostas_abordagem.test.sql
git commit -m "feat(abordagem): tabela de propostas e criar_proposta (migration 0033)"
```

---

### Task 2: Reservar notificações (janela 6h–21h, limite por hora, lembrete) e expirar

**Files:**
- Create: `supabase/migrations/0034_mayara_propostas_notificacao.sql`
- Test: `supabase/tests/0034_propostas_notificacao.test.sql`

**Interfaces:**
- Consumes: tabela e `criar_proposta` da Task 1.
- Produces: `mayara.reservar_notificacoes(p_agora timestamptz default now()) returns table (id bigint, tipo text, nome text, texto text, telefone_fim text)` com `tipo` em `nova` ou `lembrete`, que **marca** `notificada_em` ou `lembrete_em` ao devolver (cada proposta é devolvida uma vez como `nova` e no máximo uma vez como `lembrete`); `mayara.expirar_propostas(p_agora timestamptz default now()) returns integer`.

- [ ] **Step 1: Escrever o teste (deve falhar)**

```sql
-- supabase/tests/0034_propostas_notificacao.test.sql
begin;
do $t$
declare
  n int; v_id bigint; r record;
  -- 12:00 em Brasilia (UTC-3) = 15:00Z
  dia_ok timestamptz := '2026-10-09 15:00:00+00';
begin
  -- 12 propostas abertas, criadas em ordem
  for i in 1..12 loop
    perform mayara.criar_proposta('+55119999908' || lpad((10 + i)::text, 2, '0'), 'Lead ' || i || ' Teste', null, 'Texto ' || i, '{}'::jsonb, null);
  end loop;
  assert (select count(*) from mayara.propostas_abordagem where estado = 'aberta') = 12, '12 abertas';

  -- fora da janela: 05:59 e 21:00 de Brasilia nao reservam nada
  select count(*) into n from mayara.reservar_notificacoes('2026-10-09 08:59:00+00');
  assert n = 0, '05:59 nao notifica: ' || n;
  select count(*) into n from mayara.reservar_notificacoes('2026-10-10 00:00:00+00');
  assert n = 0, '21:00 nao notifica: ' || n;
  assert (select count(*) from mayara.propostas_abordagem where notificada_em is not null) = 0, 'nada marcado fora da janela';

  -- dentro da janela: no maximo 10, em ordem de chegada
  select count(*) into n from mayara.reservar_notificacoes(dia_ok);
  assert n = 10, 'limite de 10 por hora: ' || n;
  assert (select count(*) from mayara.propostas_abordagem where notificada_em is not null) = 10, '10 marcadas';
  assert (select count(*) from mayara.propostas_abordagem where notificada_em is null and texto in ('Texto 11', 'Texto 12')) = 2, 'as duas ultimas ficam para depois';

  -- chamada repetida na mesma hora nao devolve de novo
  select count(*) into n from mayara.reservar_notificacoes(dia_ok + interval '1 minute');
  assert n = 0, 'nao repete na mesma hora: ' || n;

  -- hora seguinte: as 2 que sobraram
  select count(*) into n from mayara.reservar_notificacoes(dia_ok + interval '61 minutes');
  assert n = 2, 'sobra reservada na hora seguinte: ' || n;

  -- 20:59 de Brasilia (23:59Z) ainda notifica; 06:00 de Brasilia (09:00Z) tambem
  perform mayara.criar_proposta('+5511999990830', 'Noite Teste', null, 'Texto noite', '{}'::jsonb, null);
  select count(*) into n from mayara.reservar_notificacoes('2026-10-10 00:59:00+00');
  assert n = 0, '21:59 nao notifica: ' || n;
  select count(*) into n from mayara.reservar_notificacoes('2026-10-10 23:59:00+00');
  assert n = 1, '20:59 notifica: ' || n;
  perform mayara.criar_proposta('+5511999990831', 'Manha Teste', null, 'Texto manha', '{}'::jsonb, null);
  select count(*) into n from mayara.reservar_notificacoes('2026-10-11 09:00:00+00');
  assert n = 1, '06:00 notifica: ' || n;

  -- lembrete: depois de 30 min sem resposta, uma unica vez
  select id into v_id from mayara.propostas_abordagem where texto = 'Texto 1';
  update mayara.propostas_abordagem set notificada_em = '2026-10-12 15:00:00+00' where id = v_id;
  select count(*) into n from mayara.reservar_notificacoes('2026-10-12 15:29:00+00') where tipo = 'lembrete' and id = v_id;
  assert n = 0, 'antes de 30 min nao lembra: ' || n;
  select * into r from mayara.reservar_notificacoes('2026-10-12 15:31:00+00') where tipo = 'lembrete' and id = v_id;
  assert r.id = v_id and r.telefone_fim = '0811', 'lembra apos 30 min: ' || coalesce(r.telefone_fim, 'nulo');
  select count(*) into n from mayara.reservar_notificacoes('2026-10-12 16:30:00+00') where tipo = 'lembrete' and id = v_id;
  assert n = 0, 'lembrete uma vez so: ' || n;

  -- lembrete tambem respeita a janela
  select id into v_id from mayara.propostas_abordagem where texto = 'Texto 2';
  update mayara.propostas_abordagem set notificada_em = '2026-10-12 23:50:00+00', lembrete_em = null where id = v_id;
  select count(*) into n from mayara.reservar_notificacoes('2026-10-13 00:30:00+00') where tipo = 'lembrete' and id = v_id;
  assert n = 0, 'lembrete fora da janela espera: ' || n;

  -- expiracao
  select id into v_id from mayara.propostas_abordagem where texto = 'Texto 3';
  update mayara.propostas_abordagem set expira_em = '2026-10-09 10:00:00+00' where id = v_id;
  n := mayara.expirar_propostas('2026-10-09 11:00:00+00');
  assert n >= 1, 'expirou ao menos a vencida: ' || n;
  assert (select estado from mayara.propostas_abordagem where id = v_id) = 'expirada', 'marcada expirada';
  assert (select encerrada_em from mayara.propostas_abordagem where id = v_id) is not null, 'encerrada_em preenchida';

  -- proposta expirada nao e notificada e libera o telefone para nova proposta
  select count(*) into n from mayara.reservar_notificacoes('2026-10-09 15:00:00+00') where id = v_id;
  assert n = 0, 'expirada nao notifica';

  assert not has_function_privilege('anon', 'mayara.reservar_notificacoes(timestamptz)', 'execute'), 'anon reservar';
  assert not has_function_privilege('authenticated', 'mayara.expirar_propostas(timestamptz)', 'execute'), 'authenticated expirar';
end $t$;
rollback;
select 'OK 0034' as resultado;
```

- [ ] **Step 2: Rodar e ver falhar**

Expected: FAIL com `function mayara.reservar_notificacoes(unknown) does not exist`.

- [ ] **Step 3: Escrever a migration**

```sql
-- supabase/migrations/0034_mayara_propostas_notificacao.sql
create or replace function mayara.expirar_propostas(p_agora timestamptz default now())
returns integer language plpgsql set search_path = '' as $$
declare v int;
begin
  update mayara.propostas_abordagem
     set estado = 'expirada', encerrada_em = p_agora
   where estado = 'aberta' and expira_em < p_agora;
  get diagnostics v = row_count;
  return v;
end $$;

create or replace function mayara.reservar_notificacoes(p_agora timestamptz default now())
returns table (id bigint, tipo text, nome text, texto text, telefone_fim text)
language plpgsql set search_path = '' as $$
declare
  v_hora int := extract(hour from (p_agora at time zone 'America/Sao_Paulo'))::int;
  v_ja int;
begin
  perform mayara.expirar_propostas(p_agora);
  if v_hora < 6 or v_hora >= 21 then
    return;
  end if;
  select count(*) into v_ja from mayara.propostas_abordagem p
   where p.notificada_em > p_agora - interval '1 hour' and p.notificada_em <= p_agora;
  return query
  with novas as (
    select p.id from mayara.propostas_abordagem p
     where p.estado = 'aberta' and p.notificada_em is null
     order by p.criado_em, p.id
     limit greatest(10 - v_ja, 0)
  ), marcadas as (
    update mayara.propostas_abordagem p set notificada_em = p_agora
     where p.id in (select novas.id from novas)
     returning p.id, p.nome, p.texto, p.telefone_chave
  ), lembretes as (
    update mayara.propostas_abordagem p set lembrete_em = p_agora
     where p.estado = 'aberta' and p.notificada_em is not null and p.lembrete_em is null
       and p.notificada_em < p_agora - interval '30 minutes'
       and p.id not in (select novas.id from novas)
     returning p.id, p.nome, p.texto, p.telefone_chave
  )
  select m.id, 'nova'::text, m.nome, m.texto, right(m.telefone_chave, 4) from marcadas m
  union all
  select l.id, 'lembrete'::text, l.nome, l.texto, right(l.telefone_chave, 4) from lembretes l;
end $$;

revoke all on function mayara.expirar_propostas(timestamptz) from public, anon, authenticated;
revoke all on function mayara.reservar_notificacoes(timestamptz) from public, anon, authenticated;
```

- [ ] **Step 4: Aplicar (`apply_migration`, nome `mayara_propostas_notificacao`) e rodar o teste**

Expected: `OK 0034`. Se a asserção de `telefone_fim = '0811'` falhar, conferir a numeração: a proposta 'Texto 1' usa o telefone `+5511999990811`; ajustar o teste (não a função) se o `lpad` gerar outro final.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0034_mayara_propostas_notificacao.sql supabase/tests/0034_propostas_notificacao.test.sql
git commit -m "feat(abordagem): reserva de notificacoes na janela 6h-21h, lembrete e expiracao (migration 0034)"
```

---

### Task 3: Aprovar, confirmar envio, descartar, editar e consultar

**Files:**
- Create: `supabase/migrations/0035_mayara_propostas_acoes.sql`
- Test: `supabase/tests/0035_propostas_acoes.test.sql`

**Interfaces:**
- Consumes: tudo das Tasks 1 e 2; `mayara.autorizar_abordagem(text, text, text, int)`, `mayara.iniciar_sessao_reativacao(text, text, jsonb)`, `public.n8n_chat_histories(session_id, message, created_at)`, `mayara.pode_enviar`.
- Produces:
  - `mayara.aprovar_proposta(p_id bigint, p_autor text) returns jsonb` → `{"ok":true,"id","destino","texto","nome","crm_lead_id"}` ou `{"ok":false,"motivo":"nao_encontrada|ja_aprovada|nao_esta_aberta|expirada|lead_inativo"}`.
  - `mayara.confirmar_envio_proposta(p_id bigint, p_ok boolean, p_erro text) returns text`.
  - `mayara.descartar_proposta(p_id bigint) returns text`.
  - `mayara.editar_proposta(p_id bigint, p_texto text) returns jsonb` (`{"ok":true,"texto"}` ou `{"ok":false,"motivo":"nao_esta_aberta|texto_vazio|texto_longo|texto_invalido"}`); `texto_invalido` quando o texto tem link (`http` ou `www.`).
  - `mayara.listar_propostas_abertas() returns text` (uma linha por proposta: `#id Nome (final XXXX)`; texto fixo quando não há).
  - `mayara.proposta_sem_numero() returns jsonb` → `{"qtd": N, "id": id|null, "bloqueada": bool}`; `id` só quando `qtd = 1` e `bloqueada = false`; `bloqueada` é verdadeiro quando existe regra (`mayara.instrucoes` pendente) ou ação (`mayara.acoes_pendentes` pendente) aguardando "sim".

- [ ] **Step 1: Escrever o teste (deve falhar)**

```sql
-- supabase/tests/0035_propostas_acoes.test.sql
begin;
do $t$
declare r jsonb; v_id bigint; v_id2 bigint; t text; n int;
begin
  -- aprovar: fluxo feliz
  v_id := (mayara.criar_proposta('+5511999990901', 'Bia Teste', 'crm-b1', 'Boa tarde, Bia. Qual banco?', '{"valorAproximado":"50 mil","origemLead":"grupo_agencia"}'::jsonb, 'banco(s) envolvido(s) na dívida') ->> 'id')::bigint;
  r := mayara.aprovar_proposta(v_id, '5514997022609');
  assert (r ->> 'ok') = 'true' and (r ->> 'texto') = 'Boa tarde, Bia. Qual banco?' and (r ->> 'destino') = '+5511999990901', 'aprova: ' || r::text;
  assert (select estado from mayara.propostas_abordagem where id = v_id) = 'aprovada', 'estado aprovada';
  assert (select abordagem_ate from mayara.leads_autorizados where telefone_chave = mayara.chave_telefone('+5511999990901')) > now() + interval '23 hours', 'janela de 24 h aberta';
  assert (mayara.pode_enviar('escritorio', '5511999990901', 'texto') ->> 'ok') = 'true', 'pode_enviar liberado';
  assert (select estado from mayara.session_state where session_key = 'whatsapp:escritorio:+5511999990901') = 'S1_ENGAJADO', 'sessao engajada';
  assert (select fatos_json ->> 'valorAproximado' from mayara.session_state where session_key = 'whatsapp:escritorio:+5511999990901') = '50 mil', 'fatos do card na sessao';
  -- memoria ainda NAO tem a mensagem (so depois do envio confirmado)
  assert (select count(*) from public.n8n_chat_histories where session_id = 'whatsapp:escritorio:+5511999990901') = 0, 'memoria intocada antes do envio';

  -- segunda aprovacao nao repete
  r := mayara.aprovar_proposta(v_id, '5514997022609');
  assert (r ->> 'motivo') = 'ja_aprovada', 'nao reenvia: ' || r::text;

  -- confirmar envio com sucesso: memoria recebe a fala da Mayara
  t := mayara.confirmar_envio_proposta(v_id, true, null);
  assert (select estado from mayara.propostas_abordagem where id = v_id) = 'enviada', 'estado enviada';
  assert (select count(*) from public.n8n_chat_histories where session_id = 'whatsapp:escritorio:+5511999990901' and message ->> 'type' = 'ai' and message ->> 'content' = 'Boa tarde, Bia. Qual banco?') = 1, 'memoria com a fala da Mayara';
  t := mayara.confirmar_envio_proposta(v_id, true, null);
  assert (select count(*) from public.n8n_chat_histories where session_id = 'whatsapp:escritorio:+5511999990901') = 1, 'confirmar duas vezes nao duplica a memoria';

  -- falha de envio: vira falhou, memoria intocada
  v_id2 := (mayara.criar_proposta('+5511999990902', 'Caio Teste', null, 'Boa tarde, Caio.', '{}'::jsonb, null) ->> 'id')::bigint;
  perform mayara.aprovar_proposta(v_id2, 'x');
  t := mayara.confirmar_envio_proposta(v_id2, false, 'connection closed');
  assert (select estado from mayara.propostas_abordagem where id = v_id2) = 'falhou', 'estado falhou';
  assert (select erro from mayara.propostas_abordagem where id = v_id2) = 'connection closed', 'erro guardado';
  assert (select count(*) from public.n8n_chat_histories where session_id = 'whatsapp:escritorio:+5511999990902') = 0, 'memoria intocada na falha';

  -- aprovar proposta inexistente, descartada, expirada
  r := mayara.aprovar_proposta(999999999, 'x');
  assert (r ->> 'motivo') = 'nao_encontrada', 'inexistente: ' || r::text;
  v_id := (mayara.criar_proposta('+5511999990903', 'Duda Teste', null, 'Oi Duda', '{}'::jsonb, null) ->> 'id')::bigint;
  t := mayara.descartar_proposta(v_id);
  assert t like '%descartei%', 'descarta: ' || t;
  r := mayara.aprovar_proposta(v_id, 'x');
  assert (r ->> 'motivo') = 'nao_esta_aberta', 'descartada nao aprova: ' || r::text;
  -- descartar libera o telefone para nova proposta
  r := mayara.criar_proposta('+5511999990903', 'Duda Teste', null, 'Oi Duda de novo', '{}'::jsonb, null);
  assert (r ->> 'ok') = 'true', 'telefone liberado apos descartar: ' || r::text;
  v_id := (r ->> 'id')::bigint;
  update mayara.propostas_abordagem set expira_em = now() - interval '1 minute' where id = v_id;
  r := mayara.aprovar_proposta(v_id, 'x');
  assert (r ->> 'motivo') = 'expirada', 'expirada nao aprova: ' || r::text;

  -- lead virou sem_interesse entre a proposta e o sim
  v_id := (mayara.criar_proposta('+5511999990904', 'Edu Teste', null, 'Oi Edu', '{}'::jsonb, null) ->> 'id')::bigint;
  insert into mayara.leads_autorizados (telefone, nome, status) values ('+5511999990904', 'Edu Teste', 'sem_interesse');
  r := mayara.aprovar_proposta(v_id, 'x');
  assert (r ->> 'motivo') = 'lead_inativo', 'sem_interesse bloqueia aprovacao: ' || r::text;
  assert (select estado from mayara.propostas_abordagem where id = v_id) = 'descartada', 'proposta descartada pelo motivo';

  -- editar
  v_id := (mayara.criar_proposta('+5511999990905', 'Fabi Teste', null, 'Oi Fabi', '{}'::jsonb, null) ->> 'id')::bigint;
  r := mayara.editar_proposta(v_id, '  Boa tarde, Fabi. Qual o valor?  ');
  assert (r ->> 'ok') = 'true' and (r ->> 'texto') = 'Boa tarde, Fabi. Qual o valor?', 'edita e apara: ' || r::text;
  assert (select texto_original from mayara.propostas_abordagem where id = v_id) = 'Oi Fabi', 'guarda o original';
  r := mayara.editar_proposta(v_id, '   ');
  assert (r ->> 'motivo') = 'texto_vazio', 'edicao vazia: ' || r::text;
  r := mayara.editar_proposta(v_id, repeat('x', 701));
  assert (r ->> 'motivo') = 'texto_longo', 'edicao longa: ' || r::text;
  r := mayara.editar_proposta(v_id, 'Veja https://exemplo.com agora');
  assert (r ->> 'motivo') = 'texto_invalido', 'link barrado: ' || r::text;
  r := mayara.editar_proposta(v_id, 'Veja www.exemplo.com agora');
  assert (r ->> 'motivo') = 'texto_invalido', 'www barrado: ' || r::text;
  r := mayara.editar_proposta(999999999, 'Oi');
  assert (r ->> 'motivo') = 'nao_esta_aberta', 'editar inexistente: ' || r::text;
  -- editar reabre a notificacao (o administrador precisa ver o texto novo)
  update mayara.propostas_abordagem set notificada_em = now(), lembrete_em = now() where id = v_id;
  perform mayara.editar_proposta(v_id, 'Boa tarde, Fabi. Qual o banco?');
  assert (select notificada_em from mayara.propostas_abordagem where id = v_id) is not null, 'editar nao some da fila';
  assert (select lembrete_em from mayara.propostas_abordagem where id = v_id) is null, 'editar reinicia o lembrete';

  -- listar
  t := mayara.listar_propostas_abertas();
  assert t like '%#' || v_id::text || ' Fabi Teste (final 0905)%', 'lista inclui a proposta: ' || t;
  assert t not like '%5511999990905%', 'lista nao mostra o telefone completo: ' || t;

  -- proposta_sem_numero
  update mayara.propostas_abordagem set estado = 'descartada', encerrada_em = now() where estado = 'aberta' and id <> v_id;
  r := mayara.proposta_sem_numero();
  assert (r ->> 'qtd') = '1' and (r ->> 'id')::bigint = v_id and (r ->> 'bloqueada') = 'false', 'uma aberta, sem pendencia: ' || r::text;
  insert into mayara.instrucoes (texto, autor_chave) values ('Regra pendente de teste.', 't');
  r := mayara.proposta_sem_numero();
  assert (r ->> 'bloqueada') = 'true' and (r ->> 'id') is null, 'regra pendente tem prioridade: ' || r::text;
  update mayara.instrucoes set estado = 'recusada', encerrada_em = now() where estado = 'pendente';
  perform mayara.criar_acao_pendente('pausar', '{}'::jsonb, 'Pausar a Mayara', '5514997022609');
  r := mayara.proposta_sem_numero();
  assert (r ->> 'bloqueada') = 'true', 'acao pendente tem prioridade: ' || r::text;
  update mayara.acoes_pendentes set estado = 'cancelada', encerrada_em = now() where estado = 'pendente';
  perform mayara.criar_proposta('+5511999990906', 'Gui Teste', null, 'Oi Gui', '{}'::jsonb, null);
  r := mayara.proposta_sem_numero();
  assert (r ->> 'qtd') = '2' and (r ->> 'id') is null, 'duas abertas: pede o numero: ' || r::text;

  assert not has_function_privilege('anon', 'mayara.aprovar_proposta(bigint,text)', 'execute'), 'anon aprovar';
  assert not has_function_privilege('authenticated', 'mayara.confirmar_envio_proposta(bigint,boolean,text)', 'execute'), 'authenticated confirmar';
  assert not has_function_privilege('anon', 'mayara.proposta_sem_numero()', 'execute'), 'anon sem_numero';
end $t$;
rollback;
select 'OK 0035' as resultado;
```

- [ ] **Step 2: Rodar e ver falhar**

Expected: FAIL com `function mayara.aprovar_proposta(bigint, unknown) does not exist`.

- [ ] **Step 3: Escrever a migration**

```sql
-- supabase/migrations/0035_mayara_propostas_acoes.sql
create or replace function mayara.aprovar_proposta(p_id bigint, p_autor text)
returns jsonb language plpgsql set search_path = '' as $$
declare
  p mayara.propostas_abordagem%rowtype;
  a jsonb;
begin
  perform mayara.expirar_propostas();
  select * into p from mayara.propostas_abordagem where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'nao_encontrada');
  end if;
  if p.estado in ('aprovada', 'enviada') then
    return jsonb_build_object('ok', false, 'motivo', 'ja_aprovada');
  end if;
  if p.estado = 'expirada' then
    return jsonb_build_object('ok', false, 'motivo', 'expirada');
  end if;
  if p.estado <> 'aberta' then
    return jsonb_build_object('ok', false, 'motivo', 'nao_esta_aberta');
  end if;
  a := mayara.autorizar_abordagem(p.telefone, p.nome, p.crm_lead_id, 24);
  if (a ->> 'abordagem_liberada') <> 'true' then
    update mayara.propostas_abordagem
       set estado = 'descartada', encerrada_em = now(), erro = 'lead_' || coalesce(a ->> 'status', 'inativo')
     where id = p.id;
    return jsonb_build_object('ok', false, 'motivo', 'lead_inativo');
  end if;
  perform mayara.iniciar_sessao_reativacao('whatsapp:escritorio:' || p.telefone, p.telefone, p.fatos);
  update mayara.propostas_abordagem set estado = 'aprovada', aprovada_por = p_autor where id = p.id;
  return jsonb_build_object('ok', true, 'id', p.id, 'destino', p.telefone, 'texto', p.texto,
                            'nome', p.nome, 'crm_lead_id', p.crm_lead_id);
end $$;

create or replace function mayara.confirmar_envio_proposta(p_id bigint, p_ok boolean, p_erro text)
returns text language plpgsql set search_path = '' as $$
declare p mayara.propostas_abordagem%rowtype;
begin
  select * into p from mayara.propostas_abordagem where id = p_id for update;
  if not found then
    return 'Proposta não encontrada.';
  end if;
  if p.estado <> 'aprovada' then
    return 'Nada a confirmar: a proposta está ' || p.estado || '.';
  end if;
  if p_ok then
    update mayara.propostas_abordagem set estado = 'enviada', encerrada_em = now() where id = p.id;
    insert into public.n8n_chat_histories (session_id, message, created_at)
    values ('whatsapp:escritorio:' || p.telefone,
            jsonb_build_object('type', 'ai', 'content', p.texto, 'tool_calls', '[]'::jsonb,
                               'additional_kwargs', '{}'::jsonb, 'response_metadata', '{}'::jsonb,
                               'invalid_tool_calls', '[]'::jsonb),
            now());
    return 'Enviada.';
  end if;
  update mayara.propostas_abordagem
     set estado = 'falhou', encerrada_em = now(), erro = left(coalesce(p_erro, 'erro_desconhecido'), 300)
   where id = p.id;
  return 'O envio falhou; a proposta foi marcada como falhou.';
end $$;

create or replace function mayara.descartar_proposta(p_id bigint)
returns text language plpgsql set search_path = '' as $$
declare v_est text;
begin
  select estado into v_est from mayara.propostas_abordagem where id = p_id for update;
  if v_est is null then
    return 'Não achei a proposta ' || p_id::text || '.';
  end if;
  if v_est <> 'aberta' then
    return 'A proposta ' || p_id::text || ' não está aberta (está ' || v_est || ').';
  end if;
  update mayara.propostas_abordagem set estado = 'descartada', encerrada_em = now() where id = p_id;
  return 'Ok, descartei a proposta ' || p_id::text || '. Nada foi enviado.';
end $$;

create or replace function mayara.editar_proposta(p_id bigint, p_texto text)
returns jsonb language plpgsql set search_path = '' as $$
declare v_texto text := btrim(coalesce(p_texto, ''));
begin
  if not exists (select 1 from mayara.propostas_abordagem where id = p_id and estado = 'aberta') then
    return jsonb_build_object('ok', false, 'motivo', 'nao_esta_aberta');
  end if;
  if v_texto = '' then
    return jsonb_build_object('ok', false, 'motivo', 'texto_vazio');
  end if;
  if char_length(v_texto) > 700 then
    return jsonb_build_object('ok', false, 'motivo', 'texto_longo');
  end if;
  if lower(v_texto) like '%http%' or lower(v_texto) like '%www.%' then
    return jsonb_build_object('ok', false, 'motivo', 'texto_invalido');
  end if;
  update mayara.propostas_abordagem set texto = v_texto, lembrete_em = null where id = p_id and estado = 'aberta';
  return jsonb_build_object('ok', true, 'texto', v_texto);
end $$;

create or replace function mayara.listar_propostas_abertas()
returns text language plpgsql stable set search_path = '' as $$
declare v text;
begin
  select string_agg('#' || id::text || ' ' || coalesce(nome, 'Sem nome') || ' (final ' || right(telefone_chave, 4) || ')', E'\n' order by criado_em, id)
    into v from mayara.propostas_abordagem where estado = 'aberta';
  return coalesce('Propostas abertas:' || E'\n' || v, 'Não há propostas de abordagem abertas.');
end $$;

create or replace function mayara.proposta_sem_numero()
returns jsonb language plpgsql set search_path = '' as $$
declare v_qtd int; v_id bigint; v_bloq boolean;
begin
  perform mayara.expirar_propostas();
  perform mayara.expirar_pendentes();
  perform mayara.expirar_acoes_pendentes();
  select count(*), max(id) into v_qtd, v_id from mayara.propostas_abordagem where estado = 'aberta';
  v_bloq := exists (select 1 from mayara.instrucoes where estado = 'pendente')
         or exists (select 1 from mayara.acoes_pendentes where estado = 'pendente');
  return jsonb_build_object('qtd', v_qtd, 'bloqueada', v_bloq,
                            'id', case when v_qtd = 1 and not v_bloq then v_id else null end);
end $$;

revoke all on function mayara.aprovar_proposta(bigint, text) from public, anon, authenticated;
revoke all on function mayara.confirmar_envio_proposta(bigint, boolean, text) from public, anon, authenticated;
revoke all on function mayara.descartar_proposta(bigint) from public, anon, authenticated;
revoke all on function mayara.editar_proposta(bigint, text) from public, anon, authenticated;
revoke all on function mayara.listar_propostas_abertas() from public, anon, authenticated;
revoke all on function mayara.proposta_sem_numero() from public, anon, authenticated;
```

- [ ] **Step 4: Aplicar (`apply_migration`, nome `mayara_propostas_acoes`) e rodar o teste**

Expected: `OK 0035`. Se algum `like` falhar por acento ou pontuação, corrigir o texto da função e o teste para casar entre si.

- [ ] **Step 5: Regressão**

Run: `0033`, `0034` e `0030` (`supabase/tests/0030_acoes_pendentes.test.sql`) via `execute_sql`.
Expected: `OK 0033`, `OK 0034`, `OK 0030`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0035_mayara_propostas_acoes.sql supabase/tests/0035_propostas_acoes.test.sql
git commit -m "feat(abordagem): aprovar, confirmar envio, descartar, editar e consultar propostas (migration 0035)"
```

---

### Task 4: Verificação final da Fase 1

**Files:**
- Modify: `docs/superpowers/specs/2026-10-09-abordagem-assistida-design.md` (marcar a Fase 1 como concluída, com a data)

- [ ] **Step 1: Conferir o conjunto**

```sql
select
 (select valor from mayara.config where chave = 'abordagem_assistida') as chave,
 (select count(*) from mayara.propostas_abordagem) as propostas_reais,
 (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'mayara' and p.proname in ('criar_proposta','reservar_notificacoes','expirar_propostas','aprovar_proposta','confirmar_envio_proposta','descartar_proposta','editar_proposta','listar_propostas_abertas','proposta_sem_numero')) as funcoes,
 (select count(*) from mayara.instrucoes where estado = 'pendente') as regras_pendentes,
 (select count(*) from mayara.acoes_pendentes where estado = 'pendente') as acoes_pendentes,
 mayara.listar_propostas_abertas() as lista;
```
Expected: `chave` = `false`; `propostas_reais` = 0 (os testes terminam em rollback); `funcoes` = 9; pendências 0; `lista` = "Não há propostas de abordagem abertas."

- [ ] **Step 2: Confirmar que nada mudou para o administrador**

Enviar do número de administrador `/status` e uma frase de ensino com "sim" (comportamento atual).
Expected: respostas iguais às de antes.

- [ ] **Step 3: Registrar na especificação**

Acrescentar à seção "Fases" a linha `Fase 1 concluída em <data>`.

```bash
git add docs/superpowers/specs/2026-10-09-abordagem-assistida-design.md
git commit -m "docs(abordagem): Fase 1 concluida"
```
