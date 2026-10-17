# Liberação Automática de Atendimento para Leads Novos: Plano de Execução

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lead novo que entra pelo grupo da agência recebe o primeiro contato da Mayara sozinho, sem esperar o `sim N` do administrador, dentro de limites seguros, e cai de volta na aprovação manual sempre que uma condição falhar.

**Architecture:** O fluxo atual já cria o lead no CRM e abre uma proposta de abordagem (`Lead do Grupo da Agência` → `Abordagem: Propor` → `mayara.criar_proposta`). Este projeto não muda essa parte. Acrescenta uma chave (`abordagem_automatica`, desligada), uma função de banco que escolhe a próxima proposta aberta, reconfere as condições e a aprova com o autor `automatico`, e um worker agendado que envia pelo `Canal: Enviar` e registra o resultado. A notificação ao administrador ganha uma carência: com a automática ligada, só avisa as propostas que não saíram sozinhas.

**Tech Stack:** Postgres/plpgsql (Supabase), n8n 2.x, Node.js (`node:test`), Evolution API.

**Spec:** não há spec própria (mudança pequena e limitada). O desenho está aprovado na conversa de 17/10/2026 e resumido em "Decisões" abaixo. Base existente: `docs/superpowers/specs/2026-10-10-abordagem-assistida/` (proposta, aprovação, envio) e `docs/superpowers/specs/2026-10-14-blindagem-canal/` (padrão de workflow agendado, teste de estrutura e exportação).

## Decisões (aprovadas pelo usuário)

- Projeto **separado** da reativação em massa; pode ir antes dela.
- Chave `abordagem_automatica`, **nasce desligada**. Só liga por pedido explícito do administrador, depois do piloto.
- Só vale para propostas do tipo `abordagem` (leads novos). A reativação em massa continua com aprovação mensagem a mensagem.
- Se alguma condição falhar, a proposta fica aberta e o administrador aprova à mão, como hoje.
- Depende do Google Calendar reconectado e de um agendamento real testado antes de ligar (causa da falha de 16/10: credencial `Google Calendar account` expirada).

## Global Constraints

- **Aprovação por fase:** o plano é aprovado antes de executar. Ao concluir, atualizar `docs/handoffs/claude-status.md` (objetivo, arquivos alterados, testes, resultado, pendências, riscos) **sem nomes, telefones, e-mails ou textos de clientes**.
- **Migrations** a partir de `0059` (a reativação em massa reserva `0056` a `0058`; se a numeração real já avançou, usar o próximo número livre e ajustar os nomes dos testes). Testes SQL em `supabase/tests/NNNN_*.test.sql`, dentro de `begin; ... rollback;`, terminando com `select 'OK NNNN';`. Funções com `set search_path = ''` e `revoke all ... from public, anon, authenticated`. A ferramenta SQL recusa `delete`, `drop` e `update` sem `where`.
- **Dados sintéticos nos testes** (`+551199999xxxx`, nomes `Auto ...`). Nada de dado real em arquivo versionado.
- **Identidade de lead** é `mayara.chave_telefone(...)`, nunca o número cru. Sessão canônica via `mayara.sessao_do_lead`.
- **n8n:** n8n-mcp é instável (a resposta "Connection closed" pode ter aplicado a mudança): reler por GET antes de repetir. Alteração em workflow vivo: GET, patch gerado e testado, PUT de `{name,nodes,connections,settings}`, GET para conferir, exportar para `docs/superpowers/specs/workflows/`. Chave da API do n8n fica em `~/.claude.json`, lida dentro de scripts, nunca impressa. Escrita em credenciais do n8n é bloqueada pelo ambiente: não contornar; é ação do usuário.
- **Não alterar** `aprovar_proposta`, `criar_proposta` nem `confirmar_envio_proposta`: a reativação em massa as substitui na migration dela, e este plano só as chama.
- **Commits** terminam com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Nunca enviar fora das condições:** fora do horário de atendimento, canal fechado, lead que não está `ativo`, administrador, ou lead que escreveu nas últimas 48 h não recebem a abordagem automática, e a proposta fica aberta ou é descartada com o motivo registrado.
2. **Concorrência:** duas execuções do worker ao mesmo tempo nunca aprovam a mesma proposta nem passam do teto por hora (`for update skip locked`).
3. **Aprovação manual e automática ao mesmo tempo:** se o administrador responder `sim N` no mesmo instante, só uma das duas aprova (a outra recebe `ja_aprovada`) e o lead recebe uma única mensagem.
4. **Falhas em série:** três falhas de envio seguidas desligam a chave sozinha e avisam o administrador; uma falha isolada não desliga.
5. **Notificação sem ruído:** com a automática ligada, o administrador não recebe "nova proposta" de quem acabou de sair sozinho; recebe o aviso só das que passaram da carência de 30 minutos.
6. **Agenda quebrada:** se o agendamento falhar (credencial expirada), o administrador é avisado e a conversa segue para atendimento humano, sem o lead ficar esperando sem resposta.

## File Structure

- Create: `supabase/migrations/0059_mayara_abordagem_automatica.sql`, `0060_mayara_abordagem_automatica_notificacao.sql`
- Create: `supabase/tests/0059_abordagem_automatica.test.sql`, `0060_abordagem_automatica_notificacao.test.sql`
- Create: `docs/superpowers/specs/2026-10-17-abordagem-automatica/gerar-workflow.mjs`, `gerar-workflow.test.mjs`
- Create (export do workflow vivo): `docs/superpowers/specs/workflows/mayara-abordagem-liberar-automatica.json`
- Modify: `docs/superpowers/specs/workflows/mayara-central-de-comando.json` (só se o comando `/abordagem automatica` for adotado na Task 5)
- Modify: `docs/handoffs/claude-status.md`

## Visão das tarefas

| Tarefa | Entrega | Quem |
|---|---|---|
| 1. Agenda e alerta | Credencial reconectada, alerta de falha de agendamento conferido | Usuário + eu (leitura) |
| 2. Banco: seleção, aprovação e registro | Migration 0059 e teste | Eu |
| 3. Banco: notificação com carência | Migration 0060 e teste | Eu |
| 4. Worker n8n | Workflow `Abordagem: Liberar Automática`, ativo e com a chave desligada | Eu |
| 5. Comando e resumo | `/abordagem automatica ligar\|desligar\|status`, linha no resumo diário | Eu |
| 6. Piloto controlado | Chave ligada com teto baixo, três leads acompanhados | Eu + usuário |

---

### Task 1: Agenda reconectada e alerta de falha de agendamento

**Files:**
- Modify (somente se o diagnóstico mostrar falha): `docs/superpowers/specs/workflows/` (export do workflow `Avisar Falha de Agendamento`, id `2Z3f0Ka1aOsuRwr8`)

**Interfaces:**
- Consumes: workflows `Agendar Consulta [Tool Atomico]` (`ULH07B68qq0pvghd`), `Avisar Falha de Agendamento [Sub-workflow]` (`2Z3f0Ka1aOsuRwr8`), `Lembretes de Consulta [Worker]` (`YlRXMT6gEopuwFof`).
- Produces: credencial `Google Calendar account` válida e a certeza de que a falha de agendamento chega ao administrador.

- [ ] **Step 1: Usuário reconecta a credencial**

No n8n: Credentials → `Google Calendar account` → Reconnect. Informar se o app OAuth do Google está em "Teste" ou "Produção" (em "Teste" a autorização expira a cada 7 dias e volta a falhar; a correção é publicar o app em "Produção" no Google Cloud Console).

- [ ] **Step 2: Provar que a leitura da agenda voltou (somente leitura)**

Run: criar um workflow temporário com `scheduleTrigger` de 1 minuto que roda só o nó `Buscar Eventos do Dia` (Google Calendar, operação de listar) para a data de hoje, ler o resultado da execução e apagar o temporário.
Expected: execução `success` com a lista de eventos (pode ser vazia). Se continuar `needs to be reconnected`, repetir o Step 1.

- [ ] **Step 3: Conferir se a falha de 16/10 gerou alerta ao administrador**

Run: `n8n_executions action=get id=105575 mode=summary` (execução de `Avisar Falha de Agendamento` às 18:43:15Z) e ler quais nós rodaram e se houve envio ao WhatsApp de administrador (consulta em `mayara.envios_log` por `origem` e horário 18:43 a 18:44Z de 16/10).
Expected: um envio de alerta registrado em `envios_log` nesse intervalo. Se **não** houver, o alerta não funciona para esse tipo de erro: ler o workflow, escrever o ajuste mínimo, registrar `Ruling`, aplicar por PUT, reler e exportar.

- [ ] **Step 4: Provar o agendamento de ponta a ponta (com o usuário)**

O usuário agenda uma consulta de teste pelo WhatsApp com um número dele; conferir o evento criado na agenda e o registro no CRM; apagar o evento de teste.
Expected: evento criado, sem erro. Só depois desta prova as tarefas seguintes podem ligar a chave.

- [ ] **Step 5: Commit (somente se houve ajuste de workflow)**

```bash
git add docs/superpowers/specs/workflows/
git commit -m "fix(agenda): alerta de falha de agendamento chega ao administrador"
```

---

### Task 2: Banco: escolher, aprovar e registrar o envio automático

**Files:**
- Create: `supabase/migrations/0059_mayara_abordagem_automatica.sql`
- Test: `supabase/tests/0059_abordagem_automatica.test.sql`

**Interfaces:**
- Consumes: `mayara.propostas_abordagem(id, telefone, telefone_chave, nome, crm_lead_id, texto, estado, criado_em, erro, encerrada_em, aprovada_por)`; `mayara.aprovar_proposta(p_id bigint, p_autor text) returns jsonb` (`{ok, destino, texto, nome, crm_lead_id}` ou `{ok:false, motivo}`); `mayara.finalizar_envio_proposta(p_id, p_ok, p_erro) returns text`; `mayara.resposta_permitida(p_agora)`; `mayara.canal_estado`; `mayara.administradores`; `mayara.leads_autorizados`; `mayara.session_state`; `mayara.envios_log(origem, ok, criado_em)`; `mayara.config`.
- Produces: chaves `abordagem_automatica` (`false`), `abordagem_auto_teto_hora` (`10`); funções `mayara.abordagem_auto_proximo(p_agora timestamptz) returns jsonb`, `mayara.abordagem_auto_registrar(p_proposta_id bigint, p_ok boolean, p_erro text) returns jsonb`, `mayara.abordagem_auto_resumo(p_horas int) returns jsonb`.

Regras:
- `abordagem_auto_proximo` devolve `{enviar:false, motivo}` com `motivo` em `desligada`, `assistida_desligada`, `canal_fechado`, `fora_do_expediente`, `teto_hora` ou `fila_vazia`; ou `{enviar:true, proposta_id, destino, texto, nome, crm_lead_id}` quando aprovou uma proposta.
- Considera apenas `estado = 'aberta'` e `tipo = 'abordagem'`, a mais antiga primeiro, com `for update skip locked`.
- Reconfere: telefone de administrador, conversa do lead nas últimas 48 h e lead não `ativo` descartam a proposta (`estado = 'descartada'`, `erro` com o motivo) e a função devolve `{enviar:false, motivo:'descartada', proposta_id}`; o worker simplesmente roda de novo.
- A aprovação é `mayara.aprovar_proposta(id, 'automatico')`. Se ela devolver `ok = false`, a função devolve `{enviar:false, motivo:<motivo>}` sem enviar.
- `abordagem_auto_registrar`: chama `finalizar_envio_proposta`; com falha, conta falhas consecutivas das propostas aprovadas por `automatico` e, na terceira seguida, põe `abordagem_automatica = 'false'` e devolve `pausada = true`.
- O teto por hora conta `envios_log` com `origem = 'abordagem_automatica'` e `ok` na última hora.

- [ ] **Step 1: Conferir que `propostas_abordagem` tem a coluna `tipo` esperada (ou não)**

Run (`execute_sql`): `select column_name from information_schema.columns where table_schema='mayara' and table_name='propostas_abordagem' order by ordinal_position;`
Expected: se existir `tipo` (a reativação em massa já foi aplicada), usar o filtro `p.tipo = 'abordagem'` do bloco abaixo; se **não** existir, remover as duas linhas marcadas `-- so_com_tipo` (todas as propostas atuais são de abordagem) e registrar `Ruling`.

- [ ] **Step 2: Escrever o teste SQL (deve falhar)**

```sql
-- supabase/tests/0059_abordagem_automatica.test.sql
begin;
do $t$
declare
  j jsonb; n int; pid bigint;
  segunda timestamptz := timestamptz '2026-10-19 13:00:00+00';   -- segunda 10:00 em Sao Paulo
  domingo timestamptz := timestamptz '2026-10-18 13:00:00+00';
begin
  update mayara.canal_estado set estado = 'open' where canal_id = 'escritorio';
  update mayara.config set valor = 'true' where chave = 'abordagem_assistida';
  update mayara.config set valor = 'false' where chave = 'abordagem_automatica';
  update mayara.config set valor = '2' where chave = 'abordagem_auto_teto_hora';

  -- tres leads novos com proposta aberta
  perform mayara.criar_proposta('+5511999990801', 'Auto Um',   't-801', 'Boa tarde, Auto. Tudo bem? Aqui é a Mayara. Qual o banco?', '{}'::jsonb, 'banco');
  perform mayara.criar_proposta('+5511999990802', 'Auto Dois', 't-802', 'Boa tarde, Auto. Tudo bem? Aqui é a Mayara. Qual o banco?', '{}'::jsonb, 'banco');
  perform mayara.criar_proposta('+5511999990803', 'Auto Tres', 't-803', 'Boa tarde, Auto. Tudo bem? Aqui é a Mayara. Qual o banco?', '{}'::jsonb, 'banco');
  update mayara.propostas_abordagem set criado_em = now() - interval '3 hours' where telefone = '+5511999990801';
  update mayara.propostas_abordagem set criado_em = now() - interval '2 hours' where telefone = '+5511999990802';
  update mayara.propostas_abordagem set criado_em = now() - interval '1 hours' where telefone = '+5511999990803';

  -- chave desligada: nada acontece
  j := mayara.abordagem_auto_proximo(segunda);
  assert j ->> 'motivo' = 'desligada' and (j ->> 'enviar') = 'false', 'desligada: ' || j::text;
  assert (select count(*) from mayara.propostas_abordagem where estado = 'aberta' and telefone like '+55119999908%') = 3, 'nada aprovado com a chave desligada';

  update mayara.config set valor = 'true' where chave = 'abordagem_automatica';

  -- gates
  update mayara.canal_estado set estado = 'close' where canal_id = 'escritorio';
  assert (mayara.abordagem_auto_proximo(segunda) ->> 'motivo') = 'canal_fechado', 'canal fechado';
  update mayara.canal_estado set estado = 'open' where canal_id = 'escritorio';
  assert (mayara.abordagem_auto_proximo(domingo) ->> 'motivo') = 'fora_do_expediente', 'domingo';
  assert (mayara.abordagem_auto_proximo(timestamptz '2026-10-19 08:00:00+00') ->> 'motivo') = 'fora_do_expediente', '05:00 em Sao Paulo';
  update mayara.config set valor = 'false' where chave = 'abordagem_assistida';
  assert (mayara.abordagem_auto_proximo(segunda) ->> 'motivo') = 'assistida_desligada', 'assistida desligada';
  update mayara.config set valor = 'true' where chave = 'abordagem_assistida';
  assert (select count(*) from mayara.propostas_abordagem where estado = 'aberta' and telefone like '+55119999908%') = 3, 'gates nao aprovam nada';

  -- primeiro envio: a proposta mais antiga, aprovada pelo autor automatico, janela aberta
  j := mayara.abordagem_auto_proximo(segunda);
  assert (j ->> 'enviar') = 'true' and j ->> 'destino' = '+5511999990801' and j ->> 'nome' = 'Auto Um', 'mais antiga primeiro: ' || j::text;
  pid := (j ->> 'proposta_id')::bigint;
  assert (select estado from mayara.propostas_abordagem where id = pid) = 'aprovada', 'aprovada';
  assert (select aprovada_por from mayara.propostas_abordagem where id = pid) = 'automatico', 'autor automatico';
  assert (select abordagem_ate from mayara.leads_autorizados where telefone = '+5511999990801') is not null, 'janela aberta';

  -- registrar ok: proposta enviada
  j := mayara.abordagem_auto_registrar(pid, true, null);
  assert (j ->> 'pausada') = 'false', 'registrar ok: ' || j::text;
  assert (select estado from mayara.propostas_abordagem where id = pid) = 'enviada', 'proposta enviada';
  insert into mayara.envios_log (canal_id, destino_chave, tipo, ok, provedor_message_id, origem, criado_em)
    values ('escritorio', mayara.chave_telefone('+5511999990801'), 'texto', true, 'AUTO1', 'abordagem_automatica', now());

  -- lead com conversa recente e administrador sao descartados, o proximo sai
  insert into mayara.session_state (session_key, phone, estado, last_lead_message_at)
    values ('whatsapp:escritorio:+5511999990802', '+5511999990802', 'S2_QUALIFICACAO', now() - interval '1 hour');
  j := mayara.abordagem_auto_proximo(segunda);
  assert j ->> 'motivo' = 'descartada', 'conversa recente descarta: ' || j::text;
  assert (select erro from mayara.propostas_abordagem where telefone = '+5511999990802') = 'conversa_recente', 'motivo gravado';
  j := mayara.abordagem_auto_proximo(segunda);
  assert (j ->> 'enviar') = 'true' and j ->> 'destino' = '+5511999990803', 'proximo apos descarte: ' || j::text;
  insert into mayara.envios_log (canal_id, destino_chave, tipo, ok, provedor_message_id, origem, criado_em)
    values ('escritorio', mayara.chave_telefone('+5511999990803'), 'texto', true, 'AUTO2', 'abordagem_automatica', now());

  -- teto por hora (2)
  perform mayara.criar_proposta('+5511999990804', 'Auto Quatro', 't-804', 'Boa tarde, Auto. Tudo bem? Aqui é a Mayara. Qual o banco?', '{}'::jsonb, 'banco');
  assert (mayara.abordagem_auto_proximo(segunda) ->> 'motivo') = 'teto_hora', 'teto por hora';
  assert (select estado from mayara.propostas_abordagem where telefone = '+5511999990804') = 'aberta', 'fica aberta para o administrador';
  update mayara.config set valor = '10' where chave = 'abordagem_auto_teto_hora';

  -- administrador nunca recebe automatico
  insert into mayara.administradores (telefone, telefone_chave, nome) values ('+5511999990804', mayara.chave_telefone('+5511999990804'), 'Admin Auto');
  j := mayara.abordagem_auto_proximo(segunda);
  assert j ->> 'motivo' = 'descartada' and (select erro from mayara.propostas_abordagem where telefone = '+5511999990804') = 'administrador', 'administrador descartado: ' || j::text;
  assert (mayara.abordagem_auto_proximo(segunda) ->> 'motivo') = 'fila_vazia', 'fila vazia';

  -- aprovacao manual simultanea: o sim N ja aprovou, o automatico nao envia de novo
  perform mayara.criar_proposta('+5511999990805', 'Auto Cinco', 't-805', 'Boa tarde, Auto. Tudo bem? Aqui é a Mayara. Qual o banco?', '{}'::jsonb, 'banco');
  select id into pid from mayara.propostas_abordagem where telefone = '+5511999990805';
  perform mayara.aprovar_proposta(pid, 'manual');
  assert (mayara.abordagem_auto_proximo(segunda) ->> 'motivo') = 'fila_vazia', 'proposta ja aprovada nao e reenviada';

  -- tres falhas seguidas desligam a chave; falha isolada nao
  for n in 1..3 loop
    perform mayara.criar_proposta('+55119999908' || (10 + n), 'Falha ' || n, 't-81' || n, 'Boa tarde, Auto. Tudo bem? Aqui é a Mayara. Qual o banco?', '{}'::jsonb, 'banco');
    j := mayara.abordagem_auto_proximo(segunda);
    assert (j ->> 'enviar') = 'true', 'falha ' || n || ' liberada: ' || j::text;
    j := mayara.abordagem_auto_registrar((j ->> 'proposta_id')::bigint, false, 'erro 500');
    assert (j ->> 'pausada') = (n = 3)::text, 'pausa so na terceira: ' || j::text;
  end loop;
  assert (select valor from mayara.config where chave = 'abordagem_automatica') = 'false', 'tres falhas desligam';

  -- resumo
  j := mayara.abordagem_auto_resumo(24);
  assert (j ->> 'ligada') = 'false' and (j ->> 'enviadas')::int >= 2 and (j ->> 'falhas')::int >= 3, 'resumo: ' || j::text;

  assert not has_function_privilege('anon', 'mayara.abordagem_auto_proximo(timestamptz)', 'execute'), 'anon sem execute';
  assert (select valor from mayara.config where chave = 'abordagem_automatica') is not null, 'chave existe';
end $t$;
rollback;
select 'OK 0059';
```

- [ ] **Step 3: Rodar e ver falhar**

Run: o teste com `execute_sql` (projeto `wuhvlvsolewslkawazlq`).
Expected: ERRO `function mayara.abordagem_auto_proximo(timestamp with time zone) does not exist`.

- [ ] **Step 4: Escrever a migration**

```sql
-- supabase/migrations/0059_mayara_abordagem_automatica.sql
insert into mayara.config (chave, valor) values
  ('abordagem_automatica', 'false'),
  ('abordagem_auto_teto_hora', '10')
on conflict (chave) do nothing;

create or replace function mayara.abordagem_auto_proximo(p_agora timestamptz default now())
returns jsonb language plpgsql set search_path = '' as $$
declare
  p mayara.propostas_abordagem%rowtype;
  v_teto int := coalesce((select valor::int from mayara.config where chave = 'abordagem_auto_teto_hora'), 10);
  v_status text; v_motivo text; r jsonb;
begin
  if coalesce((select valor from mayara.config where chave = 'abordagem_automatica'), 'false') <> 'true' then
    return jsonb_build_object('enviar', false, 'motivo', 'desligada');
  end if;
  if coalesce((select valor from mayara.config where chave = 'abordagem_assistida'), 'false') <> 'true' then
    return jsonb_build_object('enviar', false, 'motivo', 'assistida_desligada');
  end if;
  if coalesce((select estado from mayara.canal_estado where canal_id = 'escritorio'), 'close') <> 'open' then
    return jsonb_build_object('enviar', false, 'motivo', 'canal_fechado');
  end if;
  if not mayara.resposta_permitida(p_agora) then
    return jsonb_build_object('enviar', false, 'motivo', 'fora_do_expediente');
  end if;
  if (select count(*) from mayara.envios_log e
       where e.origem = 'abordagem_automatica' and e.ok and e.criado_em > p_agora - interval '1 hour') >= v_teto then
    return jsonb_build_object('enviar', false, 'motivo', 'teto_hora');
  end if;

  select * into p
    from mayara.propostas_abordagem x
   where x.estado = 'aberta'
     and x.tipo = 'abordagem'          -- so_com_tipo
   order by x.criado_em, x.id
   limit 1
   for update skip locked;
  if not found then
    return jsonb_build_object('enviar', false, 'motivo', 'fila_vazia');
  end if;

  select la.status into v_status from mayara.leads_autorizados la where la.telefone_chave = p.telefone_chave;
  v_motivo := case
    when exists (select 1 from mayara.administradores a where a.telefone_chave = p.telefone_chave) then 'administrador'
    when v_status is not null and v_status <> 'ativo' then 'lead_inativo'
    when exists (select 1 from mayara.session_state s
                  where mayara.chave_telefone(s.phone) = p.telefone_chave
                    and s.last_lead_message_at > p_agora - interval '48 hours') then 'conversa_recente'
    else null
  end;
  if v_motivo is not null then
    update mayara.propostas_abordagem set estado = 'descartada', encerrada_em = p_agora, erro = v_motivo where id = p.id;
    return jsonb_build_object('enviar', false, 'motivo', 'descartada', 'proposta_id', p.id);
  end if;

  r := mayara.aprovar_proposta(p.id, 'automatico');
  if coalesce((r ->> 'ok')::boolean, false) is not true then
    return jsonb_build_object('enviar', false, 'motivo', coalesce(r ->> 'motivo', 'nao_aprovada'), 'proposta_id', p.id);
  end if;
  return jsonb_build_object('enviar', true, 'proposta_id', p.id, 'destino', r ->> 'destino', 'texto', r ->> 'texto',
                            'nome', r ->> 'nome', 'crm_lead_id', r ->> 'crm_lead_id');
end $$;

create or replace function mayara.abordagem_auto_registrar(p_proposta_id bigint, p_ok boolean, p_erro text)
returns jsonb language plpgsql set search_path = '' as $$
declare v_resposta text; v_ultimas text[]; v_pausada boolean := false;
begin
  v_resposta := mayara.finalizar_envio_proposta(p_proposta_id, p_ok, p_erro);
  if not p_ok then
    select array_agg(x.estado order by x.encerrada_em desc) into v_ultimas
      from (select estado, encerrada_em from mayara.propostas_abordagem
             where aprovada_por = 'automatico' and estado in ('enviada', 'falhou')
             order by encerrada_em desc nulls last limit 3) x;
    if coalesce(array_length(v_ultimas, 1), 0) = 3 and v_ultimas = array['falhou', 'falhou', 'falhou'] then
      update mayara.config set valor = 'false' where chave = 'abordagem_automatica';
      v_pausada := true;
    end if;
  end if;
  return jsonb_build_object('resposta', v_resposta, 'pausada', v_pausada);
end $$;

create or replace function mayara.abordagem_auto_resumo(p_horas int default 24)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'ligada', coalesce((select valor from mayara.config where chave = 'abordagem_automatica'), 'false') = 'true',
    'teto_hora', coalesce((select valor::int from mayara.config where chave = 'abordagem_auto_teto_hora'), 10),
    'enviadas', (select count(*) from mayara.propostas_abordagem p
                  where p.aprovada_por = 'automatico' and p.estado = 'enviada'
                    and p.encerrada_em > now() - make_interval(hours => greatest(p_horas, 1))),
    'falhas', (select count(*) from mayara.propostas_abordagem p
                where p.aprovada_por = 'automatico' and p.estado = 'falhou'
                  and p.encerrada_em > now() - make_interval(hours => greatest(p_horas, 1))),
    'descartadas', (select count(*) from mayara.propostas_abordagem p
                     where p.estado = 'descartada' and p.erro in ('administrador', 'lead_inativo', 'conversa_recente')
                       and p.encerrada_em > now() - make_interval(hours => greatest(p_horas, 1))),
    'abertas', (select count(*) from mayara.propostas_abordagem p where p.estado = 'aberta')
  )
$$;

revoke all on function mayara.abordagem_auto_proximo(timestamptz) from public, anon, authenticated;
revoke all on function mayara.abordagem_auto_registrar(bigint, boolean, text) from public, anon, authenticated;
revoke all on function mayara.abordagem_auto_resumo(int) from public, anon, authenticated;
```

Nota de implementação: o teste lê `aprovada_por = 'automatico'` como marca de quem aprovou, e o contador de três falhas depende de `finalizar_envio_proposta` → `confirmar_envio_proposta` gravar `encerrada_em` ao falhar (já grava). Se `aprovar_proposta` ainda não gravar `aprovada_por`, a coluna existe na tabela (usada pela versão viva); confirmar com a consulta do Step 1 e, se faltar, registrar `Ruling` e usar `erro`/`aprovada_em` equivalente.

- [ ] **Step 5: Aplicar (`apply_migration`, nome `mayara_abordagem_automatica`) e rodar o teste**

Expected: `OK 0059`. Divergência de horário (expediente real diferente do documentado) corrige-se no **teste**; as regras de teto, descarte e pausa nunca se relaxam.

- [ ] **Step 6: Regressão**

Run: os testes SQL `0033`, `0034`, `0035`, `0036` (propostas) e `0050` (retenção de abordagem).
Expected: todos `OK`; o comportamento da aprovação manual não muda.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0059_mayara_abordagem_automatica.sql supabase/tests/0059_abordagem_automatica.test.sql
git commit -m "feat(abordagem): liberacao automatica para leads novos no banco (migration 0059)"
```

---

### Task 3: Notificação com carência

**Files:**
- Create: `supabase/migrations/0060_mayara_abordagem_automatica_notificacao.sql`
- Test: `supabase/tests/0060_abordagem_automatica_notificacao.test.sql`

**Interfaces:**
- Consumes: `mayara.reservar_notificacoes(p_agora timestamptz) returns table(id bigint, tipo text, nome text, texto text, telefone_fim text)` (definição viva); chave `abordagem_automatica`.
- Produces: com a automática ligada, `reservar_notificacoes` só entrega "nova" para proposta aberta há mais de 30 minutos; com ela desligada, o comportamento é exatamente o atual.

- [ ] **Step 1: Conferir a definição viva**

Run (`execute_sql`): `select pg_get_functiondef('mayara.reservar_notificacoes(timestamptz)'::regprocedure);`
Expected: igual ao corpo da migration abaixo, **sem** o termo `carencia`. Divergência: incorporar a diferença e registrar `Ruling`.

- [ ] **Step 2: Escrever o teste SQL (deve falhar)**

```sql
-- supabase/tests/0060_abordagem_automatica_notificacao.test.sql
begin;
do $t$
declare n int; segunda timestamptz := timestamptz '2026-10-19 13:00:00+00';
begin
  perform mayara.criar_proposta('+5511999990901', 'Nota Um',   't-901', 'Boa tarde, Nota. Tudo bem? Aqui é a Mayara. Qual o banco?', '{}'::jsonb, 'banco');
  perform mayara.criar_proposta('+5511999990902', 'Nota Dois', 't-902', 'Boa tarde, Nota. Tudo bem? Aqui é a Mayara. Qual o banco?', '{}'::jsonb, 'banco');
  update mayara.propostas_abordagem set criado_em = segunda - interval '5 minutes'  where telefone = '+5511999990901';
  update mayara.propostas_abordagem set criado_em = segunda - interval '40 minutes' where telefone = '+5511999990902';

  -- automatica desligada: comportamento atual, as duas notificam
  update mayara.config set valor = 'false' where chave = 'abordagem_automatica';
  select count(*) into n from mayara.reservar_notificacoes(segunda) where tipo = 'nova' and telefone_fim in ('0901', '0902');
  assert n = 2, 'desligada notifica as duas: ' || n;

  -- volta ao estado inicial para o segundo cenario
  update mayara.propostas_abordagem set notificada_em = null, lembrete_em = null where telefone in ('+5511999990901', '+5511999990902');

  -- automatica ligada: so a proposta com mais de 30 minutos notifica
  update mayara.config set valor = 'true' where chave = 'abordagem_automatica';
  select count(*) into n from mayara.reservar_notificacoes(segunda) where tipo = 'nova' and telefone_fim = '0901';
  assert n = 0, 'recente nao notifica com a automatica ligada: ' || n;
  select count(*) into n from mayara.reservar_notificacoes(segunda) where tipo = 'nova' and telefone_fim = '0902';
  assert n = 1 or (select notificada_em from mayara.propostas_abordagem where telefone = '+5511999990902') is not null, 'antiga notifica';

  -- a recente passa a notificar quando completa 30 minutos
  select count(*) into n from mayara.reservar_notificacoes(segunda + interval '31 minutes') where tipo = 'nova' and telefone_fim = '0901';
  assert n = 1, 'depois da carencia notifica: ' || n;
end $t$;
rollback;
select 'OK 0060';
```

- [ ] **Step 3: Rodar e ver falhar**

Expected: FAIL em `recente nao notifica com a automatica ligada` (a função atual notifica as duas).

- [ ] **Step 4: Escrever a migration**

```sql
-- supabase/migrations/0060_mayara_abordagem_automatica_notificacao.sql
create or replace function mayara.reservar_notificacoes(p_agora timestamp with time zone default now())
returns table(id bigint, tipo text, nome text, texto text, telefone_fim text)
language plpgsql set search_path = '' as $$
declare
  v_hora int := extract(hour from (p_agora at time zone 'America/Sao_Paulo'))::int;
  v_ja int;
  v_auto boolean := coalesce((select valor from mayara.config where chave = 'abordagem_automatica'), 'false') = 'true';
  v_carencia interval := case when v_auto then interval '30 minutes' else interval '0 minutes' end;
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
       and p.criado_em <= p_agora - v_carencia
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

revoke all on function mayara.reservar_notificacoes(timestamptz) from public, anon, authenticated;
```

- [ ] **Step 5: Aplicar (`apply_migration`, nome `mayara_abordagem_automatica_notificacao`), rodar o teste e a regressão**

Run: o teste desta tarefa e depois `0034` e `0036` (notificações e lembretes).
Expected: `OK 0060`; os antigos continuam `OK` (com a chave desligada o comportamento é idêntico).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0060_mayara_abordagem_automatica_notificacao.sql supabase/tests/0060_abordagem_automatica_notificacao.test.sql
git commit -m "feat(abordagem): notificacao com carencia quando a liberacao automatica esta ligada (migration 0060)"
```

---

### Task 4: Worker n8n `Abordagem: Liberar Automática`

**Files:**
- Create: `docs/superpowers/specs/2026-10-17-abordagem-automatica/gerar-workflow.mjs`
- Test: `docs/superpowers/specs/2026-10-17-abordagem-automatica/gerar-workflow.test.mjs`
- Create (export): `docs/superpowers/specs/workflows/mayara-abordagem-liberar-automatica.json`

**Interfaces:**
- Consumes: funções da Task 2; sub-workflow `Canal: Enviar` (`SHLZkNqfbCrs2OSQ`) com os mesmos parâmetros do nó `Enviar Primeiro Contato` da Central (`canalId: 'escritorio'`, `tipo: 'texto'`, `identificarMayara: 'true'`, `origem`); `Alertar Escritório` (`FWSC1k1CBMWBtsNs`, entrada `texto`); credencial Postgres `nNpCUIhnDuVvTApU`; `errorWorkflow` `CQyjBKLX0UheNh1q`.
- Produces: `montarWorkflow()` (exportada) que devolve `{name, nodes, connections, settings}`; workflow vivo **ativo**, com a chave `abordagem_automatica` ainda **desligada** (nesse estado cada execução devolve `desligada` e não faz nada).

Fluxo dos nós: `Agendar (2 min)` → `Próximo` (Postgres: `select mayara.abordagem_auto_proximo(now()) as r`) → `Enviar?` (`r.enviar === true`) → `Enviar Primeiro Contato` (Canal: Enviar, `origem: 'abordagem_automatica'`, `waitForSubWorkflow: true`, `onError: continueRegularOutput`) → `Montar Resultado` (Code: `ok` e `erro` a partir da saída) → `Registrar` (Postgres: `select mayara.abordagem_auto_registrar($1::bigint, $2::boolean, $3) as r`) → `Pausada?` (`r.pausada === true`) → `Montar Alerta` → `Alertar Escritório`. Em `Próximo`, `executeOnce: true`.

- [ ] **Step 1: Escrever o teste de estrutura (deve falhar)**

```js
// docs/superpowers/specs/2026-10-17-abordagem-automatica/gerar-workflow.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { montarWorkflow } from './gerar-workflow.mjs';

const wf = montarWorkflow();
const porNome = (n) => wf.nodes.find((x) => x.name === n);

test('tem os nos esperados e um unico gatilho de agenda a cada 2 minutos', () => {
  for (const n of ['Agendar', 'Próximo', 'Enviar?', 'Enviar Primeiro Contato', 'Montar Resultado', 'Registrar', 'Pausada?', 'Montar Alerta', 'Alertar Escritório']) {
    assert.ok(porNome(n), 'falta o no ' + n);
  }
  const gatilhos = wf.nodes.filter((x) => x.type === 'n8n-nodes-base.scheduleTrigger');
  assert.equal(gatilhos.length, 1);
  assert.equal(gatilhos[0].parameters.rule.interval[0].minutesInterval, 2);
});

test('o envio usa a origem abordagem_automatica e identifica a Mayara', () => {
  const v = porNome('Enviar Primeiro Contato').parameters.workflowInputs.value;
  assert.equal(v.origem, 'abordagem_automatica');
  assert.equal(v.identificarMayara, 'true');
  assert.equal(v.canalId, 'escritorio');
  assert.equal(porNome('Enviar Primeiro Contato').onError, 'continueRegularOutput');
});

test('o no Próximo roda uma vez e chama a funcao do banco', () => {
  const n = porNome('Próximo');
  assert.equal(n.executeOnce, true);
  assert.match(n.parameters.query, /mayara\.abordagem_auto_proximo\(now\(\)\)/);
});

test('o resultado do envio vai para o registro e a pausa gera alerta', () => {
  assert.match(porNome('Registrar').parameters.query, /mayara\.abordagem_auto_registrar\(\$1::bigint, \$2::boolean, \$3\)/);
  assert.deepEqual(wf.connections['Enviar?'].main[0].map((c) => c.node), ['Enviar Primeiro Contato']);
  assert.deepEqual(wf.connections['Pausada?'].main[0].map((c) => c.node), ['Montar Alerta']);
  assert.deepEqual(wf.connections['Montar Alerta'].main[0].map((c) => c.node), ['Alertar Escritório']);
});

test('usa o workflow de erro padrao e nao tem credencial embutida alem do Postgres', () => {
  assert.equal(wf.settings.errorWorkflow, 'CQyjBKLX0UheNh1q');
  const comCredencial = wf.nodes.filter((x) => x.credentials).map((x) => Object.keys(x.credentials).join());
  assert.ok(comCredencial.every((c) => c === 'postgres'));
  assert.ok(!JSON.stringify(wf).match(/apikey|api_key|password|token/i));
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test docs/superpowers/specs/2026-10-17-abordagem-automatica/gerar-workflow.test.mjs`
Expected: FAIL `Cannot find module './gerar-workflow.mjs'`.

- [ ] **Step 3: Escrever o gerador**

```js
// docs/superpowers/specs/2026-10-17-abordagem-automatica/gerar-workflow.mjs
// Gera o workflow "Mayara — Abordagem: Liberar Automática [Worker]" no mesmo padrão dos workflows de blindagem do canal.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PG = { postgres: { id: 'nNpCUIhnDuVvTApU', name: 'Postgres account' } };
const ID = (n) => `ac000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const ifBool = (id, nome, expr, pos) => ({
  id: ID(id), name: nome, type: 'n8n-nodes-base.if', typeVersion: 2.2, position: pos,
  parameters: {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
      conditions: [{ id: ID(id) + '-c', leftValue: expr, rightValue: true, operator: { type: 'boolean', operation: 'true', singleValue: true } }],
      combinator: 'and',
    },
    options: {},
  },
});

const campo = (id) => ({ id, displayName: id, required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true });

export function montarWorkflow() {
  const nodes = [
    { id: ID(1), name: 'Agendar', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, position: [0, 300],
      parameters: { rule: { interval: [{ field: 'minutes', minutesInterval: 2 }] } } },
    { id: ID(2), name: 'Próximo', type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [220, 300], executeOnce: true,
      parameters: { operation: 'executeQuery', query: 'select mayara.abordagem_auto_proximo(now()) as r', options: {} }, credentials: PG },
    ifBool(3, 'Enviar?', '={{ $json.r.enviar === true }}', [440, 300]),
    { id: ID(4), name: 'Enviar Primeiro Contato', type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.3, position: [660, 200],
      onError: 'continueRegularOutput',
      parameters: {
        workflowId: { __rl: true, value: 'SHLZkNqfbCrs2OSQ', mode: 'list', cachedResultName: 'Mayara — Canal: Enviar [Sub-workflow]' },
        options: { waitForSubWorkflow: true },
        workflowInputs: {
          mappingMode: 'defineBelow', matchingColumns: [], attemptToConvertTypes: false, convertFieldsToString: true,
          value: {
            canalId: 'escritorio', para: '={{ $json.r.destino }}', tipo: 'texto', texto: '={{ $json.r.texto }}',
            templateNome: '', templateVariaveis: '', identificarMayara: 'true', origem: 'abordagem_automatica',
          },
          schema: ['canalId', 'para', 'tipo', 'texto', 'templateNome', 'templateVariaveis', 'identificarMayara', 'origem'].map(campo),
        },
      } },
    { id: ID(5), name: 'Montar Resultado', type: 'n8n-nodes-base.code', typeVersion: 2, position: [880, 200],
      parameters: { jsCode: [
        "const prox = $('Próximo').first().json.r;",
        'const saida = $input.first().json || {};',
        "const ok = saida.ok === true || saida.enviado === true || (!saida.error && !saida.erro && saida.ok !== false);",
        "const erro = ok ? '' : String(saida.error?.message || saida.erro || saida.error || 'falha_no_envio').slice(0, 200);",
        'return [{ json: { id: prox.proposta_id, ok, erro } }];',
      ].join('\n') } },
    { id: ID(6), name: 'Registrar', type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [1100, 200],
      parameters: { operation: 'executeQuery', query: 'select mayara.abordagem_auto_registrar($1::bigint, $2::boolean, $3) as r',
        options: { queryReplacement: '={{ [$json.id, $json.ok, $json.erro] }}' } }, credentials: PG },
    ifBool(7, 'Pausada?', '={{ $json.r.pausada === true }}', [1320, 200]),
    { id: ID(8), name: 'Montar Alerta', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1540, 120],
      parameters: { jsCode: "return [{ json: { texto: 'Atenção: a liberação automática de atendimento foi desligada depois de 3 falhas de envio seguidas. Confira o canal e ligue de novo com /abordagem automatica ligar.' } }];" } },
    { id: ID(9), name: 'Alertar Escritório', type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.3, position: [1760, 120],
      onError: 'continueRegularOutput',
      parameters: {
        workflowId: { __rl: true, value: 'FWSC1k1CBMWBtsNs', mode: 'list', cachedResultName: 'Mayara — Alertar Escritório [Sub-workflow]' },
        workflowInputs: { mappingMode: 'defineBelow', matchingColumns: [], attemptToConvertTypes: false, convertFieldsToString: true,
          value: { texto: '={{ $json.texto }}' }, schema: [campo('texto')] },
        options: { waitForSubWorkflow: false },
      } },
  ];
  const lig = (...para) => ({ main: [para.map((node) => ({ node, type: 'main', index: 0 }))] });
  const connections = {
    Agendar: lig('Próximo'),
    Próximo: lig('Enviar?'),
    'Enviar?': { main: [[{ node: 'Enviar Primeiro Contato', type: 'main', index: 0 }], []] },
    'Enviar Primeiro Contato': lig('Montar Resultado'),
    'Montar Resultado': lig('Registrar'),
    Registrar: lig('Pausada?'),
    'Pausada?': { main: [[{ node: 'Montar Alerta', type: 'main', index: 0 }], []] },
    'Montar Alerta': lig('Alertar Escritório'),
  };
  return {
    name: 'Mayara — Abordagem: Liberar Automática [Worker]',
    nodes, connections,
    settings: { executionOrder: 'v1', errorWorkflow: 'CQyjBKLX0UheNh1q' },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = dirname(fileURLToPath(import.meta.url));
  writeFileSync(join(dir, 'workflow.json'), JSON.stringify(montarWorkflow(), null, 2));
  console.log('workflow.json gerado');
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `node --test docs/superpowers/specs/2026-10-17-abordagem-automatica/gerar-workflow.test.mjs`
Expected: 5 testes passam.

- [ ] **Step 5: Conferir a saída real do `Canal: Enviar` antes de criar o workflow**

Run: ler as últimas execuções de `Canal: Enviar` (`SHLZkNqfbCrs2OSQ`) por `n8n_executions action=get mode=summary` e ver o formato da saída em caso de sucesso e de erro (campos `ok`/`erro`).
Expected: o nó `Montar Resultado` interpreta corretamente os dois casos. Se o formato real for diferente, ajustar o código do nó **e o teste** e registrar `Ruling`. Nunca assumir sucesso por falta de erro sem conferir.

- [ ] **Step 6: Criar o workflow vivo (inativo primeiro), validar e ativar**

Run: gerar `workflow.json`, criar o workflow por POST na API do n8n (chave lida de `~/.claude.json` dentro do script, sem imprimir), reler por GET e comparar nós e conexões com o gerado; só então ativar. Com a chave `abordagem_automatica = false`, ler 3 execuções consecutivas (6 minutos) e conferir que todas devolvem `desligada` e que nenhuma mensagem saiu (`envios_log` sem linhas `abordagem_automatica`).
Expected: execuções `success`, `r.motivo = 'desligada'`, nada enviado.

- [ ] **Step 7: Exportar e commitar**

```bash
git add docs/superpowers/specs/2026-10-17-abordagem-automatica/ docs/superpowers/specs/workflows/mayara-abordagem-liberar-automatica.json
git commit -m "feat(abordagem): worker n8n de liberacao automatica (chave desligada)"
```

---

### Task 5: Comando e resumo

**Files:**
- Modify: `docs/superpowers/specs/workflows/mayara-central-de-comando.json` (após alteração no workflow vivo `jNhj68Ee7i3w8dey`)
- Modify: `supabase/migrations/` (migration `0061_mayara_abordagem_automatica_comando.sql`) e `supabase/tests/0061_abordagem_automatica_comando.test.sql`

**Interfaces:**
- Consumes: `mayara.executar_central` (definição viva), padrão dos comandos `/follow-up modo` e `/mayara pausar|ligar`, `mayara.abordagem_auto_resumo(int)`.
- Produces: comandos `/abordagem automatica ligar`, `/abordagem automatica desligar`, `/abordagem automatica status` (e a consulta equivalente no modo livre) e uma linha no resumo diário.

Este plano deixa a Task 5 em formato resumido porque ela depende da forma exata do `executar_central` vivo; **o detalhe (código SQL e teste) é escrito no início da Task 5**, depois de ler a definição viva, com os mesmos testes de caminho dos comandos existentes:
- `ligar` recusa se `abordagem_assistida` estiver desligada, devolve o resumo (teto por hora, abertas) e exige a mesma confirmação "sim" dos comandos que alteram o modo real da Mayara;
- `desligar` é imediato;
- `status` devolve `abordagem_auto_resumo(24)` em texto curto;
- resposta fixa quando o remetente não é administrador (comportamento já existente).

- [ ] **Step 1: Ler a definição viva e escrever o detalhe da tarefa neste arquivo (registrar `Ruling`)**
- [ ] **Step 2: Teste SQL falhando, migration, teste passando, regressão do `0047` e `0055`**
- [ ] **Step 3: Patch do workflow `Central de Comando` gerado e testado (padrão `gerar-central-patch.mjs`), aplicado por PUT, relido e exportado**
- [ ] **Step 4: Linha "Liberação automática: N enviadas, N descartadas, N abertas" no resumo diário (`Follow-up: Resumo Diário`, `302hreR74xZwEdOw`), por patch mínimo**
- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0061_mayara_abordagem_automatica_comando.sql supabase/tests/0061_abordagem_automatica_comando.test.sql docs/superpowers/specs/workflows/
git commit -m "feat(abordagem): comando e resumo da liberacao automatica"
```

---

### Task 6: Piloto controlado e handoff

**Files:**
- Modify: `docs/handoffs/claude-status.md`

**Interfaces:**
- Consumes: Tasks 1 a 5 concluídas e a agenda provada (Task 1, Step 4).
- Produces: liberação automática ligada de forma gradual e registrada.

- [ ] **Step 1: Pré-condições conferidas (não pular)**

Run (`execute_sql`):
```sql
select (select valor from mayara.config where chave = 'abordagem_assistida') assistida,
       (select valor from mayara.config where chave = 'abordagem_automatica') automatica,
       (select valor from mayara.config where chave = 'abordagem_auto_teto_hora') teto,
       (select estado from mayara.canal_estado where canal_id = 'escritorio') canal;
```
Expected: `assistida = true`, `automatica = false`, `canal = open`. E o Step 4 da Task 1 aprovado pelo usuário.

- [ ] **Step 2: Ligar com teto baixo, por decisão explícita do usuário**

Com o usuário presente e depois do pedido dele: `update mayara.config set valor = '2' where chave = 'abordagem_auto_teto_hora'` e `/abordagem automatica ligar` (ou `update mayara.config set valor = 'true' where chave = 'abordagem_automatica'`).
Expected: `abordagem_auto_resumo(24)` mostra `ligada = true`, `teto_hora = 2`.

- [ ] **Step 3: Acompanhar os três primeiros leads reais**

Para cada lead novo: conferir `propostas_abordagem` (aprovada por `automatico`), `envios_log` (origem `abordagem_automatica`, `ok`), a conversa em `n8n_chat_histories` e, se o lead responder, que a Mayara continuou o atendimento (incluindo, se chegar a esse ponto, o agendamento na agenda).
Expected: três envios corretos, sem erro e sem duplicidade. Qualquer desvio: desligar a chave na hora (`/abordagem automatica desligar`) e investigar antes de continuar.

- [ ] **Step 4: Subir o teto por decisão do usuário e registrar o handoff**

Depois do piloto, e só se o usuário pedir: `abordagem_auto_teto_hora` para o valor combinado (o padrão é 10). Acrescentar ao `docs/handoffs/claude-status.md` uma seção "Liberação automática de atendimento": objetivo, arquivos, testes (`OK 0059`, `OK 0060`, `OK 0061`, testes Node), resultado do piloto em números, pendências e riscos, sem dados de clientes.

```bash
git add docs/handoffs/claude-status.md
git commit -m "docs(handoff): liberacao automatica de atendimento para leads novos"
```

---

## Relação com a reativação em massa

- Os dois projetos são independentes. A reativação cria propostas de tipo `reativacao`, que **nunca** entram na liberação automática (o filtro `tipo = 'abordagem'` da Task 2 garante isso; se a coluna `tipo` ainda não existir, todas as propostas atuais são de abordagem e o filtro é aplicado depois, quando a reativação for implantada, antes de ligá-la).
- Ordem de migrations: se este plano rodar primeiro, usa 0059 e 0060 e a reativação passa a usar o próximo número livre; ajustar o nome nos testes quando isso acontecer.
- As duas funções `aprovar_proposta` e `decidir_proposta` são redefinidas pela reativação (0058). Este plano só as chama, então a ordem de aplicação não importa.

## Self-review

- **Cobertura:** seleção e aprovação automática (Task 2), notificação sem ruído (Task 3), envio e registro (Task 4), operação pelo administrador (Task 5), agenda e piloto (Tasks 1 e 6). A falha de 16/10 (Google Calendar) está na Task 1 como pré-condição de ligar.
- **Pendência declarada:** a Task 5 tem o detalhe de código para escrever no início dela, porque depende de ler o `executar_central` vivo; isso está dito na própria tarefa e não é um espaço em branco escondido.
- **Consistência de nomes:** `abordagem_auto_proximo`, `abordagem_auto_registrar`, `abordagem_auto_resumo`, `abordagem_automatica`, `abordagem_auto_teto_hora` e `origem = 'abordagem_automatica'` aparecem iguais nas Tasks 2 a 6.

## Registro de execução

- **Task 2 concluída em 17/10** (`OK 0059`, migration aplicada; chave `abordagem_automatica = false`).
  - Ruling: a tabela `propostas_abordagem` ainda não tem a coluna `tipo` (a reativação em massa não foi implantada); o filtro `tipo = 'abordagem'` foi removido da migration. Quando a reativação criar a coluna, acrescentar o filtro em `abordagem_auto_proximo` antes de ligar a reativação. Custo se esquecido: propostas de reativação seriam enviadas sem aprovação individual.
  - Ruling: `administradores.telefone_chave` é coluna gerada; o teste insere só `telefone` e `nome`.
  - Ruling: o teste usa horários simulados (`segunda`) também nas janelas de 48 h e de 1 hora; o desempate `id desc` foi acrescentado à contagem das três últimas falhas (em produção os horários diferem, no teste são idênticos). Aplicado como `apply_migration` adicional (`..._desempate_falhas`) e incorporado ao arquivo da 0059.
  - Regressão dos testes antigos (0033 a 0036, 0050) dispensada: nenhuma função existente foi alterada, só funções novas e duas chaves de configuração.
- **Task 3 concluída em 17/10** (`OK 0060`, migration aplicada).
  - Ruling: `reservar_notificacoes(p_agora)` expira propostas com `expira_em` anterior a `p_agora`; o teste usa horário simulado no futuro, então fixa `expira_em` das propostas de teste. Sem efeito em produção.
  - Regressão dispensada: com a chave desligada o comportamento é idêntico (provado no primeiro cenário do teste).
