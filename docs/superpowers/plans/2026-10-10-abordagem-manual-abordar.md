# Comando `abordar`: abordagem manual com aprovação Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O administrador escreve `/abordar <telefone ou nome>` (ou `abordar +5514999990000`) no WhatsApp do escritório; a Central acha o lead, prepara uma proposta de retomada de contato e a envia para o administrador aprovar com `sim N`. Nada é enviado ao lead sem o `sim N`.

**Architecture:** Reaproveita tudo da abordagem assistida: a proposta, o `Notificar`, o `sim/não/editar N` e o envio pelo `Canal: Enviar`. Novo: uma função do banco que resolve o alvo (`preparar_abordagem`), uma variante de criação de proposta com regras de repetição mais adequadas a um pedido manual (`criar_proposta_manual`), um modo "retomada" na biblioteca de redação, e um ramo `abordar` na Central que chama o sub-workflow `Propor`.

**Tech Stack:** PostgreSQL (Supabase), Node.js (`node:test`), n8n.

**Spec:** `docs/superpowers/specs/2026-10-09-abordagem-assistida-design.md` e a ação `abordar` de `docs/superpowers/specs/2026-10-08-central-linguagem-livre-design.md` (esta fase a antecipa, sem IA).

## Global Constraints

- Migration `0037_...`; teste em `supabase/tests/0037_*.test.sql`, com `begin; ... rollback;` terminando em `select 'OK 0037'`. A ferramenta recusa `delete`, `drop` e `update` sem `where`. Telefones de teste `+55119999909xx`, nomes com sufixo "Teste"; leads de teste em `crm_sync.leads` com id `t-...` (dentro de transação revertida).
- `abordar` **nunca envia**: só cria proposta. O envio continua exclusivo do `sim N`.
- Só aborda lead que existe no CRM (`crm_sync.leads`) ou na lista da Mayara (`mayara.leads_autorizados`). Número desconhecido é recusado.
- Recusas: lead `sem_interesse`; lead `bloqueado` (assumido pela equipe: orientar `/devolver +telefone` e pedir de novo); lead sem telefone; chave `abordagem_assistida` desligada; nome com zero ou vários resultados (lista nome e final do telefone, não escolhe sozinho).
- Texto de retomada (aprovado pelo usuário em 10/10): "Estou retomando sua solicitação sobre as dívidas bancárias da empresa. Essa situação ainda está em aberto por aí?". Sem perfil conhecido, usar "sobre as dívidas bancárias".
- Texto livre do administrador que apenas comece com a palavra "abordar" (ensino de regra) **não** pode virar comando: sem barra, só `abordar` seguido de telefone é comando.
- Todo caminho da Central responde ao administrador (nenhum silêncio): usar `alwaysOutputData` onde um sub-workflow pode não devolver itens.
- n8n-mcp: operações pequenas; reler o estado antes de repetir (uma chamada que "fecha a conexão" pode ter sido aplicada); no máximo 3 tentativas; depois entregar o JSON ao usuário. `updateNode` do `jsCode` grande às vezes exige repetir.
- Commits terminam com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Projeto Supabase `wuhvlvsolewslkawazlq`. Ids n8n: Central `jNhj68Ee7i3w8dey`, Propor `G7eWMOcC16UWuism`, Notificar `kjQrAmfRpDWRRJvH`, Canal: Enviar `SHLZkNqfbCrs2OSQ`.

## Review Focus

1. `abordar` não envia nada e não altera o estado do lead (não devolve, não autoriza janela): só cria proposta.
2. Número desconhecido, lead que pediu para parar e lead assumido pela equipe são recusados com mensagem clara; nome ambíguo lista os candidatos e não escolhe.
3. Pedido repetido não duplica: proposta aberta ou aprovada, janela de abordagem ainda válida ou envio nos últimos 7 dias bloqueiam; lead que escreveu nas últimas 48 horas é recusado (a Mayara já pode responder).
4. Toda resposta chega ao administrador, inclusive com chave desligada, falha do sub-workflow ou erro do banco.
5. Frases de ensino que começam com "abordar" (sem telefone) continuam sendo ensino; o primeiro contato de leads do grupo continua idêntico (modo ausente).

## File Structure

- Create: `supabase/migrations/0037_mayara_abordar.sql`, `supabase/tests/0037_abordar.test.sql`
- Modify: `docs/superpowers/specs/2026-10-09-abordagem-assistida/redigir.mjs`, `redigir.test.mjs`, `gerar-redigir-node.mjs`, `gerar-workflows.mjs`, `gerar-workflows.test.mjs`; regenerar `redigir.node.js` e os JSON em `docs/superpowers/specs/workflows/`
- Modify: `docs/superpowers/specs/2026-10-03-central-comando/central-comando.mjs`, `central-propostas.test.mjs`
- Create: `docs/superpowers/specs/2026-10-09-abordagem-assistida/gerar-central-abordar.mjs` (operações da Central e novo `Classificar`)

---

### Task 1: Banco: `criar_proposta_manual` e `preparar_abordagem`

**Files:**
- Create: `supabase/migrations/0037_mayara_abordar.sql`
- Test: `supabase/tests/0037_abordar.test.sql`

**Interfaces:**
- Consumes: `mayara.chave_telefone`, `mayara.buscar_leads_por_nome(text) returns jsonb` (itens `{nome, fim, status, origem, telefone, crm_lead_id}`), `crm_sync.leads(id, name, status, phone)`, `mayara.leads_autorizados`, `mayara.session_state`, `mayara.envios_log(destino_chave)`, `mayara.propostas_abordagem`.
- Produces:
  - `mayara.criar_proposta_manual(p_telefone text, p_nome text, p_crm_lead_id text, p_texto text, p_fatos jsonb, p_lacuna text) returns jsonb` (`{"ok":true,"id":N}` ou `{"ok":false,"motivo":"telefone_invalido|texto_vazio|texto_longo|lead_sem_interesse|lead_assumido|lead_inativo|conversa_recente|ja_abordado"}`).
  - `mayara.preparar_abordagem(p_alvo text, p_autor text) returns jsonb`: `{"acao":"responder","resposta":"..."}` ou `{"acao":"redigir","lead":{"nome","telefone"},"crmLeadId":"...","modo":"retomada|primeiro_contato","manual":true}`.

- [ ] **Step 1: Escrever o teste (deve falhar)**

```sql
-- supabase/tests/0037_abordar.test.sql
begin;
do $t$
declare r jsonb; v_id bigint;
begin
  update mayara.config set valor = 'true' where chave = 'abordagem_assistida';

  insert into crm_sync.leads (id, name, status, phone, created_at, modified_at) values
    ('t-ab1', 'Helena Abordar Teste', 'New', '+5511999990921', now(), now()),
    ('t-ab2', 'Igor Abordar Teste', 'Assigned', '+5511999990922', now(), now()),
    ('t-ab3', 'Julia Abordar Teste', 'Assigned', '+5511999990923', now(), now()),
    ('t-ab4', 'Julia Abordar Teste Dois', 'Assigned', '+5511999990924', now(), now()),
    ('t-ab5', 'Kleber Abordar Teste', 'Assigned', '+5511999990925', now(), now()),
    ('t-ab6', 'Lia Abordar Teste', 'Assigned', '+5511999990926', now(), now()),
    ('t-ab7', 'Sem Fone Abordar Teste', 'Assigned', null, now(), now());
  insert into mayara.leads_autorizados (telefone, nome, status, espocrm_lead_id) values
    ('+5511999990922', 'Igor Abordar Teste', 'ativo', 't-ab2'),
    ('+5511999990925', 'Kleber Abordar Teste', 'sem_interesse', 't-ab5'),
    ('+5511999990926', 'Lia Abordar Teste', 'bloqueado', 't-ab6');

  -- chave desligada
  update mayara.config set valor = 'false' where chave = 'abordagem_assistida';
  r := mayara.preparar_abordagem('+5511999990921', 'x');
  assert (r ->> 'acao') = 'responder' and (r ->> 'resposta') like '%desligada%', 'chave desligada: ' || r::text;
  update mayara.config set valor = 'true' where chave = 'abordagem_assistida';

  -- vazio e curto
  r := mayara.preparar_abordagem('   ', 'x');
  assert (r ->> 'acao') = 'responder' and (r ->> 'resposta') like '%Diga quem abordar%', 'vazio: ' || r::text;
  r := mayara.preparar_abordagem('ab', 'x');
  assert (r ->> 'resposta') like '%Não achei%', 'nome curto: ' || r::text;

  -- por telefone: lead novo no CRM, nunca contatado -> primeiro contato
  r := mayara.preparar_abordagem('+55 11 99999-0921', 'x');
  assert (r ->> 'acao') = 'redigir' and (r ->> 'modo') = 'primeiro_contato' and (r -> 'lead' ->> 'nome') = 'Helena Abordar Teste'
     and (r -> 'lead' ->> 'telefone') = '+5511999990921' and (r ->> 'crmLeadId') = 't-ab1' and (r -> 'manual') = 'true'::jsonb, 'novo no crm: ' || r::text;

  -- por telefone: lead ja conhecido da Mayara -> retomada
  r := mayara.preparar_abordagem('5511999990922', 'x');
  assert (r ->> 'acao') = 'redigir' and (r ->> 'modo') = 'retomada' and (r ->> 'crmLeadId') = 't-ab2', 'conhecido: ' || r::text;

  -- por nome (um resultado)
  r := mayara.preparar_abordagem('igor abordar', 'x');
  assert (r ->> 'acao') = 'redigir' and (r -> 'lead' ->> 'telefone') = '+5511999990922', 'por nome: ' || r::text;

  -- nome ambiguo: lista e nao escolhe
  r := mayara.preparar_abordagem('Julia Abordar Teste', 'x');
  assert (r ->> 'acao') = 'responder' and (r ->> 'resposta') like '%Julia Abordar Teste (final 0923)%' and (r ->> 'resposta') like '%Julia Abordar Teste Dois (final 0924)%', 'ambiguo: ' || r::text;
  assert (r ->> 'resposta') not like '%5511999990923%', 'lista so mostra o final: ' || r::text;

  -- numero desconhecido e nome inexistente
  r := mayara.preparar_abordagem('+5511999990999', 'x');
  assert (r ->> 'acao') = 'responder' and (r ->> 'resposta') like '%não está no CRM%', 'desconhecido: ' || r::text;
  r := mayara.preparar_abordagem('inexistentezzz', 'x');
  assert (r ->> 'resposta') like '%Não achei%', 'nome inexistente: ' || r::text;

  -- recusas por situacao do lead
  r := mayara.preparar_abordagem('+5511999990925', 'x');
  assert (r ->> 'acao') = 'responder' and (r ->> 'resposta') like '%pediu para parar%', 'sem interesse: ' || r::text;
  r := mayara.preparar_abordagem('+5511999990926', 'x');
  assert (r ->> 'acao') = 'responder' and (r ->> 'resposta') like '%/devolver +5511999990926%', 'assumido orienta devolver: ' || r::text;
  r := mayara.preparar_abordagem('Sem Fone Abordar', 'x');
  assert (r ->> 'acao') = 'responder' and (r ->> 'resposta') like '%não tem telefone%', 'sem telefone: ' || r::text;

  -- preparar nao altera o estado do lead
  assert (select status from mayara.leads_autorizados where telefone_chave = mayara.chave_telefone('+5511999990922')) = 'ativo', 'nao mexe no lead';
  assert (select abordagem_ate from mayara.leads_autorizados where telefone_chave = mayara.chave_telefone('+5511999990922')) is null, 'nao abre janela';
  assert (select count(*) from mayara.propostas_abordagem where telefone_chave = mayara.chave_telefone('+5511999990922')) = 0, 'nao cria proposta sozinho';

  -- criar_proposta_manual: caminho feliz e recusas
  r := mayara.criar_proposta_manual('+5511999990922', 'Igor Abordar Teste', 't-ab2', 'Bom dia, Igor. Tudo bem? Aqui é a Mayara. Essa situação ainda está em aberto por aí?', '{}'::jsonb, 'retomada');
  assert (r ->> 'ok') = 'true', 'manual cria: ' || r::text;
  v_id := (r ->> 'id')::bigint;
  r := mayara.criar_proposta_manual('+5511999990922', 'Igor Abordar Teste', 't-ab2', 'Outro', '{}'::jsonb, 'retomada');
  assert (r ->> 'motivo') = 'ja_abordado', 'proposta aberta bloqueia: ' || r::text;
  r := mayara.criar_proposta_manual('+5511999990925', 'Kleber', 't-ab5', 'Oi', '{}'::jsonb, null);
  assert (r ->> 'motivo') = 'lead_sem_interesse', 'sem_interesse: ' || r::text;
  r := mayara.criar_proposta_manual('+5511999990926', 'Lia', 't-ab6', 'Oi', '{}'::jsonb, null);
  assert (r ->> 'motivo') = 'lead_assumido', 'assumido: ' || r::text;
  r := mayara.criar_proposta_manual('123', 'X', null, 'Oi', '{}'::jsonb, null);
  assert (r ->> 'motivo') = 'telefone_invalido', 'telefone: ' || r::text;
  r := mayara.criar_proposta_manual('+5511999990921', 'Helena', 't-ab1', '   ', '{}'::jsonb, null);
  assert (r ->> 'motivo') = 'texto_vazio', 'texto vazio: ' || r::text;
  r := mayara.criar_proposta_manual('+5511999990921', 'Helena', 't-ab1', repeat('x', 701), '{}'::jsonb, null);
  assert (r ->> 'motivo') = 'texto_longo', 'texto longo: ' || r::text;

  -- conversa recente bloqueia; janela antiga e envio antigo nao bloqueiam
  insert into mayara.session_state (session_key, phone, estado, last_lead_message_at)
    values ('whatsapp:escritorio:+5511999990921', '+5511999990921', 'S2_QUALIFICACAO', now() - interval '3 hours');
  r := mayara.criar_proposta_manual('+5511999990921', 'Helena', 't-ab1', 'Bom dia. Aqui é a Mayara. Essa situação ainda está em aberto?', '{}'::jsonb, null);
  assert (r ->> 'motivo') = 'conversa_recente', 'conversa recente: ' || r::text;
  update mayara.session_state set last_lead_message_at = now() - interval '5 days' where session_key = 'whatsapp:escritorio:+5511999990921';
  update mayara.leads_autorizados set abordagem_ate = now() - interval '2 days' where telefone_chave = mayara.chave_telefone('+5511999990922');
  update mayara.propostas_abordagem set estado = 'enviada', encerrada_em = now() - interval '10 days' where id = v_id;
  r := mayara.criar_proposta_manual('+5511999990922', 'Igor Abordar Teste', 't-ab2', 'Bom dia, Igor. Aqui é a Mayara. Essa situação ainda está em aberto?', '{}'::jsonb, 'retomada');
  assert (r ->> 'ok') = 'true', 'janela expirada e envio antigo nao bloqueiam: ' || r::text;
  update mayara.propostas_abordagem set estado = 'enviada', encerrada_em = now() - interval '2 days' where id = (r ->> 'id')::bigint;
  r := mayara.criar_proposta_manual('+5511999990922', 'Igor Abordar Teste', 't-ab2', 'Outro', '{}'::jsonb, 'retomada');
  assert (r ->> 'motivo') = 'ja_abordado', 'envio recente (2 dias) bloqueia: ' || r::text;

  assert not has_function_privilege('anon', 'mayara.preparar_abordagem(text,text)', 'execute'), 'anon preparar';
  assert not has_function_privilege('authenticated', 'mayara.criar_proposta_manual(text,text,text,text,jsonb,text)', 'execute'), 'authenticated manual';
end $t$;
rollback;
select 'OK 0037' as resultado;
```

- [ ] **Step 2: Rodar e ver falhar**

Run: o conteúdo acima via `execute_sql`.
Expected: FAIL (`function mayara.preparar_abordagem(unknown, unknown) does not exist`).

- [ ] **Step 3: Escrever a migration**

```sql
-- supabase/migrations/0037_mayara_abordar.sql
create or replace function mayara.criar_proposta_manual(
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
  if v_status = 'sem_interesse' then
    return jsonb_build_object('ok', false, 'motivo', 'lead_sem_interesse');
  elsif v_status = 'bloqueado' then
    return jsonb_build_object('ok', false, 'motivo', 'lead_assumido');
  elsif v_status is not null and v_status <> 'ativo' then
    return jsonb_build_object('ok', false, 'motivo', 'lead_inativo');
  end if;
  if exists (select 1 from mayara.session_state s
             where mayara.chave_telefone(s.phone) = v_chave
               and s.last_lead_message_at > now() - interval '48 hours') then
    return jsonb_build_object('ok', false, 'motivo', 'conversa_recente');
  end if;
  if exists (select 1 from mayara.leads_autorizados la where la.telefone_chave = v_chave and la.abordagem_ate > now())
     or exists (select 1 from mayara.propostas_abordagem p
                where p.telefone_chave = v_chave
                  and (p.estado in ('aberta', 'aprovada')
                       or (p.estado = 'enviada' and p.encerrada_em > now() - interval '7 days'))) then
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

create or replace function mayara.preparar_abordagem(p_alvo text, p_autor text)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_alvo text := btrim(coalesce(p_alvo, ''));
  v_chave text := mayara.chave_telefone(v_alvo);
  v_lista jsonb;
  v_n int;
  v_nome text;
  v_tel text;
  v_crm text;
  v_status text := 'fora_da_lista';
  v_texto text;
  v_modo text;
begin
  if coalesce((select valor from mayara.config where chave = 'abordagem_assistida'), 'false') <> 'true' then
    return jsonb_build_object('acao', 'responder', 'resposta', 'A abordagem assistida está desligada.');
  end if;
  if v_alvo = '' then
    return jsonb_build_object('acao', 'responder', 'resposta', 'Diga quem abordar. Exemplo: /abordar +5514999990000 ou /abordar Maria Silva.');
  end if;

  if v_chave is not null then
    select c.id, c.name, c.phone into v_crm, v_nome, v_tel
      from crm_sync.leads c where mayara.chave_telefone(c.phone) = v_chave limit 1;
    select coalesce(v_nome, la.nome), coalesce(v_tel, la.telefone), la.status, coalesce(v_crm, la.espocrm_lead_id)
      into v_nome, v_tel, v_texto, v_crm
      from (select 1) x left join mayara.leads_autorizados la on la.telefone_chave = v_chave;
    if v_tel is null then
      return jsonb_build_object('acao', 'responder', 'resposta', 'Esse número não está no CRM nem na lista da Mayara. Só abordo leads já cadastrados.');
    end if;
    v_status := coalesce(v_texto, 'fora_da_lista');
  else
    v_lista := mayara.buscar_leads_por_nome(v_alvo);
    v_n := jsonb_array_length(v_lista);
    if v_n = 0 then
      return jsonb_build_object('acao', 'responder', 'resposta', 'Não achei lead com "' || left(v_alvo, 40) || '". Envie o telefone com DDD: /abordar +5514999990000');
    end if;
    if v_n > 1 then
      return jsonb_build_object('acao', 'responder', 'resposta',
        'Achei ' || v_n::text || ' leads parecidos:' || E'\n'
        || (select string_agg('- ' || (e ->> 'nome') || ' (final ' || (e ->> 'fim') || ')', E'\n') from jsonb_array_elements(v_lista) e)
        || E'\nEnvie de novo com o telefone: /abordar +5514999990000');
    end if;
    v_nome := v_lista -> 0 ->> 'nome';
    v_tel := v_lista -> 0 ->> 'telefone';
    v_crm := v_lista -> 0 ->> 'crm_lead_id';
    v_status := coalesce(v_lista -> 0 ->> 'status', 'fora_da_lista');
    if v_tel is null then
      return jsonb_build_object('acao', 'responder', 'resposta', 'O lead ' || v_nome || ' não tem telefone no CRM.');
    end if;
    v_chave := mayara.chave_telefone(v_tel);
  end if;

  if v_status = 'sem_interesse' then
    return jsonb_build_object('acao', 'responder', 'resposta', v_nome || ' pediu para parar de receber mensagens. Não vou abordar.');
  end if;
  if v_status = 'bloqueado' then
    return jsonb_build_object('acao', 'responder', 'resposta',
      'A equipe assumiu o lead ' || v_nome || '. Para a Mayara voltar a atendê-lo, envie /devolver ' || v_tel || ' e peça a abordagem de novo.');
  end if;

  v_modo := case
    when v_status = 'fora_da_lista'
         and not exists (select 1 from mayara.session_state s where mayara.chave_telefone(s.phone) = v_chave)
         and not exists (select 1 from mayara.envios_log l where l.destino_chave = v_chave)
    then 'primeiro_contato' else 'retomada' end;

  return jsonb_build_object('acao', 'redigir', 'lead', jsonb_build_object('nome', v_nome, 'telefone', v_tel),
                            'crmLeadId', coalesce(v_crm, ''), 'modo', v_modo, 'manual', true);
end $$;

revoke all on function mayara.criar_proposta_manual(text, text, text, text, jsonb, text) from public, anon, authenticated;
revoke all on function mayara.preparar_abordagem(text, text) from public, anon, authenticated;
```

- [ ] **Step 4: Aplicar (`apply_migration`, nome `mayara_abordar`) e rodar o teste**

Expected: `OK 0037`. Se a atribuição múltipla do `select ... into` na rota por telefone falhar, reescrever como dois `select` separados (não mudar o contrato). Se uma frase de `like` divergir por acento, alinhar a função e o teste entre si.

- [ ] **Step 5: Regressão**

Run: `0033`, `0034`, `0035`, `0036` via `execute_sql`.
Expected: `OK 0033`, `OK 0034`, `OK 0035`, `OK 0036`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0037_mayara_abordar.sql supabase/tests/0037_abordar.test.sql
git commit -m "feat(abordar): preparar_abordagem e criar_proposta_manual (migration 0037)"
```

---

### Task 2: Biblioteca de redação: modo "retomada"

**Files:**
- Modify: `docs/superpowers/specs/2026-10-09-abordagem-assistida/redigir.mjs`, `gerar-redigir-node.mjs`
- Test: `docs/superpowers/specs/2026-10-09-abordagem-assistida/redigir.test.mjs`
- Regenerate: `redigir.node.js`

**Interfaces:**
- Consumes: Fase 2 (`cartaoParaFatos`, `escolherLacuna`, `montarRascunhoModelo`, `validarRascunho`, `resolverRascunho`).
- Produces: `resolverRascunho(lead, textoIA, agora, modo)` com `modo` opcional (`'retomada'`); `montarRascunhoModelo` reconhece `lacuna.codigo === 'retomada'`; o corpo do node lê `entrada.modo`.

- [ ] **Step 1: Escrever os testes (devem falhar)**

```js
// acrescentar a redigir.test.mjs
test('retomada: reproduz o texto de retomada aprovado para a Cristina quando o perfil e empresa', () => {
  const r = resolverRascunho({ nome: 'Cristina', ondeDivida: 'Pessoa Jurídica (CNPJ)', telefone: '+5566996833126' }, '', new Date('2026-10-10T11:09:00Z'), 'retomada');
  assert.equal(r.texto, 'Bom dia, Cristina. Tudo bem? Aqui é a Mayara, do Camparim Advogados.\n\n'
    + 'Estou retomando sua solicitação sobre as dívidas bancárias da empresa. Essa situação ainda está em aberto por aí?');
  assert.equal(r.lacuna.codigo, 'retomada');
  assert.equal(r.fonte, 'modelo');
  assert.equal(validarRascunho(r.texto, r.fatos).valido, true);
});

test('retomada sem perfil conhecido usa o motivo neutro', () => {
  const r = resolverRascunho({ nome: 'Igor', telefone: '+5511999990922' }, '', new Date('2026-10-10T18:00:00Z'), 'retomada');
  assert.equal(r.texto, 'Boa tarde, Igor. Tudo bem? Aqui é a Mayara, do Camparim Advogados.\n\n'
    + 'Estou retomando sua solicitação sobre as dívidas bancárias. Essa situação ainda está em aberto por aí?');
  assert.equal(validarRascunho(r.texto, r.fatos).valido, true);
});

test('retomada sem nome ainda gera texto valido, e o modo ausente mantem o primeiro contato', () => {
  const sem = resolverRascunho({ telefone: '+5511999990001' }, '', new Date('2026-10-10T18:00:00Z'), 'retomada');
  assert.match(sem.texto, /^Boa tarde\. Tudo bem\?/);
  assert.equal(validarRascunho(sem.texto, sem.fatos).valido, true);
  const normal = resolverRascunho(CARD, '', new Date('2026-10-10T18:00:00Z'));
  assert.equal(normal.lacuna.codigo, 'banco');
  assert.match(normal.texto, /Recebi sua solicitação/);
});

test('retomada: texto da IA invalido cai no modelo de retomada', () => {
  const r = resolverRascunho({ nome: 'Igor' }, 'Oi. Garantimos tudo.', new Date('2026-10-10T18:00:00Z'), 'retomada');
  assert.equal(r.fonte, 'modelo');
  assert.match(r.texto, /Estou retomando/);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test docs/superpowers/specs/2026-10-09-abordagem-assistida/redigir.test.mjs`
Expected: FAIL (o modo `retomada` é ignorado e o texto sai com "Recebi sua solicitação").

- [ ] **Step 3: Implementar**

Em `redigir.mjs`: (a) acrescentar em `PERGUNTAS` a chave `retomada: 'Essa situação ainda está em aberto por aí?',`; (b) **substituir** as definições de `motivoDoContato`, `montarRascunhoModelo` e `resolverRascunho` por:

```js
function motivoDoContato(fatos, neutro = false) {
  const f = fatos && typeof fatos === 'object' ? fatos : {};
  const empresa = f.documento === 'CNPJ' || /jur[ií]dica/i.test(String(f.perfil ?? ''));
  if (empresa) return 'sobre as dívidas bancárias da empresa';
  if (neutro && !f.documento && !f.perfil) return 'sobre as dívidas bancárias';
  return 'sobre as suas dívidas bancárias';
}

export function montarRascunhoModelo(fatos, lacuna, agora) {
  const codigo = lacuna && PERGUNTAS[lacuna.codigo] ? lacuna.codigo : 'outra';
  const nome = primeiroNome(fatos);
  const abertura = saudacao(agora) + (nome ? ', ' + nome : '') + '. Tudo bem? Aqui é a Mayara, do Camparim Advogados.\n\n';
  if (codigo === 'retomada') {
    return abertura + 'Estou retomando sua solicitação ' + motivoDoContato(fatos, true) + '. ' + PERGUNTAS.retomada;
  }
  return abertura + 'Recebi sua solicitação ' + motivoDoContato(fatos) + '. ' + PERGUNTAS[codigo];
}

export function resolverRascunho(lead, textoIA, agora, modo) {
  const fatos = cartaoParaFatos(lead);
  const lacuna = modo === 'retomada' ? { codigo: 'retomada', descricao: 'retomada de contato' } : escolherLacuna(fatos);
  const ia = typeof textoIA === 'string' ? textoIA.trim() : '';
  if (ia) {
    const v = validarRascunho(ia, fatos);
    if (v.valido) return { fatos, lacuna, texto: ia, fonte: 'ia', motivoRejeicao: null };
    return { fatos, lacuna, texto: montarRascunhoModelo(fatos, lacuna, agora), fonte: 'modelo', motivoRejeicao: v.motivo };
  }
  return { fatos, lacuna, texto: montarRascunhoModelo(fatos, lacuna, agora), fonte: 'modelo', motivoRejeicao: null };
}
```
(remover as definições antigas dessas três funções para não haver duplicata). Em `gerar-redigir-node.mjs`, trocar a última linha do corpo por `'return [{ json: resolverRascunho(entrada.lead, entrada.textoIA, new Date(), entrada.modo) }];'`.

- [ ] **Step 4: Rodar tudo e regenerar o corpo do node**

Run: `node docs/superpowers/specs/2026-10-09-abordagem-assistida/gerar-redigir-node.mjs && node --test docs/superpowers/specs/2026-10-09-abordagem-assistida/*.test.mjs`
Expected: `fail 0` (testes antigos de primeiro contato, o guarda do corpo do node e os 4 novos). O guarda do node usa `resolverRascunho(lead, '', TARDE)` sem modo: continua igual.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-10-09-abordagem-assistida/
git commit -m "feat(abordar): modo retomada na biblioteca de redacao"
```

---

### Task 3: Classificador da Central reconhece `abordar`

**Files:**
- Modify: `docs/superpowers/specs/2026-10-03-central-comando/central-comando.mjs`
- Test: `docs/superpowers/specs/2026-10-03-central-comando/central-propostas.test.mjs`

**Interfaces:**
- Produces: `classificarMensagem` devolve `{ tipo: 'abordar', acao: 'abordar', alvo: string }` para `/abordar <alvo>` (telefone ou nome) e para `abordar <telefone>` sem barra; para `/abordar` sem alvo devolve `{ tipo: 'texto', acao: 'abordar_invalido', resposta }`.

- [ ] **Step 1: Escrever o teste (deve falhar)**

```js
// acrescentar a central-propostas.test.mjs
test('abordar: com barra aceita telefone ou nome; sem barra so com telefone', () => {
  assert.deepEqual(classificarMensagem('/abordar +5566996833126', livre), { tipo: 'abordar', acao: 'abordar', alvo: '+5566996833126' });
  assert.deepEqual(classificarMensagem('/abordar Carla Ramos', livre), { tipo: 'abordar', acao: 'abordar', alvo: 'Carla Ramos' });
  assert.deepEqual(classificarMensagem('abordar +55 (66) 99683-3126', livre), { tipo: 'abordar', acao: 'abordar', alvo: '+55 (66) 99683-3126' });
  assert.deepEqual(classificarMensagem('Abordar 66996833126', livre), { tipo: 'abordar', acao: 'abordar', alvo: '66996833126' });
  assert.deepEqual(classificarMensagem('/ABORDAR  Carla', livre), { tipo: 'abordar', acao: 'abordar', alvo: 'Carla' });
});

test('abordar sem alvo explica o uso', () => {
  const r = classificarMensagem('/abordar', livre);
  assert.equal(r.tipo, 'texto');
  assert.equal(r.acao, 'abordar_invalido');
  assert.match(r.resposta, /\/abordar \+5514999990000/);
});

test('frases de ensino que comecam com abordar continuam sendo ensino', () => {
  assert.equal(classificarMensagem('Abordar o lead com mais empatia', livre).tipo, 'livre');
  assert.equal(classificarMensagem('abordar sempre pelo primeiro nome', livre).tipo, 'livre');
  assert.equal(classificarMensagem('abordar', livre).tipo, 'livre');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test docs/superpowers/specs/2026-10-03-central-comando/central-propostas.test.mjs`
Expected: FAIL (`/abordar` hoje cai em "comando desconhecido").

- [ ] **Step 3: Implementar**

Em `central-comando.mjs`: (a) acrescentar `'abordar'` à lista `COMANDOS`; (b) no `switch` de `comando(cmd, args)`, antes do `default`, acrescentar:

```js
    case 'abordar':
      if (!args) return { tipo: 'texto', acao: 'abordar_invalido', resposta: 'Diga quem abordar. Exemplo: /abordar +5514999990000 ou /abordar Maria Silva.' };
      return { tipo: 'abordar', acao: 'abordar', alvo: args };
```
(c) em `classificarMensagem`, logo depois do bloco `if (/^propostas?$/.test(base)) ...`, acrescentar (só telefone, sem barra):

```js
  const abordarTel = t.match(/^abordar\s+(\+?[\d\s().-]{10,})$/i);
  if (abordarTel) return { tipo: 'abordar', acao: 'abordar', alvo: abordarTel[1].trim() };
```
e na `AJUDA`, acrescentar a linha `'/abordar +5514999990000 ou /abordar Nome: a Mayara prepara um primeiro contato para você aprovar',`.

- [ ] **Step 4: Rodar e ver passar (toda a pasta da Central)**

Run: `node --test docs/superpowers/specs/2026-10-03-central-comando/*.test.mjs`
Expected: `fail 0`. Se o teste existente que compara a `AJUDA` quebrar, atualizar o texto esperado (a ajuda ganhou uma linha).

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-10-03-central-comando/
git commit -m "feat(abordar): Central reconhece /abordar"
```

---

### Task 4: Workflow `Propor` com modo e criação manual; `Notificar` com título neutro

**Files:**
- Modify: `docs/superpowers/specs/2026-10-09-abordagem-assistida/gerar-workflows.mjs`, `gerar-workflows.test.mjs`
- Regenerate: `docs/superpowers/specs/workflows/mayara-abordagem-propor.json`, `mayara-abordagem-notificar.json`

**Interfaces:**
- Consumes: `redigir.node.js` regenerado (Task 2); `criar_proposta_manual` (Task 1).
- Produces: `Propor` aceita `{ lead, crmLeadId, modo?, manual? }`; com `manual: true` usa `criar_proposta_manual`; o título da notificação passa a ser "Proposta de abordagem:".

- [ ] **Step 1: Escrever os testes (devem falhar)**

```js
// acrescentar a gerar-workflows.test.mjs
test('Propor: repassa modo e manual e escolhe a funcao de criacao conforme manual', () => {
  const wf = montarPropor();
  const prep = wf.nodes.find((n) => n.name === 'Preparar Entrada').parameters.jsCode;
  const saida = new Function('$', prep)((nome) => ({ first: () => ({ json: { lead: { nome: 'Ana' }, crmLeadId: 'c1', modo: 'retomada', manual: true } }) }));
  assert.deepEqual(saida[0].json, { lead: { nome: 'Ana' }, crmLeadId: 'c1', modo: 'retomada', manual: true });
  const vazio = new Function('$', prep)(() => ({ first: () => ({ json: { lead: { nome: 'Ana' } } }) }));
  assert.deepEqual(vazio[0].json, { lead: { nome: 'Ana' }, crmLeadId: '', modo: '', manual: false });
  const criar = wf.nodes.find((n) => n.name === 'Criar Proposta');
  assert.match(criar.parameters.query, /criar_proposta_manual/);
  assert.match(criar.parameters.query, /mayara\.criar_proposta\(/);
  assert.match(criar.parameters.options.queryReplacement, /manual === true/);
  assert.match(wf.nodes.find((n) => n.name === 'Redigir').parameters.jsCode, /entrada\.modo/);
});

test('Notificar: o titulo da mensagem e neutro (serve para abordagem manual)', () => {
  const montar = montarNotificar().nodes.find((n) => n.name === 'Montar Mensagem').parameters.jsCode;
  const itens = [{ json: { id: 5, tipo: 'nova', nome: 'Igor', texto: 'Bom dia.', telefone_fim: '0922', admin: '+5514997022609' } }];
  const saida = new Function('$input', montar)({ all: () => itens });
  assert.match(saida[0].json.texto, /^Proposta de abordagem: Igor \(final 0922\)\./);
});
```
Também **atualizar** o teste existente "a mensagem da proposta traz o texto exato" trocando `/Novo lead: Cristina \(final 3126\)/` por `/Proposta de abordagem: Cristina \(final 3126\)/`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test docs/superpowers/specs/2026-10-09-abordagem-assistida/gerar-workflows.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implementar em `gerar-workflows.mjs`**

- `Preparar Entrada` (jsCode): `const e = $('Execute Workflow Trigger').first().json;\nreturn [{ json: { lead: e.lead || {}, crmLeadId: e.crmLeadId || '', modo: e.modo || '', manual: e.manual === true } }];`
- `Criar Proposta`: query `select case when $7::boolean then mayara.criar_proposta_manual($1, $2, $3, $4, $5::jsonb, $6) else mayara.criar_proposta($1, $2, $3, $4, $5::jsonb, $6) end as r`; no `queryReplacement`, acrescentar ao fim da lista `, ${entrada}.manual === true` (a lista passa a ter 7 itens).
- `MONTAR_MENSAGEM`: trocar `'Novo lead: '` por `'Proposta de abordagem: '`.

- [ ] **Step 4: Rodar, gerar os JSON e commitar**

Run: `node --test docs/superpowers/specs/2026-10-09-abordagem-assistida/*.test.mjs && node docs/superpowers/specs/2026-10-09-abordagem-assistida/gerar-workflows.mjs`
Expected: `fail 0` e `workflows gerados`.

```bash
git add docs/superpowers/specs/2026-10-09-abordagem-assistida/ docs/superpowers/specs/workflows/mayara-abordagem-propor.json docs/superpowers/specs/workflows/mayara-abordagem-notificar.json
git commit -m "feat(abordar): Propor com modo e criacao manual; notificacao com titulo neutro"
```

- [ ] **Step 5: Aplicar no n8n ao vivo**

Em `Propor` (`G7eWMOcC16UWuism`), `updateNode` (um por chamada, relendo entre tentativas): `Preparar Entrada` (`parameters.jsCode`); `Criar Proposta` (`parameters.query` e `parameters.options.queryReplacement`); `Redigir` (`parameters.jsCode`, conteúdo de `redigir.node.js` sem as linhas de comentário iniciais; se falhar 3 vezes, usar `patchNodeField` com as substituições das funções alteradas). Em `Notificar` (`kjQrAmfRpDWRRJvH`), `patchNodeField` de `Montar Mensagem`: trocar `Novo lead: ` por `Proposta de abordagem: `.
Expected: ao reler com a API (curl com a chave do n8n-mcp, sem imprimir a chave) os três nós de `Propor` contêm `manual`, `criar_proposta_manual` e `entrada.modo`, e `Notificar` contém `Proposta de abordagem:`. Reexportar os dois workflows para `docs/superpowers/specs/workflows/` e commitar (`chore(abordar): reexportar Propor e Notificar`).

---

### Task 5: Ramo `abordar` na Central (ao vivo)

**Files:**
- Create: `docs/superpowers/specs/2026-10-09-abordagem-assistida/gerar-central-abordar.mjs`
- Create (gerados): `central-abordar-patch.json`, `classificar-abordar.node.js`
- Modify: `docs/superpowers/specs/workflows/mayara-central-de-comando.json` (reexportação)

**Interfaces:**
- Consumes: Task 1 (`preparar_abordagem`), Task 3 (classificador), Task 4 (`Propor` com modo/manual).
- Produces: `Roteador` com 7 saídas (a nova, `abordar`, é a de índice 6) e os nós `Preparar Abordagem`, `Redigir?`, `Propor Manual`, `Resposta Abordagem`, `Resposta Preparo`.

- [ ] **Step 1: Escrever o gerador**

```js
// gerar-central-abordar.mjs: operacoes incrementais para o ramo "abordar" da Central ao vivo e o novo codigo do Classificar.
// Uso: node gerar-central-abordar.mjs
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { corpoNode, RODAPE_CLASSIFICAR } from '../2026-10-03-central-comando/gerar-node.mjs';

const dir = dirname(fileURLToPath(import.meta.url));
const PG = { postgres: { id: 'nNpCUIhnDuVvTApU', name: 'Postgres account' } };
const PROPOR = { __rl: true, value: 'G7eWMOcC16UWuism', mode: 'list', cachedResultName: 'Mayara — Abordagem: Propor [Sub-workflow]' };
const OPCOES_IF = { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 };
const nid = (n) => `ca000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const campo = (nome, tipo = 'string') => ({ id: nome, displayName: nome, required: false, defaultMatch: false, display: true, type: tipo, canBeUsedToMatch: true });
const regra = (valor) => ({
  conditions: { options: OPCOES_IF, conditions: [{ id: 'r-' + valor, leftValue: '={{ $json.tipo }}', rightValue: valor, operator: { type: 'string', operation: 'equals' } }], combinator: 'and' },
  renameOutput: true, outputKey: valor,
});

export const classificarJs = (() => {
  const s = corpoNode(RODAPE_CLASSIFICAR);
  const i = s.indexOf('const CONFLITOS = ['); const j = s.indexOf('const entrada = ');
  return s.slice(0, i) + s.slice(j);
})();

const RESPOSTA_ABORDAGEM = `const p = $('Preparar Abordagem').first().json.p;
const r = ($input.first().json || {}).r || {};
const nome = (p.lead && p.lead.nome) || 'o lead';
const fim = String((p.lead && p.lead.telefone) || '').replace(/\\D/g, '').slice(-4);
const motivos = {
  conversa_recente: 'esse lead escreveu nas últimas 48 horas, então a Mayara já pode responder sem abordagem',
  ja_abordado: 'já existe uma abordagem recente ou uma proposta aberta para esse lead',
  lead_sem_interesse: 'esse lead pediu para parar',
  lead_assumido: 'a equipe assumiu esse lead (use /devolver antes)',
  lead_inativo: 'esse lead não está ativo',
  telefone_invalido: 'o telefone desse lead é inválido',
};
const resposta = r.ok === true
  ? 'Criei a proposta #' + r.id + ' para ' + nome + ' (final ' + fim + '). Ela chega em instantes para você aprovar com *sim ' + r.id + '*.'
  : 'Não criei a proposta para ' + nome + ' (final ' + fim + '): ' + (motivos[r.motivo] || 'não consegui preparar agora') + '.';
return [{ json: { resposta } }];`;

const novosNos = [
  { id: nid(1), name: 'Preparar Abordagem', type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [1400, 1460], credentials: PG, onError: 'continueErrorOutput',
    parameters: { operation: 'executeQuery', query: 'select mayara.preparar_abordagem($1, $2) as p', options: { queryReplacement: '={{ [$json.alvo, $json.phone] }}' } } },
  { id: nid(2), name: 'Redigir?', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [1620, 1460],
    parameters: { conditions: { options: OPCOES_IF, conditions: [{ id: 'ab2', leftValue: "={{ $json.p.acao === 'redigir' }}", rightValue: true, operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' }, options: {} } },
  { id: nid(3), name: 'Propor Manual', type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.3, position: [1840, 1360], onError: 'continueRegularOutput', alwaysOutputData: true,
    parameters: { workflowId: PROPOR, options: { waitForSubWorkflow: true },
      workflowInputs: { mappingMode: 'defineBelow', matchingColumns: [], attemptToConvertTypes: false, convertFieldsToString: false,
        value: { lead: '={{ $json.p.lead }}', crmLeadId: '={{ $json.p.crmLeadId }}', modo: '={{ $json.p.modo }}', manual: '={{ true }}' },
        schema: [campo('lead', 'object'), campo('crmLeadId'), campo('modo'), campo('manual', 'boolean')] } } },
  { id: nid(4), name: 'Resposta Abordagem', type: 'n8n-nodes-base.code', typeVersion: 2, position: [2060, 1360], parameters: { jsCode: RESPOSTA_ABORDAGEM } },
  { id: nid(5), name: 'Resposta Preparo', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1840, 1560], parameters: { jsCode: 'return [{ json: { resposta: $json.p.resposta } }];' } },
];

const ligacoes = [
  ['Roteador', 'Preparar Abordagem', { sourceIndex: 6 }],
  ['Preparar Abordagem', 'Redigir?', { sourceIndex: 0 }],
  ['Preparar Abordagem', 'Falha', { sourceIndex: 1 }],
  ['Redigir?', 'Propor Manual', { branch: 'true' }],
  ['Redigir?', 'Resposta Preparo', { branch: 'false' }],
  ['Propor Manual', 'Resposta Abordagem', {}],
  ['Resposta Abordagem', 'Finalizar', {}],
  ['Resposta Preparo', 'Finalizar', {}],
];

export function operacoes() {
  const regras = ['sql', 'texto', 'modo', 'status', 'livre', 'proposta', 'abordar'].map(regra);
  return [
    { type: 'updateNode', nodeName: 'Roteador', updates: { 'parameters.rules.values': regras } },
    ...novosNos.map((node) => ({ type: 'addNode', node })),
    ...ligacoes.map(([source, target, extra]) => ({ type: 'addConnection', source, target, ...extra })),
  ];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(join(dir, 'classificar-abordar.node.js'), classificarJs);
  writeFileSync(join(dir, 'central-abordar-patch.json'), JSON.stringify(operacoes(), null, 2));
  console.log('classificar-abordar.node.js (' + classificarJs.length + ' caracteres) e central-abordar-patch.json (' + operacoes().length + ' operacoes)');
}
```

- [ ] **Step 2: Gerar e conferir**

Run: `node docs/superpowers/specs/2026-10-09-abordagem-assistida/gerar-central-abordar.mjs`
Expected: `... (14 operacoes)` e `classificar-abordar.node.js` contendo `tipo: 'abordar'`.

- [ ] **Step 3: Aplicar ao vivo, em chamadas pequenas**

Ordem: (1) uma **única** chamada com `updateNode` do `Roteador`, os 5 `addNode` e as 8 `addConnection` (os nós precisam entrar já conectados; é o mesmo padrão que funcionou na Central); (2) `updateNode` do `Classificar` com o conteúdo de `classificar-abordar.node.js` (repetir até aplicar, relendo antes de cada nova tentativa).
Expected: o `Roteador` com 7 saídas, a saída de índice 6 ligada a `Preparar Abordagem`, `Finalizar` com as novas entradas; `Classificar` contendo `tipo: 'abordar'` (conferir pela API com a chave do n8n-mcp, sem imprimi-la).

- [ ] **Step 4: Reexportar e commitar**

Reexportar a Central ao vivo para `docs/superpowers/specs/workflows/mayara-central-de-comando.json`.

```bash
git add docs/superpowers/specs/2026-10-09-abordagem-assistida/ docs/superpowers/specs/workflows/mayara-central-de-comando.json
git commit -m "feat(abordar): ramo abordar na Central de Comando"
```

---

### Task 6: Aceite e registro

**Files:**
- Modify: `docs/superpowers/specs/2026-10-09-abordagem-assistida-design.md`

- [ ] **Step 1: Casos que não enviam nada (com o usuário no WhatsApp)**

Pedir ao usuário que envie ao número do escritório, um de cada vez, e conferir o resultado no banco (`mayara.comandos_log`, `mayara.propostas_abordagem`):
1. `/abordar` → mensagem de uso.
2. `/abordar zzzzzz` → "Não achei lead com...".
3. `/abordar +5511999990000` (número que não está no CRM) → "Esse número não está no CRM nem na lista da Mayara".
4. `/abordar Cristina` (ou o telefone dela, que tem proposta enviada há menos de 7 dias) → recusa por `ja_abordado`, sem criar proposta.
5. `Abordar o lead com mais empatia` → continua sendo **ensino** (a Central responde com "Entendi: ... Confirma?"); o usuário responde `não` para descartar.
Expected: nenhuma proposta nova nos casos 1 a 5.

- [ ] **Step 2: Caso feliz, sem envio ao lead**

Escolher com o usuário um lead real ainda não abordado (por exemplo a Carla Ramos): `/abordar Carla Ramos` → resposta "Criei a proposta #N...", a notificação com o texto chega em 1 a 2 minutos; o usuário confere o texto e responde `não N` (ou `editar N: ...` e `sim N` apenas se quiser realmente enviar).
Expected: proposta criada com `modo` coerente (primeiro contato se o lead nunca foi contatado; retomada nos demais), notificação recebida uma única vez, `não N` descarta sem enviar.

- [ ] **Step 3: Registrar na especificação e commitar**

Em `2026-10-09-abordagem-assistida-design.md`, na seção "Fases", acrescentar a linha `Comando /abordar concluído em <data> (preparar_abordagem, criar_proposta_manual, modo retomada, ramo abordar na Central)`.

```bash
git add docs/superpowers/specs/2026-10-09-abordagem-assistida-design.md
git commit -m "docs(abordar): comando abordar concluido"
```
