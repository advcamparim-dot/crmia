# Central em Linguagem Livre, Fase 1: Banco de Dados Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar no banco tudo que a Central em linguagem livre precisa: ações pendentes com confirmação, funções de leitura (contagem, situação de um lead, busca por nome) e a chave que liga ou desliga o recurso, sem alterar nenhum comportamento atual.

**Architecture:** Uma tabela `mayara.acoes_pendentes` (uma pendência por vez) e funções SQL que criam, confirmam e cancelam ações. `mayara.confirmar_pendente` passa a tentar primeiro a ação pendente e, se não houver, cai no caminho antigo das instruções. Ações que o banco não executa sozinho (pausar, ligar) devolvem uma linha `@efeito {...}` para o n8n agir. A busca por nome precisa do telefone dos leads do CRM, então a sincronização passa a trazer o telefone.

**Tech Stack:** PostgreSQL (Supabase), n8n (um mapeamento de coluna na sincronização).

**Spec:** `docs/superpowers/specs/2026-10-08-central-linguagem-livre-design.md`

## Global Constraints

- Migrations `0030_...` a `0032_...` em `supabase/migrations/`; testes em `supabase/tests/00NN_*.test.sql`, com `begin; ... rollback;` terminando em `select 'OK 00NN'`.
- Funções com `set search_path = ''`; `revoke all ... from public, anon, authenticated`; tabelas novas com RLS ligado.
- A ferramenta recusa `delete`, `drop` e `update` sem `where` (mesmo em transação revertida): escrever testes com `where` explícito e sem `delete`.
- `create or replace function` é permitido, mas **não** pode mudar o tipo de retorno de função existente.
- Não alterar `executar_central` nem o workflow nesta fase (a ligação ao fluxo é da Fase 3). O comportamento de hoje (ensino livre, ações com "/") deve continuar idêntico.
- O teste existente `supabase/tests/0011_central_comando.test.sql` deve continuar passando depois de cada migration que mexe em `criar_pendente` ou `confirmar_pendente`.
- Commits terminam com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Projeto Supabase: `wuhvlvsolewslkawazlq`. Credencial n8n do banco: `nNpCUIhnDuVvTApU`.

## Review Focus

1. Nunca existem duas pendências ao mesmo tempo (uma ação e uma instrução, ou duas ações): a segunda é recusada com mensagem clara.
2. "sim" ou "não" sem nada pendente, ou depois de expirar, responde sem executar nada.
3. Uma ação confirmada executa **exatamente uma vez** (um segundo "sim" não repete).
4. `abordar` é recusada nesta fase; `assumir` e `devolver` respeitam as travas que já existem (lead `sem_interesse`, não cadastrado, número inválido).
5. As funções de leitura nunca devolvem telefone completo de lead sem necessidade nem conteúdo de conversa; a busca por nome lida com 0, 1 e vários resultados e com nomes parecidos.

## File Structure

- Create: `supabase/migrations/0030_mayara_acoes_pendentes.sql`, `0031_mayara_central_consultas.sql`, `0032_mayara_busca_leads_por_nome.sql`
- Create: `supabase/tests/0030_acoes_pendentes.test.sql`, `0031_central_consultas.test.sql`, `0032_busca_leads_por_nome.test.sql`
- Modify (n8n): workflow de sincronização `PH73hjj7zIABuZ74` (nó "Upsert Leads")

---

### Task 1: Ações pendentes e confirmação unificada

**Files:**
- Create: `supabase/migrations/0030_mayara_acoes_pendentes.sql`
- Test: `supabase/tests/0030_acoes_pendentes.test.sql`

**Interfaces:**
- Consumes: `mayara.assumir_lead(text)`, `mayara.devolver_lead(text)`, `mayara.desfazer_instrucao(bigint)`, `mayara.reativar_instrucao(bigint)`, `mayara.expirar_pendentes()`, tabela `mayara.instrucoes`.
- Produces: tabela `mayara.acoes_pendentes`; `mayara.criar_acao_pendente(p_acao text, p_argumentos jsonb, p_resumo text, p_autor text) returns text`; `mayara.confirmar_acao_pendente(p_decisao text) returns text` (nulo quando não há ação pendente); `mayara.confirmar_pendente(text)` atualizada; `mayara.criar_pendente(text,text,text)` atualizada para recusar quando há ação pendente; chave `central_linguagem_livre`. Texto de efeito para o n8n: primeira linha `@efeito {"tipo":"modo","aiMode":"paused"|"active"}`, seguida do texto para o administrador.

- [ ] **Step 1: Escrever o teste (deve falhar)**

```sql
-- supabase/tests/0030_acoes_pendentes.test.sql
begin;
do $t$
declare r text;
begin
  -- chave desligada por padrao
  assert (select valor from mayara.config where chave = 'central_linguagem_livre') = 'false', 'chave nasce desligada';

  -- lead de teste
  insert into mayara.leads_autorizados (telefone, nome, status) values ('+5511999990701', 'Fulano Pendente', 'ativo');

  -- cria e mostra o resumo com instrucao de confirmar
  r := mayara.criar_acao_pendente('assumir', '{"telefone":"+5511999990701"}'::jsonb, 'Assumir o lead Fulano Pendente (final 0701)', '5514997022609');
  assert r like '%Assumir o lead Fulano Pendente%' and r like '%sim%', 'resumo com pedido de confirmacao: ' || r;
  assert (select count(*) from mayara.acoes_pendentes where estado = 'pendente') = 1, 'uma pendente';

  -- uma pendencia por vez (acao x acao e acao x instrucao)
  r := mayara.criar_acao_pendente('devolver', '{"telefone":"+5511999990701"}'::jsonb, 'Devolver', '5514997022609');
  assert r like '%aguardando%', 'segunda acao recusada: ' || r;
  r := mayara.criar_pendente('Quando perguntarem de honorarios, nao cite valores.', 'original', '5514997022609');
  assert r like '%aguardando%', 'instrucao recusada com acao pendente: ' || r;
  assert (select count(*) from mayara.instrucoes where estado = 'pendente') = 0, 'nenhuma instrucao pendente criada';

  -- "nao" cancela sem executar
  r := mayara.confirmar_pendente('nao');
  assert r like '%cancelei%', 'cancela: ' || r;
  assert (select status from mayara.leads_autorizados where telefone = '+5511999990701') = 'ativo', 'nao assumiu';
  assert (select count(*) from mayara.acoes_pendentes where estado = 'cancelada') = 1, 'marcada cancelada';

  -- "sim" confirma e executa uma unica vez
  perform mayara.criar_acao_pendente('assumir', '{"telefone":"+5511999990701"}'::jsonb, 'Assumir o lead Fulano Pendente (final 0701)', '5514997022609');
  r := mayara.confirmar_pendente('sim');
  assert r like '%parou de responder%', 'executou assumir: ' || r;
  assert (select status from mayara.leads_autorizados where telefone = '+5511999990701') = 'bloqueado', 'lead bloqueado';
  r := mayara.confirmar_pendente('sim');
  assert r like '%Não há nenhuma%', 'segundo sim nao repete: ' || r;

  -- devolver
  perform mayara.criar_acao_pendente('devolver', '{"telefone":"+5511999990701"}'::jsonb, 'Devolver o lead', '5514997022609');
  r := mayara.confirmar_pendente('sim');
  assert r like '%voltou a atender%', 'executou devolver: ' || r;
  assert (select status from mayara.leads_autorizados where telefone = '+5511999990701') = 'ativo', 'lead ativo de novo';

  -- efeitos para o n8n (pausar e ligar)
  perform mayara.criar_acao_pendente('pausar', '{}'::jsonb, 'Pausar a Mayara para todos os leads', '5514997022609');
  r := mayara.confirmar_pendente('sim');
  assert split_part(r, E'\n', 1) = '@efeito {"tipo":"modo","aiMode":"paused"}', 'efeito de pausar: ' || r;
  perform mayara.criar_acao_pendente('ligar', '{}'::jsonb, 'Ligar a Mayara', '5514997022609');
  r := mayara.confirmar_pendente('sim');
  assert split_part(r, E'\n', 1) = '@efeito {"tipo":"modo","aiMode":"active"}', 'efeito de ligar: ' || r;

  -- regras: desfazer e reativar pelo numero
  insert into mayara.instrucoes (texto, estado, autor_chave) values ('Regra de teste para desfazer.', 'ativa', 't');
  perform mayara.criar_acao_pendente('desfazer_regra', jsonb_build_object('numero', (select max(id) from mayara.instrucoes)), 'Desfazer a regra', '5514997022609');
  r := mayara.confirmar_pendente('sim');
  assert r like 'Desfeita:%', 'desfez a regra: ' || r;
  perform mayara.criar_acao_pendente('reativar_regra', jsonb_build_object('numero', (select max(id) from mayara.instrucoes)), 'Reativar a regra', '5514997022609');
  r := mayara.confirmar_pendente('sim');
  assert r like 'Reativada:%', 'reativou a regra: ' || r;

  -- travas que ja existiam continuam valendo na confirmacao
  insert into mayara.leads_autorizados (telefone, nome, status) values ('+5511999990702', 'Sem Interesse', 'sem_interesse');
  perform mayara.criar_acao_pendente('assumir', '{"telefone":"+5511999990702"}'::jsonb, 'Assumir', '5514997022609');
  r := mayara.confirmar_pendente('sim');
  assert r like '%sem interesse%', 'respeita sem_interesse: ' || r;

  -- abordar ainda nao habilitada nesta fase
  r := mayara.criar_acao_pendente('abordar', '{"telefone":"+5511999990701"}'::jsonb, 'Abordar', '5514997022609');
  assert r like '%ainda não%', 'abordar recusada: ' || r;
  assert (select count(*) from mayara.acoes_pendentes where acao = 'abordar') = 0, 'abordar nao gravada';

  -- acao desconhecida e argumentos invalidos
  r := mayara.criar_acao_pendente('apagar_tudo', '{}'::jsonb, 'x', '5514997022609');
  assert r like '%não reconhecida%', 'acao fora da lista: ' || r;
  r := mayara.criar_acao_pendente('assumir', '{"telefone":"123"}'::jsonb, 'Assumir', '5514997022609');
  assert r like '%inválido%', 'telefone invalido: ' || r;

  -- expiracao
  perform mayara.criar_acao_pendente('pausar', '{}'::jsonb, 'Pausar a Mayara', '5514997022609');
  update mayara.acoes_pendentes set confirmar_ate = now() - interval '1 minute' where estado = 'pendente';
  r := mayara.confirmar_pendente('sim');
  assert r like '%expirou%', 'expirada: ' || r;

  -- sem nada pendente, o caminho antigo das instrucoes continua igual
  r := mayara.confirmar_pendente('sim');
  assert r like '%Não há nenhuma%', 'sem pendencia: ' || r;
  r := mayara.criar_pendente('Nunca prometa resultado ao lead.', 'original', '5514997022609');
  assert r like '%Confirma?%', 'instrucao segue funcionando: ' || r;
  r := mayara.confirmar_pendente('sim');
  assert r like 'Pronto, vale a partir%', 'confirmacao de instrucao segue funcionando: ' || r;

  -- acesso fechado
  assert not has_function_privilege('anon', 'mayara.criar_acao_pendente(text,jsonb,text,text)', 'execute'), 'anon sem execute (criar)';
  assert not has_function_privilege('authenticated', 'mayara.confirmar_acao_pendente(text)', 'execute'), 'authenticated sem execute (confirmar)';
  assert not has_table_privilege('anon', 'mayara.acoes_pendentes', 'select'), 'anon sem select';
end $t$;
rollback;
select 'OK 0030' as resultado;
```

- [ ] **Step 2: Rodar e ver falhar**

Run: o conteúdo acima via `execute_sql`.
Expected: FAIL com `chave nasce desligada` (a chave não existe).

- [ ] **Step 3: Escrever a migration**

```sql
-- supabase/migrations/0030_mayara_acoes_pendentes.sql
insert into mayara.config (chave, valor) values ('central_linguagem_livre', 'false') on conflict (chave) do nothing;

create table mayara.acoes_pendentes (
  id bigserial primary key,
  acao text not null check (acao in ('pausar', 'ligar', 'assumir', 'devolver', 'desfazer_regra', 'reativar_regra', 'abordar')),
  argumentos jsonb not null default '{}'::jsonb,
  resumo text not null,
  autor_chave text not null default '',
  estado text not null default 'pendente' check (estado in ('pendente', 'confirmada', 'cancelada', 'expirada')),
  criado_em timestamptz not null default now(),
  confirmar_ate timestamptz not null default (now() + interval '10 minutes'),
  encerrada_em timestamptz
);
create unique index acoes_pendentes_uma_pendente on mayara.acoes_pendentes ((true)) where estado = 'pendente';
alter table mayara.acoes_pendentes enable row level security;
revoke all on mayara.acoes_pendentes from anon, authenticated;

create or replace function mayara.expirar_acoes_pendentes()
returns integer language plpgsql set search_path = '' as $$
declare v int;
begin
  update mayara.acoes_pendentes set estado = 'expirada', encerrada_em = now()
  where estado = 'pendente' and confirmar_ate < now();
  get diagnostics v = row_count;
  return v;
end $$;

create or replace function mayara.criar_acao_pendente(p_acao text, p_argumentos jsonb, p_resumo text, p_autor text)
returns text language plpgsql set search_path = '' as $$
declare
  v_pend text;
  v_args jsonb := coalesce(p_argumentos, '{}'::jsonb);
begin
  perform mayara.expirar_pendentes();
  perform mayara.expirar_acoes_pendentes();
  if p_acao not in ('pausar', 'ligar', 'assumir', 'devolver', 'desfazer_regra', 'reativar_regra', 'abordar') then
    return 'Ação não reconhecida. Nada foi alterado.';
  end if;
  if p_acao = 'abordar' then
    return 'Essa ação ainda não está habilitada.';
  end if;
  if p_acao in ('assumir', 'devolver') and mayara.chave_telefone(v_args ->> 'telefone') is null then
    return 'Número inválido. Use o formato +5514999990000 (com DDD).';
  end if;
  if p_acao in ('desfazer_regra', 'reativar_regra') and coalesce(v_args ->> 'numero', '') !~ '^[0-9]{1,9}$' then
    return 'Número da regra inválido. Veja os números em /regras.';
  end if;
  select resumo into v_pend from mayara.acoes_pendentes where estado = 'pendente';
  if v_pend is not null then
    return 'Ainda há uma ação aguardando confirmação: ' || v_pend || E'\nResponda *sim* ou *não* antes de pedir outra.';
  end if;
  select texto into v_pend from mayara.instrucoes where estado = 'pendente';
  if v_pend is not null then
    return 'Ainda há uma instrução aguardando confirmação: ' || v_pend || E'\nResponda *sim* ou *não* antes de pedir outra.';
  end if;
  insert into mayara.acoes_pendentes (acao, argumentos, resumo, autor_chave)
  values (p_acao, v_args, left(btrim(coalesce(p_resumo, '')), 300), coalesce(mayara.chave_telefone(p_autor), p_autor, ''));
  return left(btrim(coalesce(p_resumo, '')), 300) || E'\nConfirma? Responda *sim* ou *não* (vale por 10 minutos).';
exception when unique_violation then
  return 'Ainda há uma ação aguardando confirmação. Responda *sim* ou *não* antes de pedir outra.';
end $$;

create or replace function mayara.confirmar_acao_pendente(p_decisao text)
returns text language plpgsql set search_path = '' as $$
declare v mayara.acoes_pendentes%rowtype; r text;
begin
  perform mayara.expirar_acoes_pendentes();
  select * into v from mayara.acoes_pendentes where estado = 'pendente' for update;
  if not found then
    if exists (select 1 from mayara.acoes_pendentes where estado = 'expirada' and encerrada_em > now() - interval '60 minutes') then
      return 'A ação expirou (passaram mais de 10 minutos). Peça de novo.';
    end if;
    return null;
  end if;
  if p_decisao <> 'sim' then
    update mayara.acoes_pendentes set estado = 'cancelada', encerrada_em = now() where id = v.id;
    return 'Ok, cancelei: ' || v.resumo;
  end if;
  update mayara.acoes_pendentes set estado = 'confirmada', encerrada_em = now() where id = v.id;
  r := case v.acao
    when 'assumir' then mayara.assumir_lead(v.argumentos ->> 'telefone')
    when 'devolver' then mayara.devolver_lead(v.argumentos ->> 'telefone')
    when 'desfazer_regra' then mayara.desfazer_instrucao((v.argumentos ->> 'numero')::bigint)
    when 'reativar_regra' then mayara.reativar_instrucao((v.argumentos ->> 'numero')::bigint)
    when 'pausar' then '@efeito {"tipo":"modo","aiMode":"paused"}' || E'\nPausando a Mayara para todos os leads.'
    when 'ligar' then '@efeito {"tipo":"modo","aiMode":"active"}' || E'\nLigando a Mayara.'
    else 'Ação não reconhecida. Nada foi alterado.'
  end;
  return r;
end $$;

create or replace function mayara.confirmar_pendente(p_decisao text)
returns text language plpgsql set search_path = '' as $$
declare v mayara.instrucoes%rowtype; r text;
begin
  r := mayara.confirmar_acao_pendente(p_decisao);
  if r is not null then
    return r;
  end if;
  perform mayara.expirar_pendentes();
  select * into v from mayara.instrucoes where estado = 'pendente';
  if not found then
    if exists (select 1 from mayara.instrucoes
               where estado = 'expirada' and encerrada_em > now() - interval '60 minutes') then
      return 'A instrução expirou (passaram mais de 30 minutos). Envie de novo.';
    end if;
    return 'Não há nenhuma instrução aguardando confirmação.';
  end if;
  if p_decisao = 'sim' then
    if (select count(*) from mayara.instrucoes where estado = 'ativa') >= mayara._max_ativas() then
      return 'Não consegui ativar: o limite de ' || mayara._max_ativas()::text
             || ' instruções ativas foi atingido. Use /desfazer.';
    end if;
    update mayara.instrucoes set estado = 'ativa', ativada_em = now() where id = v.id;
    return 'Pronto, vale a partir da próxima mensagem de lead:' || E'\n' || v.id::text || '. ' || v.texto;
  end if;
  update mayara.instrucoes set estado = 'recusada', encerrada_em = now() where id = v.id;
  return 'Ok, descartei essa instrução.';
end $$;

create or replace function mayara.criar_pendente(p_texto text, p_original text, p_autor text)
returns text language plpgsql set search_path = '' as $$
declare
  v_texto text := btrim(coalesce(p_texto, ''));
  v_pend text;
begin
  perform mayara.expirar_pendentes();
  perform mayara.expirar_acoes_pendentes();
  if v_texto = '' then
    return 'Não consegui entender a instrução. Pode escrever de outro jeito?';
  end if;
  if char_length(v_texto) > 400 then
    return 'A instrução ficou longa demais (máximo 400 caracteres). Resuma ou divida em duas.';
  end if;
  select resumo into v_pend from mayara.acoes_pendentes where estado = 'pendente';
  if v_pend is not null then
    return 'Ainda há uma ação aguardando confirmação: ' || v_pend || E'\nResponda *sim* ou *não* antes de enviar outra.';
  end if;
  select texto into v_pend from mayara.instrucoes where estado = 'pendente';
  if v_pend is not null then
    return 'Ainda há uma instrução aguardando confirmação: ' || v_pend
           || E'\nResponda *sim* ou *não* antes de enviar outra.';
  end if;
  if (select count(*) from mayara.instrucoes where estado = 'ativa') >= mayara._max_ativas() then
    return 'Já há ' || mayara._max_ativas()::text || ' instruções ativas. Use /regras e /desfazer para abrir espaço.';
  end if;
  insert into mayara.instrucoes (texto, texto_original, autor_chave)
  values (v_texto, p_original, coalesce(mayara.chave_telefone(p_autor), p_autor, ''));
  return 'Entendi: ' || v_texto || E'\nConfirma? Responda *sim* ou *não* (vale por 30 minutos).';
exception when unique_violation then
  return 'Ainda há uma instrução aguardando confirmação. Responda *sim* ou *não* antes de enviar outra.';
end $$;

revoke all on function mayara.expirar_acoes_pendentes() from public, anon, authenticated;
revoke all on function mayara.criar_acao_pendente(text, jsonb, text, text) from public, anon, authenticated;
revoke all on function mayara.confirmar_acao_pendente(text) from public, anon, authenticated;
revoke all on function mayara.confirmar_pendente(text) from public, anon, authenticated;
revoke all on function mayara.criar_pendente(text, text, text) from public, anon, authenticated;
```

- [ ] **Step 4: Aplicar (`apply_migration`, nome `mayara_acoes_pendentes`) e rodar o teste**

Expected: `OK 0030`. Se algum `like` falhar por acento ou pontuação, corrigir o texto da função (não o teste) para casar com as mensagens que já existem para o administrador.

- [ ] **Step 5: Regressão do comportamento antigo**

Run: `supabase/tests/0011_central_comando.test.sql` via `execute_sql`.
Expected: o `OK 0011` (ou equivalente) do arquivo. Qualquer falha significa que `criar_pendente` ou `confirmar_pendente` mudaram de comportamento: corrigir a migration.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0030_mayara_acoes_pendentes.sql supabase/tests/0030_acoes_pendentes.test.sql
git commit -m "feat(central): acoes pendentes com confirmacao unificada (migration 0030)"
```

---

### Task 2: Funções de leitura (contagem e situação de um lead)

**Files:**
- Create: `supabase/migrations/0031_mayara_central_consultas.sql`
- Test: `supabase/tests/0031_central_consultas.test.sql`

**Interfaces:**
- Consumes: `crm_sync.leads(created_at, status, campaign)`, `mayara.leads_autorizados`, `mayara.session_state`.
- Produces: `mayara.contagem_leads(p_periodo text) returns text` (`hoje`, `semana`, `mes`); `mayara.situacao_lead(p_telefone text) returns text`.

- [ ] **Step 1: Escrever o teste (deve falhar)**

```sql
-- supabase/tests/0031_central_consultas.test.sql
begin;
do $t$
declare r text;
begin
  -- leads de teste: 2 hoje, 1 ha 3 dias, 1 ha 40 dias
  insert into crm_sync.leads (id, name, status, campaign, created_at, modified_at) values
    ('t-q1', 'Hoje Um', 'New', '[MF] GESTÃO DE PASSIVO', now(), now()),
    ('t-q2', 'Hoje Dois', 'New', '[MF] GESTÃO DE PASSIVO', now(), now()),
    ('t-q3', 'Tres Dias', 'Assigned', null, now() - interval '3 days', now()),
    ('t-q4', 'Quarenta Dias', 'Dead', null, now() - interval '40 days', now());

  r := mayara.contagem_leads('hoje');
  assert r like '%hoje%' and r ~ '(^|[^0-9])[0-9]+ lead', 'texto de hoje: ' || r;
  assert (mayara._numero_na_frase(r)) >= 2, 'conta pelo menos os 2 de hoje: ' || r;
  assert (mayara._numero_na_frase(mayara.contagem_leads('semana'))) >= 3, 'semana inclui o de 3 dias';
  assert (mayara._numero_na_frase(mayara.contagem_leads('mes'))) >= 3, 'mes inclui os recentes';
  assert (mayara._numero_na_frase(mayara.contagem_leads('mes'))) < (select count(*) from crm_sync.leads), 'mes exclui o de 40 dias';
  assert mayara.contagem_leads('ontem-do-ano-passado') like '%não reconheci o período%', 'periodo invalido';

  -- situacao de um lead autorizado, com sessao
  insert into mayara.leads_autorizados (telefone, nome, status, espocrm_lead_id) values ('+5511999990801', 'Lead Situacao', 'ativo', 't-q3');
  insert into mayara.session_state (session_key, phone, estado, last_lead_message_at) values ('whatsapp:escritorio:+5511999990801', '+5511999990801', 'S2_QUALIFICACAO', now() - interval '2 hours');
  r := mayara.situacao_lead('+5511999990801');
  assert r like '%Lead Situacao%' and r like '%ativo%' and r like '%S2_QUALIFICACAO%', 'situacao completa: ' || r;
  assert r not like '%5511999990801%', 'nao devolve o telefone completo: ' || r;
  assert r like '%0801%', 'mostra so o final do telefone: ' || r;

  -- lead desconhecido e telefone invalido
  r := mayara.situacao_lead('+5511999990899');
  assert r like '%não está na lista%', 'desconhecido: ' || r;
  r := mayara.situacao_lead('123');
  assert r like '%inválido%', 'invalido: ' || r;

  assert not has_function_privilege('anon', 'mayara.contagem_leads(text)', 'execute'), 'anon sem execute (contagem)';
  assert not has_function_privilege('authenticated', 'mayara.situacao_lead(text)', 'execute'), 'authenticated sem execute (situacao)';
end $t$;
rollback;
select 'OK 0031' as resultado;
```

- [ ] **Step 2: Rodar e ver falhar**

Expected: FAIL (`function mayara.contagem_leads(unknown) does not exist`).

- [ ] **Step 3: Escrever a migration**

```sql
-- supabase/migrations/0031_mayara_central_consultas.sql
create or replace function mayara._numero_na_frase(p_texto text)
returns int language sql immutable set search_path = '' as $$
  select coalesce((regexp_match(p_texto, '([0-9]+)'))[1]::int, 0)
$$;

create or replace function mayara.contagem_leads(p_periodo text)
returns text language plpgsql stable set search_path = '' as $$
declare
  v_desde timestamptz;
  v_rotulo text;
  v_total int;
  v_novos int;
begin
  case lower(btrim(coalesce(p_periodo, '')))
    when 'hoje' then
      v_desde := date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
      v_rotulo := 'hoje';
    when 'semana' then
      v_desde := (date_trunc('day', now() at time zone 'America/Sao_Paulo') - interval '6 days') at time zone 'America/Sao_Paulo';
      v_rotulo := 'nos últimos 7 dias';
    when 'mes' then
      v_desde := (date_trunc('day', now() at time zone 'America/Sao_Paulo') - interval '29 days') at time zone 'America/Sao_Paulo';
      v_rotulo := 'nos últimos 30 dias';
    else
      return 'Não reconheci o período. Use hoje, semana ou mês.';
  end case;
  select count(*), count(*) filter (where status = 'New') into v_total, v_novos
    from crm_sync.leads where created_at >= v_desde;
  return v_total::text || ' leads recebidos ' || v_rotulo || ' (' || v_novos::text || ' ainda sem atendimento no CRM).';
end $$;

create or replace function mayara.situacao_lead(p_telefone text)
returns text language plpgsql stable set search_path = '' as $$
declare
  v_chave text := mayara.chave_telefone(p_telefone);
  l mayara.leads_autorizados%rowtype;
  s mayara.session_state%rowtype;
  v_crm text;
begin
  if v_chave is null then
    return 'Número inválido. Use o formato +5514999990000 (com DDD).';
  end if;
  select * into l from mayara.leads_autorizados where telefone_chave = v_chave;
  if not found then
    return 'Esse número não está na lista de leads da Mayara.';
  end if;
  select * into s from mayara.session_state where mayara.chave_telefone(phone) = v_chave order by last_lead_message_at desc nulls last limit 1;
  if l.espocrm_lead_id is not null then
    select status into v_crm from crm_sync.leads where id = l.espocrm_lead_id;
  end if;
  return coalesce(l.nome, 'Lead') || ' (final ' || right(v_chave, 4) || E')\n'
    || 'Mayara: ' || l.status || E'\n'
    || 'Conversa: ' || coalesce(s.estado, 'sem conversa') || E'\n'
    || 'Última mensagem do lead: ' || coalesce(to_char(s.last_lead_message_at at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI'), 'nenhuma') || E'\n'
    || 'Consulta: ' || coalesce(to_char(s.consulta_agendada_em at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI'), 'não agendada') || E'\n'
    || 'CRM: ' || coalesce(v_crm, 'sem registro vinculado');
end $$;

revoke all on function mayara._numero_na_frase(text) from public, anon, authenticated;
revoke all on function mayara.contagem_leads(text) from public, anon, authenticated;
revoke all on function mayara.situacao_lead(text) from public, anon, authenticated;
```

- [ ] **Step 4: Aplicar (`apply_migration`, nome `mayara_central_consultas`) e rodar o teste**

Expected: `OK 0031`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0031_mayara_central_consultas.sql supabase/tests/0031_central_consultas.test.sql
git commit -m "feat(central): funcoes de leitura contagem_leads e situacao_lead (migration 0031)"
```

---

### Task 3: Telefone no lead do CRM e busca por nome

**Files:**
- Create: `supabase/migrations/0032_mayara_busca_leads_por_nome.sql`
- Test: `supabase/tests/0032_busca_leads_por_nome.test.sql`
- Modify (n8n): nó "Upsert Leads" do workflow `PH73hjj7zIABuZ74`

**Interfaces:**
- Consumes: `crm_sync.leads(id, name, status)`, `mayara.leads_autorizados(telefone, nome, status, espocrm_lead_id)`, `mayara.chave_telefone`.
- Produces: coluna `crm_sync.leads.phone`; `mayara.buscar_leads_por_nome(p_nome text) returns jsonb` (lista de `{nome, fim, status, origem, telefone, crm_lead_id}`; o telefone completo só é usado por quem chama a função dentro do banco/n8n, nunca é mostrado ao administrador).

- [ ] **Step 1: Escrever o teste (deve falhar)**

```sql
-- supabase/tests/0032_busca_leads_por_nome.test.sql
begin;
do $t$
declare r jsonb;
begin
  assert exists (select 1 from information_schema.columns where table_schema = 'crm_sync' and table_name = 'leads' and column_name = 'phone'), 'coluna phone existe';

  insert into crm_sync.leads (id, name, status, phone, created_at, modified_at) values
    ('t-b1', 'Gilberto Fuke', 'New', '+5511999990901', now(), now()),
    ('t-b2', 'Gilberto Souza', 'New', '+5511999990902', now(), now()),
    ('t-b3', 'Solange de Brito', 'New', '+5518999990903', now(), now()),
    ('t-b4', 'Sem Telefone', 'New', null, now(), now());
  insert into mayara.leads_autorizados (telefone, nome, status, espocrm_lead_id) values ('+5511999990901', 'Gilberto Fuke', 'ativo', 't-b1');

  -- um resultado so (o mesmo lead no CRM e na lista conta uma vez)
  r := mayara.buscar_leads_por_nome('fuke');
  assert jsonb_array_length(r) = 1, 'um resultado para fuke: ' || r::text;
  assert (r -> 0 ->> 'fim') = '0901', 'final do telefone';
  assert (r -> 0 ->> 'origem') = 'lista_e_crm' or (r -> 0 ->> 'origem') = 'lista', 'origem informada: ' || r::text;

  -- dois resultados para o primeiro nome
  r := mayara.buscar_leads_por_nome('gilberto');
  assert jsonb_array_length(r) = 2, 'dois gilbertos: ' || r::text;

  -- ignora acento e caixa
  r := mayara.buscar_leads_por_nome('SOLÂNGE');
  assert jsonb_array_length(r) = 1, 'sem acento e caixa: ' || r::text;

  -- nenhum resultado
  r := mayara.buscar_leads_por_nome('inexistentezzz');
  assert jsonb_array_length(r) = 0, 'zero resultados';

  -- lead do CRM sem telefone nao e acionavel
  r := mayara.buscar_leads_por_nome('Sem Telefone');
  assert jsonb_array_length(r) = 1 and (r -> 0 ->> 'telefone') is null, 'sem telefone aparece como nao acionavel: ' || r::text;

  -- busca vazia ou curta demais nao lista todo mundo
  assert jsonb_array_length(mayara.buscar_leads_por_nome('')) = 0, 'vazio nao lista';
  assert jsonb_array_length(mayara.buscar_leads_por_nome('a')) = 0, 'uma letra nao lista';

  -- limite de resultados
  insert into crm_sync.leads (id, name, status, phone, created_at, modified_at)
    select 't-m' || g, 'Maria Teste ' || g, 'New', '+55119999908' || lpad(g::text, 2, '0'), now(), now() from generate_series(10, 25) g;
  assert jsonb_array_length(mayara.buscar_leads_por_nome('maria teste')) <= 10, 'limita a 10';

  assert not has_function_privilege('anon', 'mayara.buscar_leads_por_nome(text)', 'execute'), 'anon sem execute';
  assert not has_function_privilege('authenticated', 'mayara.buscar_leads_por_nome(text)', 'execute'), 'authenticated sem execute';
end $t$;
rollback;
select 'OK 0032' as resultado;
```

- [ ] **Step 2: Rodar e ver falhar**

Expected: FAIL em `coluna phone existe`.

- [ ] **Step 3: Escrever a migration**

```sql
-- supabase/migrations/0032_mayara_busca_leads_por_nome.sql
alter table crm_sync.leads add column phone text;

create or replace function mayara._sem_acento(p_texto text)
returns text language sql immutable set search_path = '' as $$
  select lower(translate(coalesce(p_texto, ''), 'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ', 'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn'))
$$;

create or replace function mayara.buscar_leads_por_nome(p_nome text)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_busca text := btrim(mayara._sem_acento(p_nome));
  r jsonb;
begin
  if char_length(v_busca) < 3 then
    return '[]'::jsonb;
  end if;
  with lista as (
    select nome, telefone, telefone_chave as chave, status, espocrm_lead_id as crm_id
    from mayara.leads_autorizados
    where mayara._sem_acento(nome) like '%' || v_busca || '%'
  ), crm as (
    select name as nome, phone as telefone, mayara.chave_telefone(phone) as chave, status as status_crm, id as crm_id
    from crm_sync.leads
    where mayara._sem_acento(name) like '%' || v_busca || '%'
  ), uniao as (
    select coalesce(l.nome, c.nome) as nome,
           coalesce(l.telefone, c.telefone) as telefone,
           coalesce(l.chave, c.chave) as chave,
           coalesce(l.status, 'fora_da_lista') as status,
           coalesce(l.crm_id, c.crm_id) as crm_id,
           case when l.nome is not null and c.nome is not null then 'lista_e_crm' when l.nome is not null then 'lista' else 'crm' end as origem
    from lista l full join crm c on c.crm_id = l.crm_id or (c.chave is not null and c.chave = l.chave)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'nome', nome, 'fim', right(coalesce(chave, ''), 4), 'status', status,
           'origem', origem, 'telefone', telefone, 'crm_lead_id', crm_id) order by nome), '[]'::jsonb)
    into r from (select * from uniao order by nome limit 10) x;
  return r;
end $$;

revoke all on function mayara._sem_acento(text) from public, anon, authenticated;
revoke all on function mayara.buscar_leads_por_nome(text) from public, anon, authenticated;
```

- [ ] **Step 4: Aplicar (`apply_migration`, nome `mayara_busca_leads_por_nome`) e rodar o teste**

Expected: `OK 0032`.

- [ ] **Step 5: Mapear o telefone na sincronização do CRM**

`n8n_update_partial_workflow` em `PH73hjj7zIABuZ74`:

```json
[{"type":"updateNode","nodeName":"Upsert Leads","updates":{"parameters.columns.value.phone":"={{ $json.phoneNumber }}"}}]
```
Expected: o nó passa a ter a chave `phone`. Se a conexão fechar, reler antes de repetir; depois de 3 tentativas sem aplicar, pedir ao usuário para adicionar a coluna `phone` = `{{ $json.phoneNumber }}` no nó "Upsert Leads" pela interface do n8n.

- [ ] **Step 6: Preencher o telefone dos leads que já existem**

Forçar a sincronização a reler todos os leads (59, abaixo do limite de 200 por execução):

```sql
update crm_sync.sync_state set last_synced_at = '1970-01-01 00:00:00+00' where entity_name = 'Lead';
```
Esperar a próxima execução (até 5 minutos) e conferir:

```sql
select count(*) as leads, count(phone) as com_telefone from crm_sync.leads;
```
Expected: `com_telefone` igual a `leads` (ou muito próximo; leads sem telefone no CRM contam como diferença). O histórico de status **não** duplica, porque o status não muda.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0032_mayara_busca_leads_por_nome.sql supabase/tests/0032_busca_leads_por_nome.test.sql
git commit -m "feat(central): telefone no lead do CRM e busca por nome (migration 0032)"
```

---

### Task 4: Verificação final da Fase 1

**Files:** nenhum novo.

- [ ] **Step 1: Conferir o conjunto**

```sql
select
 (select valor from mayara.config where chave = 'central_linguagem_livre') as chave,
 (select count(*) from mayara.acoes_pendentes) as acoes_pendentes_reais,
 (select count(*) from mayara.instrucoes where estado = 'pendente') as instrucoes_pendentes,
 (select count(*) from crm_sync.leads) as leads,
 (select count(phone) from crm_sync.leads) as com_telefone,
 mayara.contagem_leads('semana') as contagem_semana,
 jsonb_array_length(mayara.buscar_leads_por_nome('gilberto')) as achados_gilberto;
```
Expected: `chave` = `false`; `acoes_pendentes_reais` = 0; `instrucoes_pendentes` = 0; `com_telefone` ≈ `leads`; `achados_gilberto` = 1; a frase da contagem lê coerente.

- [ ] **Step 2: Rodar toda a bateria dos testes SQL desta fase e a regressão**

Run: 0030, 0031, 0032 e `0011_central_comando.test.sql` via `execute_sql`.
Expected: `OK 0030`, `OK 0031`, `OK 0032` e o OK do 0011.

- [ ] **Step 3: Confirmar que nada mudou para o administrador**

Mandar do número de administrador `/status` e `/regras` (comandos com "/") e uma frase livre simples.
Expected: respostas iguais às de antes (a chave está desligada, e o ramo livre ainda é o antigo).

- [ ] **Step 4: Registrar na especificação**

Acrescentar à seção "Fases" da especificação a linha `Fase 1 concluída em <data>`.

```bash
git add docs/superpowers/specs/2026-10-08-central-linguagem-livre-design.md
git commit -m "docs(central): Fase 1 concluida"
```
