# Abordagem Assistida, Fase 3: Workflows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ligar o banco (Fase 1) e a biblioteca (Fase 2) ao WhatsApp: quando um lead novo é criado pelo grupo da agência, a Mayara prepara uma proposta de primeiro contato; o administrador recebe a proposta no WhatsApp (6h às 21h) e responde `sim N`, `não N` ou `editar N: texto`; com o "sim", o envio sai por um workflow permanente e a conversa segue com a Mayara. Tudo atrás da chave `abordagem_assistida` (desligada até o aceite).

**Architecture:** Dois workflows novos (`Abordagem: Propor`, sub-workflow; `Abordagem: Notificar`, agendado a cada minuto) gerados por um script a partir de código testado, mais um ramo novo no workflow existente da Central de Comando (`jNhj68Ee7i3w8dey`) aplicado por operações pequenas e um gatilho no sub-workflow de captura do grupo (`LkiVmBMUzRm8q9Re`). Toda decisão fica em funções do banco; os workflows só chamam funções e o `Canal: Enviar`.

**Tech Stack:** PostgreSQL (Supabase), n8n (workflows + Code nodes), Node.js (`node:test`) para geradores e biblioteca.

**Spec:** `docs/superpowers/specs/2026-10-09-abordagem-assistida-design.md`

## Global Constraints

- Migration `0036_...` em `supabase/migrations/`; teste em `supabase/tests/0036_*.test.sql`, com `begin; ... rollback;` terminando em `select 'OK 0036'`. A ferramenta recusa `delete`, `drop` e `update` sem `where`; testes com `where` explícito. Telefones de teste `+55119999909xx`, nomes com sufixo "Teste".
- **A chave `abordagem_assistida` continua `'false'` até a Task 7.** Com a chave desligada, nenhum workflow novo pode enviar nada nem criar proposta.
- Nenhum envio ao lead sem `sim N` do administrador. O envio usa `Mayara — Canal: Enviar [Sub-workflow]` (`SHLZkNqfbCrs2OSQ`), `canalId` `escritorio`, `identificarMayara` `true`, origem `abordagem_assistida`.
- Notificações ao administrador: `Canal: Enviar` com origem `abordagem_notificacao`, `identificarMayara` `false`, só das 6h às 21h (garantido por `reservar_notificacoes`). Falha de envio da notificação libera a reserva (`liberar_notificacao`) para tentar de novo no minuto seguinte.
- Credenciais existentes: Postgres `nNpCUIhnDuVvTApU`; EspoCRM `3CNvCGWMMDOyGD2n` (header auth); `errorWorkflow` `CQyjBKLX0UheNh1q`; `Alertar Escritório` `FWSC1k1CBMWBtsNs`.
- **Nesta fase a IA não redige o texto.** O rascunho é o modelo determinístico de `redigir.mjs` (reproduz o texto aprovado da Cristina); o parâmetro `textoIA` fica vazio. A redação por IA pode entrar depois, sem mudar o resto.
- n8n-mcp é instável: `updateNode`/`addNode`/`addConnection` pequenos funcionam; payloads grandes fecham a conexão. Reler o estado antes de repetir; máximo 3 tentativas por operação; se não aplicar, entregar o JSON gerado ao usuário para importar pela interface do n8n e dizer exatamente o que falta.
- Não regenerar nem sobrescrever a Central a partir de `gerar-workflow.mjs` (o arquivo de exportação do repositório pode estar defasado em relação ao n8n ao vivo): mudar a Central **somente** por operações incrementais e depois reexportar o estado ao vivo.
- Commits terminam com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Projeto Supabase: `wuhvlvsolewslkawazlq`.

## Review Focus

1. Com a chave desligada nada acontece: `Propor` não cria proposta, `Notificar` não reserva, e o ramo `proposta` da Central responde mas não envia sem proposta aberta.
2. `sim` sem número: uma única proposta aberta e nenhuma regra/ação pendente → aprova essa; duas ou mais → pede o número e **não envia**; regra ou ação pendente → o `sim` continua valendo para elas.
3. Falha no envio ao lead: a proposta vira `falhou`, a memória da Mayara fica intocada e o administrador é avisado. Falha no envio da notificação ao administrador: a reserva é liberada.
4. A janela das 6h às 21h vale para notificar e lembrar; `sim N` dado a qualquer hora envia na hora.
5. O gatilho no sub-workflow de captura nunca atrapalha a criação do lead no CRM (falha ou chave desligada não pode impedir nem atrasar o registro do cartão).

## File Structure

- Create: `supabase/migrations/0036_mayara_propostas_workflows.sql`, `supabase/tests/0036_propostas_workflows.test.sql`
- Modify: `docs/superpowers/specs/2026-10-03-central-comando/central-comando.mjs` (classificador), `gerar-node.mjs` (rodapé com `ctx`)
- Create: `docs/superpowers/specs/2026-10-03-central-comando/central-propostas.test.mjs`
- Create: `docs/superpowers/specs/2026-10-09-abordagem-assistida/gerar-workflows.mjs`, `gerar-workflows.test.mjs`, `gerar-central-patch.mjs`
- Create (gerados): `docs/superpowers/specs/workflows/mayara-abordagem-propor.json`, `mayara-abordagem-notificar.json`; `docs/superpowers/specs/2026-10-09-abordagem-assistida/central-patch.json`, `classificar.node.js`
- Modify: `docs/superpowers/specs/2026-10-07-lead-grupo-agencia/gerar-workflow.mjs` e `docs/superpowers/specs/workflows/mayara-lead-grupo-agencia.json`
- Modify: `docs/superpowers/specs/workflows/mayara-central-de-comando.json` (reexportação do estado ao vivo)
- Modify: `docs/superpowers/specs/2026-10-09-abordagem-assistida-design.md`

---

### Task 0: Pré-condições (somente leitura)

**Files:** nenhum.

- [ ] **Step 1: Confirmar acesso ao n8n pelo n8n-mcp**

Run: `n8n_get_workflow` com `id: "jNhj68Ee7i3w8dey"`, `mode: "structure"`.
Expected: a estrutura da Central (20 nós ou mais). Se vier `AUTHENTICATION_ERROR`, **parar e pedir ao usuário** que gere uma nova chave de API em n8n → Configurações → API e atualize a configuração do n8n-mcp; as Tasks 4 a 6 dependem disso. As Tasks 1 a 3 não dependem e podem seguir.

- [ ] **Step 2: Conferir o estado ao vivo da Central**

Com o acesso funcionando, ler a Central e registrar no ledger: (a) o nome e o tipo do último nó de resposta (`Responder`: Graph API da Meta ou `Canal: Enviar`); (b) as saídas do `Roteador` (esperado: `sql`, `texto`, `modo`, `status`, `livre`); (c) se `Classificar` ainda usa `classificarMensagem(entrada.message, { exclusivo: ctx.exclusivo === true })`.
Expected: Roteador com 5 saídas e `Finalizar` ligado a um nó de resposta. Qualquer diferença vira `Ruling:` no ledger antes da Task 5.

---

### Task 1: Banco: contexto da Central, decisão de proposta, finalização do envio e liberação de notificação

**Files:**
- Create: `supabase/migrations/0036_mayara_propostas_workflows.sql`
- Test: `supabase/tests/0036_propostas_workflows.test.sql`

**Interfaces:**
- Consumes: Fase 1 (`aprovar_proposta`, `descartar_proposta`, `editar_proposta`, `listar_propostas_abertas`, `confirmar_envio_proposta`, `proposta_sem_numero`, `criar_proposta`, `reservar_notificacoes`), `mayara.acoes_pendentes`, `mayara.instrucoes`.
- Produces:
  - `mayara.contexto_central(p_telefone text) returns jsonb` com as chaves antigas (`pendente`, `exclusivo`) mais `acao_pendente` (boolean), `propostas_abertas` (int), `proposta_unica` (id numérico ou `null`).
  - `mayara.decidir_proposta(p_op text, p_id bigint, p_texto text, p_autor text) returns jsonb`: `{"acao":"enviar","id","destino","texto","nome","crm_lead_id"}` ou `{"acao":"responder","resposta":"..."}`; `p_op` em `aprovar`, `descartar`, `editar`, `listar`.
  - `mayara.finalizar_envio_proposta(p_id bigint, p_ok boolean, p_erro text) returns text` (mensagem para o administrador).
  - `mayara.liberar_notificacao(p_id bigint, p_tipo text) returns void` (`p_tipo` `nova` ou `lembrete`).

- [ ] **Step 1: Escrever o teste (deve falhar)**

```sql
-- supabase/tests/0036_propostas_workflows.test.sql
begin;
do $t$
declare r jsonb; v_id bigint; v_id2 bigint; t text;
begin
  -- contexto_central: chaves novas, sem quebrar as antigas
  r := mayara.contexto_central('5514997022609');
  assert (r ->> 'pendente') = 'false' and (r ->> 'acao_pendente') = 'false', 'sem pendencias: ' || r::text;
  assert (r ->> 'propostas_abertas') = '0' and (r -> 'proposta_unica') = 'null'::jsonb, 'sem propostas: ' || r::text;
  assert r ? 'exclusivo', 'mantem exclusivo';

  v_id := (mayara.criar_proposta('+5511999990901', 'Ana Teste', 'crm-a1', 'Boa tarde, Ana. Aqui é a Mayara. Com qual banco é esse contrato?', '{"valorAproximado":"50 mil"}'::jsonb, 'banco') ->> 'id')::bigint;
  r := mayara.contexto_central('5514997022609');
  assert (r ->> 'propostas_abertas') = '1' and (r ->> 'proposta_unica')::bigint = v_id, 'uma proposta: ' || r::text;
  v_id2 := (mayara.criar_proposta('+5511999990902', 'Beto Teste', null, 'Boa tarde, Beto. Aqui é a Mayara. Qual banco?', '{}'::jsonb, 'banco') ->> 'id')::bigint;
  r := mayara.contexto_central('5514997022609');
  assert (r ->> 'propostas_abertas') = '2' and (r -> 'proposta_unica') = 'null'::jsonb, 'duas propostas: ' || r::text;

  -- decidir: listar, descartar, editar, aprovar
  r := mayara.decidir_proposta('listar', null, null, 'x');
  assert (r ->> 'acao') = 'responder' and (r ->> 'resposta') like '%#' || v_id::text || ' Ana Teste (final 0901)%', 'listar: ' || r::text;
  r := mayara.decidir_proposta('descartar', v_id2, null, 'x');
  assert (r ->> 'acao') = 'responder' and (r ->> 'resposta') like '%descartei%', 'descartar: ' || r::text;
  r := mayara.decidir_proposta('editar', v_id, '  Boa tarde, Ana. Aqui é a Mayara. Qual o banco do contrato?  ', 'x');
  assert (r ->> 'acao') = 'responder' and (r ->> 'resposta') like '%Qual o banco do contrato?%' and (r ->> 'resposta') like '%sim ' || v_id::text || '%', 'editar: ' || r::text;
  r := mayara.decidir_proposta('editar', v_id, 'Veja https://x.com', 'x');
  assert (r ->> 'resposta') like '%link%', 'editar com link: ' || r::text;
  r := mayara.decidir_proposta('editar', v_id, '   ', 'x');
  assert (r ->> 'resposta') like '%editar%', 'editar vazio: ' || r::text;
  r := mayara.decidir_proposta('editar', 999999999, 'Oi', 'x');
  assert (r ->> 'resposta') like '%Não achei%' or (r ->> 'resposta') like '%não está aberta%', 'editar inexistente: ' || r::text;
  r := mayara.decidir_proposta('aprovar', null, null, 'x');
  assert (r ->> 'resposta') like '%número da proposta%', 'sem numero: ' || r::text;
  r := mayara.decidir_proposta('aprovar', 999999999, null, 'x');
  assert (r ->> 'acao') = 'responder' and (r ->> 'resposta') like '%Não achei%', 'aprovar inexistente: ' || r::text;
  r := mayara.decidir_proposta('aprovar', v_id, null, '5514997022609');
  assert (r ->> 'acao') = 'enviar' and (r ->> 'destino') = '+5511999990901' and (r ->> 'texto') = 'Boa tarde, Ana. Aqui é a Mayara. Qual o banco do contrato?' and (r ->> 'crm_lead_id') = 'crm-a1' and (r ->> 'id')::bigint = v_id, 'aprovar: ' || r::text;
  r := mayara.decidir_proposta('aprovar', v_id, null, '5514997022609');
  assert (r ->> 'acao') = 'responder' and (r ->> 'resposta') like '%já foi aprovada%', 'aprovar de novo: ' || r::text;
  r := mayara.decidir_proposta('xyz', v_id, null, 'x');
  assert (r ->> 'resposta') like '%Não entendi%', 'operacao desconhecida: ' || r::text;

  -- finalizar envio: sucesso e falha
  t := mayara.finalizar_envio_proposta(v_id, true, null);
  assert t like '%Enviei a mensagem para Ana Teste (final 0901)%', 'envio ok: ' || t;
  assert (select estado from mayara.propostas_abordagem where id = v_id) = 'enviada', 'estado enviada';
  v_id2 := (mayara.criar_proposta('+5511999990903', 'Caio Teste', null, 'Boa tarde, Caio. Aqui é a Mayara. Qual banco?', '{}'::jsonb, 'banco') ->> 'id')::bigint;
  perform mayara.decidir_proposta('aprovar', v_id2, null, 'x');
  t := mayara.finalizar_envio_proposta(v_id2, false, 'connection closed');
  assert t like '%Não consegui enviar para Caio Teste (final 0903)%' and t like '%connection closed%', 'envio falhou: ' || t;
  assert (select estado from mayara.propostas_abordagem where id = v_id2) = 'falhou', 'estado falhou';

  -- liberar notificacao
  v_id := (mayara.criar_proposta('+5511999990904', 'Duda Teste', null, 'Boa tarde, Duda. Aqui é a Mayara. Qual banco?', '{}'::jsonb, 'banco') ->> 'id')::bigint;
  update mayara.propostas_abordagem set notificada_em = now(), lembrete_em = now() where id = v_id;
  perform mayara.liberar_notificacao(v_id, 'lembrete');
  assert (select lembrete_em from mayara.propostas_abordagem where id = v_id) is null and (select notificada_em from mayara.propostas_abordagem where id = v_id) is not null, 'libera so o lembrete';
  perform mayara.liberar_notificacao(v_id, 'nova');
  assert (select notificada_em from mayara.propostas_abordagem where id = v_id) is null, 'libera a notificacao nova';
  update mayara.propostas_abordagem set estado = 'descartada', encerrada_em = now() where id = v_id;
  perform mayara.liberar_notificacao(v_id, 'nova');
  assert (select notificada_em from mayara.propostas_abordagem where id = v_id) is null, 'proposta encerrada nao e reaberta';

  -- regra ou acao pendente aparece no contexto
  insert into mayara.instrucoes (texto, autor_chave) values ('Regra pendente de teste.', 't');
  assert (mayara.contexto_central('x') ->> 'pendente') = 'true', 'regra pendente no contexto';
  update mayara.instrucoes set estado = 'recusada', encerrada_em = now() where estado = 'pendente';
  perform mayara.criar_acao_pendente('pausar', '{}'::jsonb, 'Pausar a Mayara', '5514997022609');
  assert (mayara.contexto_central('x') ->> 'acao_pendente') = 'true', 'acao pendente no contexto';
  update mayara.acoes_pendentes set estado = 'cancelada', encerrada_em = now() where estado = 'pendente';

  assert not has_function_privilege('anon', 'mayara.decidir_proposta(text,bigint,text,text)', 'execute'), 'anon decidir';
  assert not has_function_privilege('authenticated', 'mayara.finalizar_envio_proposta(bigint,boolean,text)', 'execute'), 'authenticated finalizar';
  assert not has_function_privilege('anon', 'mayara.liberar_notificacao(bigint,text)', 'execute'), 'anon liberar';
end $t$;
rollback;
select 'OK 0036' as resultado;
```

- [ ] **Step 2: Rodar e ver falhar**

Run: o conteúdo acima via `execute_sql`.
Expected: FAIL (`function mayara.decidir_proposta(unknown, unknown, unknown, unknown) does not exist` ou asserção de `acao_pendente`).

- [ ] **Step 3: Escrever a migration**

```sql
-- supabase/migrations/0036_mayara_propostas_workflows.sql
create or replace function mayara.contexto_central(p_telefone text)
returns jsonb language plpgsql set search_path = '' as $$
declare v_prop jsonb;
begin
  perform mayara.expirar_pendentes();
  perform mayara.expirar_acoes_pendentes();
  v_prop := mayara.proposta_sem_numero();
  return jsonb_build_object(
    'pendente', exists (select 1 from mayara.instrucoes where estado = 'pendente'),
    'acao_pendente', exists (select 1 from mayara.acoes_pendentes where estado = 'pendente'),
    'exclusivo', coalesce((select valor from mayara.config where chave = 'canal_comando_exclusivo'), 'false') = 'true',
    'propostas_abertas', (v_prop ->> 'qtd')::int,
    'proposta_unica', v_prop -> 'id'
  );
end $$;

create or replace function mayara._motivo_proposta(p_motivo text, p_id bigint)
returns text language sql immutable set search_path = '' as $$
  select case p_motivo
    when 'nao_encontrada' then 'Não achei a proposta ' || p_id::text || '.'
    when 'ja_aprovada' then 'A proposta ' || p_id::text || ' já foi aprovada.'
    when 'expirada' then 'A proposta ' || p_id::text || ' expirou. O lead segue no CRM para contato manual.'
    when 'nao_esta_aberta' then 'A proposta ' || p_id::text || ' não está aberta.'
    when 'lead_inativo' then 'Não enviei: esse lead pediu para parar ou já foi assumido pela equipe. Descartei a proposta ' || p_id::text || '.'
    when 'texto_vazio' then 'Escreva o novo texto depois dos dois pontos. Exemplo: editar ' || p_id::text || ': Boa tarde, ...'
    when 'texto_longo' then 'O texto ficou longo demais (máximo 700 caracteres).'
    when 'texto_invalido' then 'O texto não pode ter link. Envie de novo sem link.'
    else 'Não consegui processar a proposta ' || p_id::text || '.'
  end
$$;

create or replace function mayara.decidir_proposta(p_op text, p_id bigint, p_texto text, p_autor text)
returns jsonb language plpgsql set search_path = '' as $$
declare r jsonb;
begin
  if p_op = 'listar' then
    return jsonb_build_object('acao', 'responder', 'resposta', mayara.listar_propostas_abertas());
  end if;
  if p_op not in ('aprovar', 'descartar', 'editar') then
    return jsonb_build_object('acao', 'responder', 'resposta', 'Não entendi o que fazer com a proposta.');
  end if;
  if p_id is null then
    return jsonb_build_object('acao', 'responder', 'resposta', 'Informe o número da proposta, por exemplo: sim 12.');
  end if;
  if p_op = 'descartar' then
    return jsonb_build_object('acao', 'responder', 'resposta', mayara.descartar_proposta(p_id));
  end if;
  if p_op = 'editar' then
    r := mayara.editar_proposta(p_id, p_texto);
    if (r ->> 'ok') = 'true' then
      return jsonb_build_object('acao', 'responder', 'resposta',
        'Texto atualizado na proposta ' || p_id::text || E':\n\n' || (r ->> 'texto')
        || E'\n\nResponda *sim ' || p_id::text || '* para enviar ou *não ' || p_id::text || '* para descartar.');
    end if;
    return jsonb_build_object('acao', 'responder', 'resposta', mayara._motivo_proposta(r ->> 'motivo', p_id));
  end if;
  r := mayara.aprovar_proposta(p_id, p_autor);
  if (r ->> 'ok') = 'true' then
    return jsonb_build_object('acao', 'enviar', 'id', p_id, 'destino', r ->> 'destino', 'texto', r ->> 'texto',
                              'nome', r ->> 'nome', 'crm_lead_id', r ->> 'crm_lead_id');
  end if;
  return jsonb_build_object('acao', 'responder', 'resposta', mayara._motivo_proposta(r ->> 'motivo', p_id));
end $$;

create or replace function mayara.finalizar_envio_proposta(p_id bigint, p_ok boolean, p_erro text)
returns text language plpgsql set search_path = '' as $$
declare p mayara.propostas_abordagem%rowtype;
begin
  select * into p from mayara.propostas_abordagem where id = p_id;
  if not found then
    return 'Proposta não encontrada.';
  end if;
  perform mayara.confirmar_envio_proposta(p_id, p_ok, p_erro);
  if p_ok then
    return 'Enviei a mensagem para ' || coalesce(p.nome, 'o lead') || ' (final ' || right(p.telefone_chave, 4)
           || '). Quando responder, a Mayara atende a conversa.';
  end if;
  return 'Não consegui enviar para ' || coalesce(p.nome, 'o lead') || ' (final ' || right(p.telefone_chave, 4)
         || '): ' || left(coalesce(p_erro, 'erro desconhecido'), 120)
         || '. A proposta foi encerrada como falhou; envie manualmente.';
end $$;

create or replace function mayara.liberar_notificacao(p_id bigint, p_tipo text)
returns void language plpgsql set search_path = '' as $$
begin
  if p_tipo = 'nova' then
    update mayara.propostas_abordagem set notificada_em = null where id = p_id and estado = 'aberta';
  elsif p_tipo = 'lembrete' then
    update mayara.propostas_abordagem set lembrete_em = null where id = p_id and estado = 'aberta';
  end if;
end $$;

revoke all on function mayara._motivo_proposta(text, bigint) from public, anon, authenticated;
revoke all on function mayara.decidir_proposta(text, bigint, text, text) from public, anon, authenticated;
revoke all on function mayara.finalizar_envio_proposta(bigint, boolean, text) from public, anon, authenticated;
revoke all on function mayara.liberar_notificacao(bigint, text) from public, anon, authenticated;
revoke all on function mayara.contexto_central(text) from public, anon, authenticated;
```

- [ ] **Step 4: Aplicar (`apply_migration`, nome `mayara_propostas_workflows`) e rodar o teste**

Expected: `OK 0036`. Se uma asserção de texto falhar por pontuação, alinhar função e teste entre si (a função é a fonte da mensagem ao administrador).

- [ ] **Step 5: Regressão**

Run: `0030` (`supabase/tests/0030_acoes_pendentes.test.sql`), `0033`, `0034`, `0035` via `execute_sql`.
Expected: `OK 0030`, `OK 0033`, `OK 0034`, `OK 0035`. O teste `0011` tem asserções de "vazio" que não valem com as regras reais ativas em produção: rodar só o trecho de `contexto_central` (`(j ->> 'pendente') = 'false'` após expirar a pendente).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0036_mayara_propostas_workflows.sql supabase/tests/0036_propostas_workflows.test.sql
git commit -m "feat(abordagem): contexto da Central, decisao de proposta e finalizacao do envio (migration 0036)"
```

---

### Task 2: Classificador da Central reconhece `sim N`, `não N`, `editar N: texto` e `propostas`

**Files:**
- Modify: `docs/superpowers/specs/2026-10-03-central-comando/central-comando.mjs` (função `classificarMensagem`)
- Modify: `docs/superpowers/specs/2026-10-03-central-comando/gerar-node.mjs` (`RODAPE_CLASSIFICAR`)
- Test: `docs/superpowers/specs/2026-10-03-central-comando/central-propostas.test.mjs`

**Interfaces:**
- Consumes: `semAcento(s)` e as listas `SIM`/`NAO` já existentes em `central-comando.mjs`; o `ctx` de `mayara.contexto_central` (Task 1).
- Produces: `classificarMensagem(texto, { exclusivo, ctx })` passa a devolver também `{ tipo: 'proposta', acao: 'proposta_aprovar'|'proposta_descartar'|'proposta_editar'|'proposta_listar', op: 'aprovar'|'descartar'|'editar'|'listar', id: number|null, texto: string }` e, para "sim"/"não" sem número com duas ou mais propostas, `{ tipo: 'texto', acao: 'proposta_ambigua', resposta: '...' }`.

- [ ] **Step 1: Escrever o teste (deve falhar)**

```js
// central-propostas.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { classificarMensagem } from './central-comando.mjs';

const livre = { exclusivo: true, ctx: { pendente: false, acao_pendente: false, propostas_abertas: 0, proposta_unica: null } };

test('sim N, nao N e editar N: texto viram operacoes de proposta', () => {
  assert.deepEqual(classificarMensagem('sim 12', livre), { tipo: 'proposta', acao: 'proposta_aprovar', op: 'aprovar', id: 12, texto: '' });
  assert.deepEqual(classificarMensagem('Sim #12', livre), { tipo: 'proposta', acao: 'proposta_aprovar', op: 'aprovar', id: 12, texto: '' });
  assert.deepEqual(classificarMensagem('não 7', livre), { tipo: 'proposta', acao: 'proposta_descartar', op: 'descartar', id: 7, texto: '' });
  assert.deepEqual(classificarMensagem('nao 7', livre), { tipo: 'proposta', acao: 'proposta_descartar', op: 'descartar', id: 7, texto: '' });
  assert.deepEqual(classificarMensagem('editar 12: Boa tarde, Ana. Aqui é a Mayara. Qual banco?', livre),
    { tipo: 'proposta', acao: 'proposta_editar', op: 'editar', id: 12, texto: 'Boa tarde, Ana. Aqui é a Mayara. Qual banco?' });
  assert.deepEqual(classificarMensagem('editar 12 - Texto novo', livre),
    { tipo: 'proposta', acao: 'proposta_editar', op: 'editar', id: 12, texto: 'Texto novo' });
  assert.deepEqual(classificarMensagem('propostas', livre), { tipo: 'proposta', acao: 'proposta_listar', op: 'listar', id: null, texto: '' });
});

test('funciona tambem fora do modo exclusivo e sem ctx', () => {
  assert.equal(classificarMensagem('sim 12').tipo, 'proposta');
  assert.equal(classificarMensagem('sim 12', { exclusivo: false }).op, 'aprovar');
});

test('sim sem numero com uma unica proposta e nada pendente aprova essa proposta', () => {
  const ctx = { pendente: false, acao_pendente: false, propostas_abertas: 1, proposta_unica: 5 };
  assert.deepEqual(classificarMensagem('sim', { exclusivo: true, ctx }), { tipo: 'proposta', acao: 'proposta_aprovar', op: 'aprovar', id: 5, texto: '' });
  assert.deepEqual(classificarMensagem('não', { exclusivo: true, ctx }), { tipo: 'proposta', acao: 'proposta_descartar', op: 'descartar', id: 5, texto: '' });
});

test('sim sem numero com duas ou mais propostas pede o numero e nao aprova nada', () => {
  const ctx = { pendente: false, acao_pendente: false, propostas_abertas: 3, proposta_unica: null };
  const r = classificarMensagem('sim', { exclusivo: true, ctx });
  assert.equal(r.tipo, 'texto');
  assert.equal(r.acao, 'proposta_ambigua');
  assert.match(r.resposta, /3 propostas abertas/);
  assert.match(r.resposta, /sim <número>/);
  assert.equal(classificarMensagem('não', { exclusivo: true, ctx }).acao, 'proposta_ambigua');
});

test('regra ou acao pendente tem prioridade: o sim continua valendo para elas', () => {
  const base = { propostas_abertas: 1, proposta_unica: 5 };
  assert.equal(classificarMensagem('sim', { exclusivo: true, ctx: { ...base, pendente: true, acao_pendente: false } }).tipo, 'sql');
  assert.equal(classificarMensagem('sim', { exclusivo: true, ctx: { ...base, pendente: false, acao_pendente: true } }).tipo, 'sql');
  assert.equal(classificarMensagem('não', { exclusivo: true, ctx: { ...base, pendente: true, acao_pendente: false } }).tipo, 'sql');
});

test('sim sem numero e sem propostas continua como confirmacao de regra', () => {
  assert.equal(classificarMensagem('sim', livre).tipo, 'sql');
  assert.equal(classificarMensagem('sim').tipo, 'sql');
});

test('o ensino livre e os comandos com barra nao mudam', () => {
  assert.equal(classificarMensagem('Quando perguntarem de honorários, não cite valores.', livre).tipo, 'livre');
  assert.equal(classificarMensagem('/status', livre).tipo, 'status');
  assert.equal(classificarMensagem('sim claro, pode ser', livre).tipo, 'livre');
  assert.equal(classificarMensagem('editar a regra de honorários', livre).tipo, 'livre');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test docs/superpowers/specs/2026-10-03-central-comando/central-propostas.test.mjs`
Expected: FAIL (`sim 12` hoje cai em `livre` ou `ignorado`; asserções de `tipo: 'proposta'` falham).

- [ ] **Step 3: Implementar**

Em `central-comando.mjs`, dentro de `classificarMensagem`, **substituir** as quatro linhas a partir de `const norm = ...` até o `if (exclusivo && t) ...` por:

```js
  const norm = semAcento(t).toLowerCase().replace(/[^a-z\s]/g, '').trim();
  const base = semAcento(t).toLowerCase().trim();
  const proposta = (op, id, texto = '') => ({ tipo: 'proposta', acao: 'proposta_' + op, op, id, texto });

  const aprovar = base.match(/^(?:sim|s)\s+#?(\d{1,9})$/);
  if (aprovar) return proposta('aprovar', Number(aprovar[1]));
  const descartar = base.match(/^(?:nao|n)\s+#?(\d{1,9})$/);
  if (descartar) return proposta('descartar', Number(descartar[1]));
  const editar = t.match(/^editar\s+#?(\d{1,9})\s*[:\-]\s*([\s\S]+)$/i);
  if (editar) return proposta('editar', Number(editar[1]), editar[2].trim());
  if (/^propostas?$/.test(base)) return proposta('listar', null);

  const ctx = arguments[1] && arguments[1].ctx ? arguments[1].ctx : {};
  const confirmacao = SIM.includes(norm) ? 'aprovar' : NAO.includes(norm) ? 'descartar' : '';
  if (confirmacao && !ctx.pendente && !ctx.acao_pendente) {
    if (ctx.proposta_unica) return proposta(confirmacao, Number(ctx.proposta_unica));
    if (Number(ctx.propostas_abertas) > 1) {
      return { tipo: 'texto', acao: 'proposta_ambigua',
        resposta: 'Há ' + ctx.propostas_abertas + ' propostas abertas. Responda sim <número> ou não <número>. Para ver a lista, envie: propostas' };
    }
  }
  if (SIM.includes(norm)) return sql('confirmar_sim');
  if (NAO.includes(norm)) return sql('confirmar_nao');
  if (exclusivo && t) return { tipo: 'livre', acao: 'ensino', texto: t };
```

e deixar a linha final `return { tipo: 'texto', acao: 'ignorado', ... }` como está. Para não depender de `arguments`, trocar a assinatura por `export function classificarMensagem(texto, { exclusivo = false, ctx = {} } = {})` e remover a linha `const ctx = arguments[1] ...`.

Em `gerar-node.mjs`, trocar a chamada do rodapé por: `const r = classificarMensagem(entrada.message, { exclusivo: ctx.exclusivo === true, ctx });`

- [ ] **Step 4: Rodar e ver passar (e a suíte existente da Central)**

Run: `node --test docs/superpowers/specs/2026-10-03-central-comando/*.test.mjs`
Expected: `fail 0` (o teste novo e os testes existentes de `central-comando.test.mjs` e `gerar-workflow.test.mjs`). Se um teste existente quebrar por causa da nova assinatura, ajustar a implementação (não o teste existente).

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-10-03-central-comando/
git commit -m "feat(abordagem): Central reconhece sim N, nao N, editar N e propostas"
```

---

### Task 3: Geradores dos workflows `Propor` e `Notificar`

**Files:**
- Create: `docs/superpowers/specs/2026-10-09-abordagem-assistida/gerar-workflows.mjs`
- Test: `docs/superpowers/specs/2026-10-09-abordagem-assistida/gerar-workflows.test.mjs`
- Create (gerados): `docs/superpowers/specs/workflows/mayara-abordagem-propor.json`, `docs/superpowers/specs/workflows/mayara-abordagem-notificar.json`

**Interfaces:**
- Consumes: `redigir.node.js` (Fase 2, corpo do Code node que lê `{ lead, textoIA }`); funções do banco das Tasks 1 e da Fase 1.
- Produces: `export function montarPropor()` e `export function montarNotificar()` (objetos de workflow); entrada do `Propor`: `{ lead: {telefone, nome, ...}, crmLeadId }`.

- [ ] **Step 1: Escrever o teste (deve falhar)**

```js
// gerar-workflows.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { montarPropor, montarNotificar } from './gerar-workflows.mjs';

function verificar(wf) {
  const nomes = wf.nodes.map((n) => n.name);
  assert.equal(new Set(nomes).size, nomes.length, 'nomes de nos duplicados');
  assert.equal(new Set(wf.nodes.map((n) => n.id)).size, wf.nodes.length, 'ids duplicados');
  for (const [origem, saidas] of Object.entries(wf.connections)) {
    assert.ok(nomes.includes(origem), 'origem inexistente: ' + origem);
    for (const porta of Object.values(saidas)) for (const lista of porta) for (const lig of lista) assert.ok(nomes.includes(lig.node), 'destino inexistente: ' + lig.node);
  }
  for (const n of wf.nodes) if (n.type === 'n8n-nodes-base.postgres') assert.equal(n.credentials.postgres.id, 'nNpCUIhnDuVvTApU');
  assert.equal(wf.settings.errorWorkflow, 'CQyjBKLX0UheNh1q');
}

test('Propor: estrutura valida, chave ligada antes de qualquer proposta, redigir embutido', () => {
  const wf = montarPropor();
  verificar(wf);
  assert.equal(wf.name, 'Mayara — Abordagem: Propor [Sub-workflow]');
  const tipos = wf.nodes.map((n) => n.type);
  assert.ok(tipos.includes('n8n-nodes-base.executeWorkflowTrigger'));
  assert.equal(wf.nodes.some((n) => n.type === 'n8n-nodes-base.scheduleTrigger'), false);
  const redigir = wf.nodes.find((n) => n.name === 'Redigir');
  assert.match(redigir.parameters.jsCode, /function resolverRascunho/);
  assert.equal(/^\s*(import|export)\s/m.test(redigir.parameters.jsCode), false, 'sem import/export no Code node');
  assert.deepEqual(wf.connections['Execute Workflow Trigger'].main[0].map((l) => l.node), ['Chave Ligada']);
  assert.deepEqual(wf.connections['Ligada?'].main[0].map((l) => l.node), ['Preparar Entrada']);
  assert.equal(wf.connections['Ligada?'].main[1].length, 0, 'chave desligada: nao faz nada');
  const criar = wf.nodes.find((n) => n.name === 'Criar Proposta');
  assert.match(criar.parameters.query, /mayara\.criar_proposta/);
  assert.equal(criar.onError, 'continueErrorOutput');
});

test('Notificar: agendado a cada minuto, so reserva com chave ligada e administrador ativo, e libera quando o envio falha', () => {
  const wf = montarNotificar();
  verificar(wf);
  assert.equal(wf.name, 'Mayara — Abordagem: Notificar');
  const gatilho = wf.nodes.find((n) => n.type === 'n8n-nodes-base.scheduleTrigger');
  assert.deepEqual(gatilho.parameters.rule.interval[0], { field: 'minutes', minutesInterval: 1 });
  const chave = wf.nodes.find((n) => n.name === 'Chave Ligada');
  assert.match(chave.parameters.query, /abordagem_assistida/);
  assert.match(chave.parameters.query, /mayara\.administradores/);
  const reservar = wf.nodes.find((n) => n.name === 'Reservar');
  assert.match(reservar.parameters.query, /reservar_notificacoes\(\)/);
  assert.match(reservar.parameters.query, /cross join/);
  const enviar = wf.nodes.find((n) => n.name === 'Enviar Notificacao');
  assert.equal(enviar.parameters.workflowId.value, 'SHLZkNqfbCrs2OSQ');
  assert.equal(enviar.parameters.workflowInputs.value.origem, 'abordagem_notificacao');
  assert.equal(enviar.parameters.workflowInputs.value.identificarMayara, 'false');
  assert.equal(enviar.onError, 'continueRegularOutput');
  const liberar = wf.nodes.find((n) => n.name === 'Liberar Reserva');
  assert.match(liberar.parameters.query, /liberar_notificacao/);
});

test('Notificar: a mensagem da proposta traz o texto exato e as tres respostas possiveis', () => {
  const wf = montarNotificar();
  const montar = wf.nodes.find((n) => n.name === 'Montar Mensagem').parameters.jsCode;
  const itens = [
    { json: { id: 12, tipo: 'nova', nome: 'Cristina', texto: 'Boa tarde, Cristina. Aqui é a Mayara. Com qual banco é esse contrato?', telefone_fim: '3126', admin: '+5514997022609' } },
    { json: { id: 12, tipo: 'lembrete', nome: 'Cristina', texto: 'x', telefone_fim: '3126', admin: '+5514997022609' } },
  ];
  const saida = new Function('$input', montar)({ all: () => itens });
  assert.match(saida[0].json.texto, /Novo lead: Cristina \(final 3126\)/);
  assert.match(saida[0].json.texto, /Boa tarde, Cristina\. Aqui é a Mayara\. Com qual banco é esse contrato\?/);
  assert.match(saida[0].json.texto, /\*sim 12\*/);
  assert.match(saida[0].json.texto, /\*não 12\*/);
  assert.match(saida[0].json.texto, /\*editar 12: novo texto\*/);
  assert.match(saida[1].json.texto, /^Lembrete: a proposta #12/);
  assert.equal(saida[0].json.admin, '+5514997022609');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test docs/superpowers/specs/2026-10-09-abordagem-assistida/gerar-workflows.test.mjs`
Expected: FAIL (`Cannot find module './gerar-workflows.mjs'`).

- [ ] **Step 3: Implementar o gerador**

```js
// gerar-workflows.mjs: monta os workflows "Abordagem: Propor" e "Abordagem: Notificar" (JSON do n8n).
// Uso: node gerar-workflows.mjs  (grava em docs/superpowers/specs/workflows/)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const PG = { postgres: { id: 'nNpCUIhnDuVvTApU', name: 'Postgres account' } };
const CANAL_ENVIAR = { __rl: true, value: 'SHLZkNqfbCrs2OSQ', mode: 'list', cachedResultName: 'Mayara — Canal: Enviar [Sub-workflow]' };
const ALERTAR = { __rl: true, value: 'FWSC1k1CBMWBtsNs', mode: 'list', cachedResultName: 'Mayara — Alertar Escritório [Sub-workflow]' };
const ERRO = 'CQyjBKLX0UheNh1q';
const id = (prefixo, n) => `${prefixo}000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const campo = (nome) => ({ id: nome, displayName: nome, required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true });
const entradaCanal = (valores) => ({ mappingMode: 'defineBelow', value: valores, matchingColumns: [], schema: Object.keys(valores).map(campo), attemptToConvertTypes: false, convertFieldsToString: true });
const pg = (nid, nome, pos, query, repl, extra = {}) => ({
  id: nid, name: nome, type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: pos, credentials: PG,
  parameters: { operation: 'executeQuery', query, options: repl ? { queryReplacement: repl } : {} }, ...extra,
});
const codigo = (nid, nome, pos, js) => ({ id: nid, name: nome, type: 'n8n-nodes-base.code', typeVersion: 2, position: pos, parameters: { jsCode: js } });
const se = (nid, nome, pos, esquerda) => ({
  id: nid, name: nome, type: 'n8n-nodes-base.if', typeVersion: 2.2, position: pos,
  parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
    conditions: [{ id: nid + '-c', leftValue: esquerda, rightValue: true, operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' }, options: {} },
});
const sub = (nid, nome, pos, workflowId, valores, extra = {}) => ({
  id: nid, name: nome, type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.3, position: pos,
  parameters: { workflowId, workflowInputs: entradaCanal(valores), options: { waitForSubWorkflow: true } }, ...extra,
});
const lig = (...destinos) => ({ main: [destinos.map((node) => ({ node, type: 'main', index: 0 }))] });

const CHAVE = "select (valor = 'true') as ligada from mayara.config where chave = 'abordagem_assistida'";

export function montarPropor() {
  const redigir = readFileSync(join(dir, 'redigir.node.js'), 'utf8');
  const entrada = "$('Preparar Entrada').first().json";
  const nodes = [
    { id: id('ab', 1), name: 'Execute Workflow Trigger', type: 'n8n-nodes-base.executeWorkflowTrigger', typeVersion: 1.1, position: [0, 300], parameters: { inputSource: 'passthrough' } },
    pg(id('ab', 2), 'Chave Ligada', [220, 300], CHAVE),
    se(id('ab', 3), 'Ligada?', [440, 300], '={{ $json.ligada === true }}'),
    codigo(id('ab', 4), 'Preparar Entrada', [660, 200], "const e = $('Execute Workflow Trigger').first().json;\nreturn [{ json: { lead: e.lead || {}, crmLeadId: e.crmLeadId || '' } }];"),
    codigo(id('ab', 5), 'Redigir', [880, 200], redigir),
    pg(id('ab', 6), 'Criar Proposta', [1100, 200], 'select mayara.criar_proposta($1, $2, $3, $4, $5::jsonb, $6) as r',
      `={{ [ ${entrada}.lead.telefone || '', ${entrada}.lead.nome || '', ${entrada}.crmLeadId, $json.texto, JSON.stringify($json.fatos), $json.lacuna.codigo ] }}`,
      { onError: 'continueErrorOutput' }),
    codigo(id('ab', 7), 'Montar Alerta', [1320, 360], `const l = ${entrada}.lead;\nconst tel = String(l.telefone || '');\nreturn [{ json: { texto: 'Atenção: não consegui preparar a proposta de abordagem do lead ' + (l.nome || 'sem nome') + ' (final ' + tel.slice(-4) + '). Contate manualmente.' } }];`),
    sub(id('ab', 8), 'Alertar Escritório', [1540, 360], ALERTAR, { texto: '={{ $json.texto }}' }, { onError: 'continueRegularOutput' }),
  ];
  nodes[7].parameters.options.waitForSubWorkflow = false;
  const connections = {
    'Execute Workflow Trigger': lig('Chave Ligada'),
    'Chave Ligada': lig('Ligada?'),
    'Ligada?': { main: [[{ node: 'Preparar Entrada', type: 'main', index: 0 }], []] },
    'Preparar Entrada': lig('Redigir'),
    Redigir: lig('Criar Proposta'),
    'Criar Proposta': { main: [[], [{ node: 'Montar Alerta', type: 'main', index: 0 }]] },
    'Montar Alerta': lig('Alertar Escritório'),
  };
  return { name: 'Mayara — Abordagem: Propor [Sub-workflow]', nodes, connections, settings: { executionOrder: 'v1', errorWorkflow: ERRO, callerPolicy: 'workflowsFromSameOwner' } };
}

const MONTAR_MENSAGEM = `const linhas = $input.all().map((i) => i.json);
return linhas.map((r) => {
  const nome = r.nome || 'Sem nome';
  const texto = r.tipo === 'lembrete'
    ? 'Lembrete: a proposta #' + r.id + ' (' + nome + ', final ' + r.telefone_fim + ') ainda aguarda sua resposta.\\n\\nResponda *sim ' + r.id + '* para enviar ou *não ' + r.id + '* para descartar.'
    : 'Novo lead: ' + nome + ' (final ' + r.telefone_fim + ').\\n\\nA Mayara propõe enviar:\\n\\n' + r.texto + '\\n\\nResponda *sim ' + r.id + '* para enviar, *não ' + r.id + '* para descartar ou *editar ' + r.id + ': novo texto* para trocar a mensagem.';
  return { json: { id: r.id, tipo: r.tipo, admin: r.admin, texto } };
});`;

export function montarNotificar() {
  const nodes = [
    { id: id('ac', 1), name: 'A Cada Minuto', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, position: [0, 300], parameters: { rule: { interval: [{ field: 'minutes', minutesInterval: 1 }] } } },
    pg(id('ac', 2), 'Chave Ligada', [220, 300],
      "select (valor = 'true' and exists (select 1 from mayara.administradores where ativo)) as ligada from mayara.config where chave = 'abordagem_assistida'"),
    se(id('ac', 3), 'Ligada?', [440, 300], '={{ $json.ligada === true }}'),
    pg(id('ac', 4), 'Reservar', [660, 300],
      'select r.id, r.tipo, r.nome, r.texto, r.telefone_fim, a.telefone as admin from mayara.reservar_notificacoes() r cross join (select telefone from mayara.administradores where ativo) a'),
    codigo(id('ac', 5), 'Montar Mensagem', [880, 300], MONTAR_MENSAGEM),
    sub(id('ac', 6), 'Enviar Notificacao', [1100, 300], CANAL_ENVIAR, {
      canalId: 'escritorio', para: '={{ $json.admin }}', tipo: 'texto', texto: '={{ $json.texto }}',
      templateNome: '', templateVariaveis: '', identificarMayara: 'false', origem: 'abordagem_notificacao',
    }, { onError: 'continueRegularOutput' }),
    codigo(id('ac', 7), 'Casar Retorno', [1320, 300],
      "const montados = $('Montar Mensagem').all();\nreturn $input.all().map((it, i) => ({ json: { id: montados[i].json.id, tipo: montados[i].json.tipo, falhou: it.json.ok !== true } }));"),
    se(id('ac', 8), 'Falhou?', [1540, 300], '={{ $json.falhou === true }}'),
    pg(id('ac', 9), 'Liberar Reserva', [1760, 200], 'select mayara.liberar_notificacao($1::bigint, $2)', '={{ [$json.id, $json.tipo] }}', { onError: 'continueRegularOutput' }),
  ];
  const connections = {
    'A Cada Minuto': lig('Chave Ligada'),
    'Chave Ligada': lig('Ligada?'),
    'Ligada?': { main: [[{ node: 'Reservar', type: 'main', index: 0 }], []] },
    Reservar: lig('Montar Mensagem'),
    'Montar Mensagem': lig('Enviar Notificacao'),
    'Enviar Notificacao': lig('Casar Retorno'),
    'Casar Retorno': lig('Falhou?'),
    'Falhou?': { main: [[{ node: 'Liberar Reserva', type: 'main', index: 0 }], []] },
  };
  return { name: 'Mayara — Abordagem: Notificar', nodes, connections, settings: { executionOrder: 'v1', errorWorkflow: ERRO } };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const saida = join(dir, '..', 'workflows');
  writeFileSync(join(saida, 'mayara-abordagem-propor.json'), JSON.stringify(montarPropor(), null, 2));
  writeFileSync(join(saida, 'mayara-abordagem-notificar.json'), JSON.stringify(montarNotificar(), null, 2));
  console.log('workflows gerados em', saida);
}
```

- [ ] **Step 4: Rodar e ver passar; gerar os JSON**

Run: `node --test docs/superpowers/specs/2026-10-09-abordagem-assistida/*.test.mjs && node docs/superpowers/specs/2026-10-09-abordagem-assistida/gerar-workflows.mjs`
Expected: `fail 0` e `workflows gerados em ...`. Conferir que os dois arquivos JSON existem.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-10-09-abordagem-assistida/ docs/superpowers/specs/workflows/mayara-abordagem-propor.json docs/superpowers/specs/workflows/mayara-abordagem-notificar.json
git commit -m "feat(abordagem): geradores dos workflows Propor e Notificar"
```

---

### Task 4: Publicar `Propor` e `Notificar` no n8n (inativos)

**Files:** nenhum arquivo novo (anotar os ids dos workflows no ledger).

- [ ] **Step 1: Criar `Propor`**

Run: `n8n_create_workflow` com o conteúdo de `docs/superpowers/specs/workflows/mayara-abordagem-propor.json` (`name`, `nodes`, `connections`, `settings`).
Expected: `success: true` e um id. Registrar o id no ledger como `PROPOR_ID`. Se a conexão fechar, reler (`n8n_list_workflows`) antes de repetir para não duplicar; após 3 falhas, pedir ao usuário para importar o JSON pela interface do n8n (Workflows → Import from file) e informar o id.

- [ ] **Step 2: Criar `Notificar` (inativo)**

Run: `n8n_create_workflow` com `mayara-abordagem-notificar.json`.
Expected: `success: true` e um id (`NOTIFICAR_ID`), `active: false`. **Não ativar ainda.**

- [ ] **Step 3: Validar os dois**

Run: `n8n_validate_workflow` para cada id.
Expected: sem erros de estrutura. Avisos sobre expressões do `Enviar Notificacao`/`Casar Retorno` são aceitáveis se apontarem só para nós existentes.

- [ ] **Step 4: Teste do `Propor` com a chave desligada**

Run: `n8n_test_workflow` não se aplica a sub-workflow sem webhook; em vez disso, conferir pelo banco que a chave está `false` (`select valor from mayara.config where chave = 'abordagem_assistida'`) e anotar no ledger que o teste funcional do `Propor` é feito na Task 7 (com a chave ligada e leads de teste).
Expected: chave `false`; nenhum registro novo em `mayara.propostas_abordagem`.

---

### Task 5: Ramo `proposta` na Central de Comando (ao vivo, operações incrementais)

**Files:**
- Create: `docs/superpowers/specs/2026-10-09-abordagem-assistida/gerar-central-patch.mjs`
- Create (gerados): `central-patch.json`, `classificar.node.js` (na mesma pasta)
- Modify: `docs/superpowers/specs/workflows/mayara-central-de-comando.json` (reexportação do estado ao vivo)

**Interfaces:**
- Consumes: Task 2 (`corpoNode`, `RODAPE_CLASSIFICAR`), Task 1 (`decidir_proposta`, `finalizar_envio_proposta`), ids da Task 0 (estado ao vivo da Central).
- Produces: a Central passa a ter a saída `proposta` no `Roteador` e os nós `Decidir Proposta`, `Enviar?`, `Resposta Proposta`, `Enviar Primeiro Contato`, `Casar Envio`, `Confirmar Envio`, `Enviado?`, `Atualizar CRM`, `Nota no CRM`.

- [ ] **Step 1: Escrever o gerador do patch**

```js
// gerar-central-patch.mjs: gera as operacoes incrementais para a Central ao vivo e o novo codigo do no Classificar.
// Uso: node gerar-central-patch.mjs
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { corpoNode, RODAPE_CLASSIFICAR } from '../2026-10-03-central-comando/gerar-node.mjs';

const dir = dirname(fileURLToPath(import.meta.url));
const PG = { postgres: { id: 'nNpCUIhnDuVvTApU', name: 'Postgres account' } };
const CRM = { httpHeaderAuth: { id: '3CNvCGWMMDOyGD2n', name: 'EspoCRM Integração n8n — Mayara' } };
const CANAL_ENVIAR = { __rl: true, value: 'SHLZkNqfbCrs2OSQ', mode: 'list', cachedResultName: 'Mayara — Canal: Enviar [Sub-workflow]' };
const OPCOES_IF = { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 };
const nid = (n) => `c9000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const campo = (nome) => ({ id: nome, displayName: nome, required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true });
const regra = (valor) => ({
  conditions: { options: OPCOES_IF, conditions: [{ id: 'r-' + valor, leftValue: '={{ $json.tipo }}', rightValue: valor, operator: { type: 'string', operation: 'equals' } }], combinator: 'and' },
  renameOutput: true, outputKey: valor,
});
const se = (n, nome, pos, esquerda) => ({ id: nid(n), name: nome, type: 'n8n-nodes-base.if', typeVersion: 2.2, position: pos,
  parameters: { conditions: { options: OPCOES_IF, conditions: [{ id: 'p' + n, leftValue: esquerda, rightValue: true, operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' }, options: {} } });

export const classificarJs = corpoNode(RODAPE_CLASSIFICAR);
const D = "$('Decidir Proposta').first().json.d";
const novosNos = [
  { id: nid(1), name: 'Decidir Proposta', type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [1400, 1160], credentials: PG, onError: 'continueErrorOutput',
    parameters: { operation: 'executeQuery', query: 'select mayara.decidir_proposta($1, $2::bigint, $3, $4) as d',
      options: { queryReplacement: "={{ [$json.op, $json.id || null, $json.texto || '', $json.phone] }}" } } },
  se(2, 'Enviar?', [1620, 1160], "={{ $json.d.acao === 'enviar' }}"),
  { id: nid(3), name: 'Resposta Proposta', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1840, 1260], parameters: { jsCode: 'return [{ json: { resposta: $json.d.resposta } }];' } },
  { id: nid(4), name: 'Enviar Primeiro Contato', type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.3, position: [1840, 1060], onError: 'continueRegularOutput',
    parameters: { workflowId: CANAL_ENVIAR, options: { waitForSubWorkflow: true },
      workflowInputs: { mappingMode: 'defineBelow', matchingColumns: [], attemptToConvertTypes: false, convertFieldsToString: true,
        value: { canalId: 'escritorio', para: '={{ $json.d.destino }}', tipo: 'texto', texto: '={{ $json.d.texto }}', templateNome: '', templateVariaveis: '', identificarMayara: 'true', origem: 'abordagem_assistida' },
        schema: ['canalId', 'para', 'tipo', 'texto', 'templateNome', 'templateVariaveis', 'identificarMayara', 'origem'].map(campo) } } },
  { id: nid(5), name: 'Casar Envio', type: 'n8n-nodes-base.code', typeVersion: 2, position: [2060, 1060],
    parameters: { jsCode: `const d = ${D};\nconst r = $input.first().json;\nconst ok = r.ok === true;\nconst erro = ok ? '' : String((r.error && r.error.message) || r.message || 'falha_no_envio').slice(0, 200);\nreturn [{ json: { id: d.id, ok, erro, crmLeadId: d.crm_lead_id || '', nome: d.nome || '' } }];` } },
  { id: nid(6), name: 'Confirmar Envio', type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [2280, 1160], credentials: PG,
    parameters: { operation: 'executeQuery', query: 'select mayara.finalizar_envio_proposta($1::bigint, $2::boolean, $3) as resposta',
      options: { queryReplacement: '={{ [$json.id, $json.ok, $json.erro] }}' } } },
  se(7, 'Enviado?', [2280, 960], "={{ $json.ok === true && $json.crmLeadId !== '' }}"),
  { id: nid(8), name: 'Atualizar CRM', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4, position: [2500, 960], credentials: CRM, onError: 'continueRegularOutput',
    parameters: { method: 'PUT', url: "=https://crm.camparimadvogados.com.br/api/v1/Lead/{{ $json.crmLeadId }}", authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
      sendBody: true, specifyBody: 'json', jsonBody: "={{ ({ cFirstResponseAt: new Date().toISOString().slice(0, 19).replace('T', ' ') }) }}", options: { timeout: 30000 } } },
  { id: nid(9), name: 'Nota no CRM', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4, position: [2720, 960], credentials: CRM, onError: 'continueRegularOutput',
    parameters: { method: 'POST', url: 'https://crm.camparimadvogados.com.br/api/v1/Note', authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
      sendBody: true, specifyBody: 'json', jsonBody: "={{ ({ parentType: 'Lead', parentId: $('Casar Envio').first().json.crmLeadId, type: 'Post', post: 'Primeiro contato enviado pela Mayara (abordagem assistida).' }) }}", options: { timeout: 30000 } } },
];

const ligacoes = [
  ['Roteador', 'Decidir Proposta', { sourceIndex: 5 }],
  ['Decidir Proposta', 'Enviar?', { sourceIndex: 0 }],
  ['Decidir Proposta', 'Falha', { sourceIndex: 1 }],
  ['Enviar?', 'Enviar Primeiro Contato', { branch: 'true' }],
  ['Enviar?', 'Resposta Proposta', { branch: 'false' }],
  ['Resposta Proposta', 'Finalizar', {}],
  ['Enviar Primeiro Contato', 'Casar Envio', {}],
  ['Casar Envio', 'Confirmar Envio', {}],
  ['Casar Envio', 'Enviado?', {}],
  ['Confirmar Envio', 'Finalizar', {}],
  ['Enviado?', 'Atualizar CRM', { branch: 'true' }],
  ['Atualizar CRM', 'Nota no CRM', {}],
];

export function operacoes() {
  const regras = ['sql', 'texto', 'modo', 'status', 'livre', 'proposta'].map(regra);
  return [
    { type: 'updateNode', nodeName: 'Roteador', updates: { 'parameters.rules.values': regras } },
    ...novosNos.map((node) => ({ type: 'addNode', node })),
    ...ligacoes.map(([source, target, extra]) => ({ type: 'addConnection', source, target, ...extra })),
  ];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(join(dir, 'classificar.node.js'), classificarJs);
  writeFileSync(join(dir, 'central-patch.json'), JSON.stringify(operacoes(), null, 2));
  console.log('classificar.node.js (' + classificarJs.length + ' caracteres) e central-patch.json (' + operacoes().length + ' operacoes)');
}
```

- [ ] **Step 2: Gerar e conferir**

Run: `node docs/superpowers/specs/2026-10-09-abordagem-assistida/gerar-central-patch.mjs`
Expected: `classificar.node.js (... caracteres) e central-patch.json (22 operacoes)`. Conferir que `classificar.node.js` contém `proposta_aprovar` e `ctx.proposta_unica`.

- [ ] **Step 3: Aplicar no n8n ao vivo, em chamadas pequenas**

Em ordem, relendo a estrutura (`n8n_get_workflow`, `mode: "structure"`) entre as chamadas:
1. `updateNode` do nó `Classificar`, `updates: { "parameters.jsCode": <conteúdo de classificar.node.js> }`. Se o payload fechar a conexão após 3 tentativas, entregar `classificar.node.js` ao usuário para colar no nó **Classificar** pela interface (substituindo todo o código) e seguir.
2. `updateNode` do `Roteador` (primeira operação de `central-patch.json`).
3. Os 9 `addNode`, um por chamada ou em grupos de 3.
4. As 12 `addConnection`. Se `sourceIndex`/`branch` não forem aceitos pela ferramenta, usar `addConnection` com `sourcePort`/`targetPort` equivalentes e verificar o resultado na estrutura.
Expected: a estrutura final mostra `Roteador` com 6 saídas, a saída 6 ligada a `Decidir Proposta`, e `Finalizar` com cinco entradas (as antigas `Executar SQL`, `Resposta Modo`, `Compor Status`, `E SQL?`, `Roteador` saída 2, mais `Resposta Proposta` e `Confirmar Envio`).

- [ ] **Step 4: Teste do ramo sem envio real**

Pelo banco, criar uma proposta de teste para um telefone fictício (chave **desligada** não impede o ramo):

```sql
select mayara.criar_proposta('+5511999990999', 'Teste Fluxo', '', 'Boa tarde, Teste. Aqui é a Mayara, do Camparim Advogados. Com qual banco ou instituição financeira é esse contrato?', '{}'::jsonb, 'banco');
```
Do WhatsApp do administrador, enviar `propostas` e depois `não <id>`.
Expected: `propostas` lista `#<id> Teste Fluxo (final 0999)`; `não <id>` responde "Ok, descartei a proposta <id>. Nada foi enviado."; o estado vira `descartada`. **Não enviar `sim` nesta etapa.**

- [ ] **Step 5: Reexportar a Central ao vivo e commitar**

Run: `n8n_get_workflow` (`mode: "full"`) da Central e gravar o JSON em `docs/superpowers/specs/workflows/mayara-central-de-comando.json` (substituindo o arquivo, depois de conferir que ele contém `Decidir Proposta`).

```bash
git add docs/superpowers/specs/2026-10-09-abordagem-assistida/ docs/superpowers/specs/workflows/mayara-central-de-comando.json
git commit -m "feat(abordagem): ramo de propostas na Central de Comando"
```

---

### Task 6: Gatilho no sub-workflow de captura do grupo

**Files:**
- Modify: `docs/superpowers/specs/2026-10-07-lead-grupo-agencia/gerar-workflow.mjs`
- Modify: `docs/superpowers/specs/workflows/mayara-lead-grupo-agencia.json` (regenerado)

**Interfaces:**
- Consumes: `PROPOR_ID` (Task 4); a saída do nó `Criou?` (ramo verdadeiro: `$json.id` é o id do lead criado no CRM) e o nó `Decidir` (`lead` com `telefone`, `nome`, campos do card).
- Produces: nó `Propor Abordagem` (Execute Workflow, não espera o resultado) ligado ao ramo verdadeiro de `Criou?`, em paralelo a `Registrar Criado`.

- [ ] **Step 1: Alterar o gerador**

Em `gerar-workflow.mjs`, acrescentar a constante e o nó e a ligação:

```js
const PROPOR = { __rl: true, value: '<PROPOR_ID>', mode: 'list', cachedResultName: 'Mayara — Abordagem: Propor [Sub-workflow]' };
```
(substituir `<PROPOR_ID>` pelo id real registrado na Task 4), o nó (dentro de `nodes`, depois de `Registrar Criado`):

```js
  { id: 'f4000000-0000-4000-8000-000000000025', name: 'Propor Abordagem', type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.3, position: [1760, 40], onError: 'continueRegularOutput',
    parameters: { workflowId: PROPOR, options: { waitForSubWorkflow: false },
      workflowInputs: { mappingMode: 'defineBelow', matchingColumns: [], attemptToConvertTypes: false, convertFieldsToString: false,
        value: { lead: "={{ $('Decidir').first().json.lead }}", crmLeadId: '={{ $json.id }}' },
        schema: [{ id: 'lead', displayName: 'lead', required: false, defaultMatch: false, display: true, type: 'object', canBeUsedToMatch: true }, { id: 'crmLeadId', displayName: 'crmLeadId', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }] } } },
```
e, em `connections`, trocar a entrada de `Criou?` por:
```js
  'Criou?': { main: [[{ node: 'Registrar Criado', type: 'main', index: 0 }, { node: 'Propor Abordagem', type: 'main', index: 0 }], [{ node: 'Montar Alerta Falha', type: 'main', index: 0 }, { node: 'Registrar Falha CRM', type: 'main', index: 0 }]] },
```

- [ ] **Step 2: Regenerar e testar a biblioteca do cartão**

Run: `node docs/superpowers/specs/2026-10-07-lead-grupo-agencia/gerar-workflow.mjs && node --test docs/superpowers/specs/2026-10-07-lead-grupo-agencia/lead-grupo.test.mjs`
Expected: workflow gravado e `pass 16`, `fail 0`. Conferir no JSON que `Criou?` tem duas ligações no ramo verdadeiro.

- [ ] **Step 3: Aplicar no n8n ao vivo (operações pequenas)**

No sub-workflow `LkiVmBMUzRm8q9Re`: `addNode` do `Propor Abordagem` e `addConnection` de `Criou?` (ramo `true`) para ele.
Expected: a estrutura mostra o novo nó ligado ao ramo verdadeiro de `Criou?`, e `Registrar Criado` continua ligado. A criação do lead no CRM não é afetada: `waitForSubWorkflow` é `false` e `onError` é `continueRegularOutput`.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-10-07-lead-grupo-agencia/gerar-workflow.mjs docs/superpowers/specs/workflows/mayara-lead-grupo-agencia.json
git commit -m "feat(abordagem): captura do grupo aciona a proposta de abordagem"
```

---

### Task 7: Aceite com leads de teste, liberação da chave e registro

**Files:**
- Modify: `docs/superpowers/specs/2026-10-09-abordagem-assistida-design.md`

- [ ] **Step 1: Ativar `Notificar` e ligar a chave para o teste (com a OK do usuário)**

Pedir a confirmação do usuário antes de ligar. Depois: `n8n_update_partial_workflow` `activateWorkflow` em `NOTIFICAR_ID` e
```sql
update mayara.config set valor = 'true' where chave = 'abordagem_assistida' returning chave, valor;
```
Expected: `Notificar` ativo; chave `true`.

- [ ] **Step 2: Fluxo de notificação, edição e descarte (sem envio a lead real)**

```sql
select mayara.criar_proposta('+5511999990998', 'Teste Aceite', '', 'Boa tarde, Teste. Aqui é a Mayara, do Camparim Advogados. Com qual banco ou instituição financeira é esse contrato?', '{}'::jsonb, 'banco');
```
Dentro de 1 a 2 minutos o administrador recebe a notificação no WhatsApp (se for entre 6h e 21h). Responder `editar <id>: Boa tarde. Aqui é a Mayara. Qual banco?`, conferir a resposta de texto atualizado e responder `não <id>`.
Expected: notificação recebida uma única vez (sem repetição no minuto seguinte); `editar` devolve o texto novo com as instruções `sim`/`não`; `não` descarta (`estado = 'descartada'`).

- [ ] **Step 3: Ambiguidade e prioridade**

Criar duas propostas de teste (`+5511999990996` e `+5511999990997`), e do WhatsApp enviar `sim`.
Expected: a Central responde "Há 2 propostas abertas. Responda sim <número> ou não <número>..." e **nada é enviado**. Responder `não <id>` para cada uma.

- [ ] **Step 4: Leads reais**

Com o próximo lead real criado pelo grupo da agência (ou, se o usuário quiser, abordando um lead existente que ele indicar), conferir: (a) a proposta chega ao WhatsApp com o texto no modelo aprovado e a pergunta correta (banco, se o card trouxe o tipo; contratos, se não trouxe); (b) `sim <id>` envia e responde "Enviei a mensagem para ..."; (c) `select estado from mayara.propostas_abordagem where id = <id>` é `enviada`; (d) a memória tem a fala da Mayara (`select message ->> 'content' from public.n8n_chat_histories where session_id = 'whatsapp:escritorio:<telefone>' order by id desc limit 1`); (e) no CRM o lead tem `cFirstResponseAt` preenchido e a nota; (f) quando o lead responde, a Mayara atende pelo fluxo normal, sem repetir a pergunta nem perguntar o que o card já disse.
Expected: todos os itens confirmados. Qualquer divergência vira correção antes de seguir.

- [ ] **Step 5: Decisão sobre a chave e limpeza**

Perguntar ao usuário se deixa `abordagem_assistida` ligada. Se não, `update mayara.config set valor = 'false' where chave = 'abordagem_assistida'`. Lembrar da limpeza das propostas de teste (já descartadas) e dos workflows temporários antigos listados no ledger do projeto.

- [ ] **Step 6: Registrar na especificação e commitar**

Na seção "Fases" de `2026-10-09-abordagem-assistida-design.md`, acrescentar à Fase 3 a linha `Concluída em <data> (workflows Propor e Notificar, ramo de propostas na Central, gatilho na captura do grupo; texto de modelo sem IA)` e a decisão: "Nesta versão a IA não redige o texto; o modelo determinístico é usado."

```bash
git add docs/superpowers/specs/2026-10-09-abordagem-assistida-design.md
git commit -m "docs(abordagem): Fase 3 concluida"
```
