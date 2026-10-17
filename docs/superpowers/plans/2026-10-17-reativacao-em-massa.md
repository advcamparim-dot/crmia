# Reativação Individual de Leads com Aprovação Mensagem por Mensagem: Plano de Execução

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cadastrar na lista da Mayara os leads do CRM que estão fora dela, preparar uma mensagem de reativação individual por lead (pelo contexto), apresentar uma a uma ao administrador, enviar só as aprovadas no ritmo combinado e integrar cada lead à régua de follow-up depois do envio.

**Architecture:** Reaproveita a abordagem assistida (`propostas_abordagem`, `sim N`, `Canal: Enviar`) e a régua existente. Uma tabela nova (`mayara.reativacao`) guarda o estado de cada lead; uma "porta de entrada" impede que a régua trate lead ainda não reativado; a aprovação de uma proposta de reativação só **agenda** (não abre janela nem envia); um worker libera os aprovados no horário, no limite diário e com intervalo mínimo, abrindo a janela de 24 h no momento do envio. O envio sai com `origem = 'reativacao'`, e a régua deriva ciclo e sequência desse envio (código existente em `_ultima_saida` e `followups_elegiveis`).

**Tech Stack:** Postgres/plpgsql (Supabase), n8n 2.x, Node.js (`node:test`), Evolution API.

**Spec:** `docs/superpowers/specs/2026-10-16-reativacao-em-massa-design.md`

## Como este plano está organizado

Seguindo o que foi feito na abordagem assistida e no follow-up, este é o **plano mestre**: fixa regras globais, ordem, interfaces entre as fases e o foco de revisão, e traz a **Fase 1 (banco) completa, com código e testes**. As Fases 2 a 7 estão descritas por tarefa (objetivo, arquivos, interfaces, testes), e **o plano detalhado de cada uma é escrito quando a fase anterior termina**, com a sua aprovação, porque dependem do que a anterior efetivamente produzir (por exemplo, o formato real das exportações do WhatsApp). Nenhuma fase envia mensagem a lead antes da Fase 5, e nenhuma ativa a régua ou desliga a retenção antes da Fase 7.

## Global Constraints

- **Aprovação:** cada fase começa só depois da aprovação do plano da fase. Ao concluir cada fase, atualizar `docs/handoffs/claude-status.md` (objetivo, arquivos, testes, resultado, pendências, riscos) **sem nomes, telefones ou textos de clientes**.
- **Nada para lead sem aprovação por mensagem.** Não existe caminho de envio automático da primeira mensagem. `reativacao_ligada` começa `false` e só é ligada por pedido explícito do administrador (Fase 5).
- **Dados de clientes fora do Git.** Exportações, rascunhos e contexto ficam no banco ou em `dados-privados/` (a pasta entra no `.gitignore` na Fase 2). Testes usam nomes e telefones sintéticos (`+551199999xxxx`).
- **Migrations:** numeração a partir de `0056`. Testes SQL em `supabase/tests/NNNN_*.test.sql`, dentro de `begin; ... rollback;`, terminando com `select 'OK NNNN';`. Funções com `set search_path = ''` e `revoke all ... from public, anon, authenticated`. A ferramenta SQL recusa `delete`, `drop` e `update` sem `where`.
- **Telefone:** a lista de atendimento exige `telefone ~ '^\+55[0-9]{10,11}$'`. Identidade de lead é sempre `mayara.chave_telefone(...)` (10 dígitos: DDD mais os 8 finais), nunca o número cru.
- **Sessão do lead:** gravar memória sempre pela sessão canônica (`mayara.sessao_do_lead`), nunca por `'whatsapp:escritorio:' || telefone`.
- **Horário e limites:** horário de atendimento = `mayara.resposta_permitida()` (dias úteis 6h às 21h, sábados 6h às 18h, sem domingos e feriados). `reativacao_limite_dia = 10`, `reativacao_intervalo_min = 25`. Ordem de envio: `ordem_chegada` decrescente (CRM mais recente primeiro).
- **n8n:** n8n-mcp é instável ("Connection closed" pode ter aplicado a mudança): reler por GET (REST) antes de repetir. Alteração em workflow vivo segue o padrão já usado: baixar o JSON vivo, aplicar o patch gerado e testado, PUT, GET para conferir, reexportar para `docs/superpowers/specs/workflows/`. A chave da API do n8n está em `~/.claude.json` e nunca é impressa nem gravada. Escrita em credenciais do n8n é bloqueada pelo ambiente: não tentar contornar.
- **Commits** terminam com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Porta de entrada da régua:** lead da reativação que não foi integrado, ou que foi descartado, pulado, sem WhatsApp ou falhou, **nunca** aparece em `followups_elegiveis`; só entra quem foi enviado ou quem respondeu por conta própria.
2. **Aprovar não envia nem abre janela:** `sim N` em proposta de reativação só agenda. A janela de 24 h (`abordagem_ate`) abre no momento do envio, dentro de `reativacao_proximo_envio`.
3. **Cota e intervalo sob concorrência:** duas execuções do worker ao mesmo tempo nunca liberam dois leads dentro do intervalo nem passam do limite diário (`for update skip locked` e estado `enviando`).
4. **Cadastro idempotente e seguro:** rodar duas vezes não duplica; ignora administrador e telefone inválido; um telefone com dois cadastros no CRM vira um lead só (o mais recente); lead assumido volta para `ativo`; lead `sem_interesse` nunca é reativado.
5. **Parada automática:** três falhas seguidas (exceto "número sem WhatsApp") desligam `reativacao_ligada`; falha isolada não.
6. **Memória na sessão certa:** a mensagem enviada entra na sessão canônica, inclusive para lead com duas variantes do nono dígito.

## File Structure

- Create: `supabase/migrations/0056_mayara_reativacao_base.sql`, `0057_mayara_reativacao_porta_regua.sql`, `0058_mayara_reativacao_proposta_fila.sql`
- Create: `supabase/tests/0056_reativacao_base.test.sql`, `0057_reativacao_porta_regua.test.sql`, `0058_reativacao_proposta_fila.test.sql`
- Modify (handoff): `docs/handoffs/claude-status.md`
- Fases seguintes (planos próprios): `docs/superpowers/plans/2026-10-NN-reativacao-fase2-importador.md` e demais.

## Visão das fases

| Fase | Entrega | Depende de | Termina quando |
|---|---|---|---|
| **1. Banco (este plano, detalhado)** | Tabelas, cadastro, porta da régua, proposta de reativação, aprovação agendada, fila, registro de envio, sincronização | nada | `OK 0056`, `OK 0057`, `OK 0058` e regressão verde |
| 2. Importador | Lê exportações do WhatsApp, liga ao lead com confirmação, grava contexto | Fase 1 | Tabela de ligações confirmada pelo administrador e contexto gravado |
| 3. Redação | `reativar.mjs`, validação, workflow `Reativação: Preparar` (simulação) | Fases 1 e 2 | Rascunhos válidos para os 69, em simulação |
| 4. Apresentação | Uma proposta por vez, texto com fonte do contexto, `ver N` | Fases 1 e 3 | Aceite pelo WhatsApp com um lead de teste |
| 5. Envio | Workflow `Reativação: Enviar`, nono dígito, parada automática, origem `reativacao` | Fases 1, 3 e 4 | Piloto de 3 leads aprovados e enviados |
| 6. Comandos | `/reativacao status|pausar|retomar`, consulta no modo livre, runbook | Fase 5 | Comandos validados |
| 7. Saída da retenção | Desligar `respostas_retidas` e ligar `followup_modo`, por decisão do administrador | Fases 1 a 6 | Todos integrados ou em estado final |

## Interfaces entre as fases (produzidas na Fase 1)

- `mayara.reativacao` (tabela) com estados `cadastrado`, `contexto_pronto`, `rascunho`, `proposta_aberta`, `aprovado`, `enviando`, `enviado`, `respondeu`, `sem_interesse`, `sem_whatsapp`, `falhou`, `descartado`, `pulado`; `integrado_em` marca a integração à régua (preenchido no envio). *Desvio do spec, registrado:* o estado final positivo é `enviado` (com `integrado_em`), sem um estado `integrado` separado.
- `mayara.contexto_reativacao` (tabela): `reativacao_id`, `fonte` (`exportacao`, `memoria`, `crm`), `linhas jsonb` (`[{quando, quem, texto}]`), `confirmado_por`, `confirmado_em`.
- `mayara.reativacao_cadastrar() returns jsonb` (`novos`, `da_lista`, `devolvidos`, `ignorados`).
- `mayara.reativacao_vagas(p_agora) returns int`: quantas propostas ainda podem ser abertas hoje.
- `mayara.reativacao_resumo() returns jsonb`.
- `mayara.reativacao_criar_proposta(p_reativacao_id, p_texto, p_fatos) returns jsonb`.
- `mayara.reativacao_proximo_envio(p_agora) returns jsonb`: `{enviar: bool, motivo, proposta_id, reativacao_id, destino, variante, texto, nome, crm_lead_id}`.
- `mayara.reativacao_registrar_envio(p_proposta_id, p_ok, p_erro, p_sem_whatsapp) returns jsonb`: `{estado, pausada}`.
- `mayara.reativacao_sincronizar(p_agora) returns jsonb`.
- Proposta com `tipo = 'reativacao'` e `reativacao_id`; `decidir_proposta` responde "agendada" em vez de pedir envio imediato.

---

## Fase 1: Banco

### Task 1: Tabelas, configuração e cadastro dos leads

**Files:**
- Create: `supabase/migrations/0056_mayara_reativacao_base.sql`
- Test: `supabase/tests/0056_reativacao_base.test.sql`

**Interfaces:**
- Consumes: `crm_sync.leads(id, name, status, created_at, modified_at, phone)`; `mayara.leads_autorizados`; `mayara.administradores(telefone_chave)`; `mayara.devolver_lead(telefone) returns text`; `mayara.chave_telefone(text)`; `mayara.envios_log(origem, ok, criado_em, destino_chave)`.
- Produces: tabelas `mayara.reativacao` e `mayara.contexto_reativacao`; colunas `tipo` e `reativacao_id` em `propostas_abordagem`; `mayara._telefone_canonico`, `reativacao_cadastrar`, `reativacao_vagas`, `reativacao_resumo`; chaves de configuração.

Regras de `reativacao_cadastrar`:
- Percorre `crm_sync.leads` com telefone válido, **um por chave de telefone** (o de `created_at` mais recente), ignorando quem já tem linha em `reativacao`, administrador e telefone que não vira `+55...` válido.
- Lead que **não** está na lista: entra em `leads_autorizados` com `status = 'ativo'`, `origem = 'reativacao_crm'`, `abordagem_ate` nulo, e ganha linha em `reativacao` (`origem = 'crm_fora_da_lista'`, `ordem_chegada = created_at` do CRM).
- Lead que **já está** na lista: ganha linha (`origem = 'lista'`); se `bloqueado`, é devolvido (`devolver_lead`); se `sem_interesse`, a linha nasce `sem_interesse`.
- Depois percorre `leads_autorizados` que ainda não têm linha (leads que não estão no CRM) e aplica a mesma regra (`ordem_chegada = criado_em`).
- Nunca cria estado de régua e nunca preenche `abordagem_ate`.

- [ ] **Step 1: Escrever o teste SQL (deve falhar)**

```sql
-- supabase/tests/0056_reativacao_base.test.sql
begin;
do $t$
declare j jsonb; j2 jsonb; n int; r mayara.reativacao%rowtype;
begin
  insert into crm_sync.leads (id, name, status, created_at, modified_at, phone) values
    ('t-701', 'Reativa Novo Um',        'New', now() - interval '3 days',  now(), '+5511999990701'),
    ('t-702', 'Reativa Novo Dois',      'New', now() - interval '10 days', now(), '+5511999990702'),
    ('t-703', 'Reativa Duplicado Velho','New', now() - interval '20 days', now(), '+5511999990703'),
    ('t-704', 'Reativa Duplicado Novo', 'New', now() - interval '2 days',  now(), '+5511999990703'),
    ('t-705', 'Reativa Invalido',       'New', now(),                      now(), '123'),
    ('t-706', 'Reativa Administrador',  'New', now(),                      now(), '+5511999990706'),
    ('t-707', 'Reativa Assumido',       'New', now() - interval '5 days',  now(), '+5511999990707'),
    ('t-708', 'Reativa Parou',          'New', now() - interval '6 days',  now(), '+5511999990708');
  insert into mayara.administradores (telefone, telefone_chave, nome) values ('+5511999990706', mayara.chave_telefone('+5511999990706'), 'Admin Teste');
  insert into mayara.leads_autorizados (telefone, nome, status) values
    ('+5511999990707', 'Reativa Assumido', 'bloqueado'),
    ('+5511999990708', 'Reativa Parou', 'sem_interesse'),
    ('+5511999990709', 'Reativa So Lista', 'ativo');
  insert into mayara.session_state (session_key, phone, estado) values ('whatsapp:escritorio:+5511999990707', '+5511999990707', 'S7_HANDOFF_HUMANO');

  j := mayara.reativacao_cadastrar();
  assert (j ->> 'novos')::int >= 3, 'novos: ' || j::text;

  -- lead novo do CRM: entra na lista sem janela e sem regua
  select * into r from mayara.reativacao where telefone_chave = mayara.chave_telefone('+5511999990701');
  assert r.origem = 'crm_fora_da_lista' and r.estado = 'cadastrado' and r.crm_lead_id = 't-701', 'novo um: ' || coalesce(r.estado, 'sem linha');
  assert abs(extract(epoch from (r.ordem_chegada - (now() - interval '3 days')))) < 5, 'ordem_chegada = created_at do CRM';
  assert exists (select 1 from mayara.leads_autorizados l where l.telefone = '+5511999990701' and l.status = 'ativo'
                   and l.abordagem_ate is null and l.origem = 'reativacao_crm' and l.espocrm_lead_id = 't-701'), 'lead na lista, ativo, sem abordagem';
  assert not exists (select 1 from mayara.followup_estado f where f.chave = mayara.chave_telefone('+5511999990701')), 'sem estado de regua';

  -- telefone duplicado no CRM: um lead so, o mais recente
  select count(*) into n from mayara.reativacao where telefone_chave = mayara.chave_telefone('+5511999990703');
  assert n = 1 and (select crm_lead_id from mayara.reativacao where telefone_chave = mayara.chave_telefone('+5511999990703')) = 't-704', 'duplicado fica com o mais recente';

  -- invalido e administrador ficam de fora
  assert not exists (select 1 from mayara.reativacao where crm_lead_id in ('t-705', 't-706')), 'invalido e administrador ignorados';
  assert not exists (select 1 from mayara.leads_autorizados where telefone_chave = mayara.chave_telefone('+5511999990706')), 'administrador nao entra na lista';

  -- assumido volta para a Mayara; sem_interesse nunca e reativado
  assert (select status from mayara.leads_autorizados where telefone = '+5511999990707') = 'ativo', 'assumido devolvido';
  assert (select estado from mayara.session_state where session_key = 'whatsapp:escritorio:+5511999990707') = 'S2_QUALIFICACAO', 'sessao do assumido reaberta';
  assert (select origem from mayara.reativacao where telefone_chave = mayara.chave_telefone('+5511999990707')) = 'lista', 'assumido: origem lista';
  assert (select estado from mayara.reativacao where telefone_chave = mayara.chave_telefone('+5511999990708')) = 'sem_interesse', 'sem_interesse nasce final';
  assert (select status from mayara.leads_autorizados where telefone = '+5511999990708') = 'sem_interesse', 'status sem_interesse preservado';

  -- lead que so existe na lista tambem entra
  select * into r from mayara.reativacao where telefone_chave = mayara.chave_telefone('+5511999990709');
  assert r.origem = 'lista' and r.estado = 'cadastrado', 'so lista: ' || coalesce(r.estado, 'sem linha');

  -- idempotente
  select count(*) into n from mayara.reativacao;
  j2 := mayara.reativacao_cadastrar();
  assert (j2 ->> 'novos')::int = 0 and (j2 ->> 'da_lista')::int = 0 and (j2 ->> 'devolvidos')::int = 0, 'segunda rodada nao cria nada: ' || j2::text;
  assert (select count(*) from mayara.reativacao) = n, 'sem duplicatas';

  -- telefone canonico
  assert mayara._telefone_canonico('(11) 99999-0701') = '+5511999990701', 'canonico com mascara';
  assert mayara._telefone_canonico('5511999990701') = '+5511999990701', 'canonico com 55';
  assert mayara._telefone_canonico('+1 202 555 0100') is null or mayara._telefone_canonico('+1 202 555 0100') = '+5512025550100', 'canonico documentado';
  assert mayara._telefone_canonico('123') is null and mayara._telefone_canonico(null) is null, 'canonico invalido';

  -- vagas e resumo
  update mayara.config set valor = '10' where chave = 'reativacao_limite_dia';
  insert into mayara.envios_log (canal_id, destino_chave, tipo, ok, provedor_message_id, origem)
    select 'escritorio', mayara.chave_telefone('+5511999990701'), 'texto', true, 'RV' || g, 'reativacao' from generate_series(1, 3) g;
  assert mayara.reativacao_vagas(now()) = 7, 'vagas = limite - enviados hoje: ' || mayara.reativacao_vagas(now());
  j := mayara.reativacao_resumo();
  assert (j ->> 'enviados_hoje')::int = 3 and (j ->> 'limite_dia')::int = 10 and (j ->> 'vagas')::int = 7, 'resumo: ' || j::text;
  assert (j -> 'por_estado' ->> 'cadastrado')::int >= 3, 'resumo por estado: ' || j::text;

  -- seguranca de acesso
  assert not has_function_privilege('anon', 'mayara.reativacao_cadastrar()', 'execute'), 'anon sem execute';
  assert (select valor from mayara.config where chave = 'reativacao_ligada') = 'false', 'reativacao nasce desligada';
end $t$;
rollback;
select 'OK 0056';
```

(O teste do telefone `+1...` aceita as duas saídas de propósito: a regra é "10 ou 11 dígitos viram +55"; o que importa é nunca devolver um valor que viole a restrição da tabela. Se a implementação devolver `null`, o teste passa; se devolver `+5512025550100`, também.)

- [ ] **Step 2: Rodar e ver falhar**

Run: o teste acima com `execute_sql` (projeto `wuhvlvsolewslkawazlq`).
Expected: ERRO `function mayara.reativacao_cadastrar() does not exist`.

- [ ] **Step 3: Escrever a migration**

```sql
-- supabase/migrations/0056_mayara_reativacao_base.sql
insert into mayara.config (chave, valor) values
  ('reativacao_ligada', 'false'),
  ('reativacao_limite_dia', '10'),
  ('reativacao_intervalo_min', '25')
on conflict (chave) do nothing;

create table mayara.reativacao (
  id bigserial primary key,
  telefone_chave text not null unique,
  telefone text not null,
  nome text,
  crm_lead_id text,
  origem text not null check (origem in ('crm_fora_da_lista', 'lista')),
  fonte_contexto text check (fonte_contexto in ('crm', 'exportacao', 'memoria')),
  estado text not null default 'cadastrado' check (estado in (
    'cadastrado', 'contexto_pronto', 'rascunho', 'proposta_aberta', 'aprovado', 'enviando', 'enviado',
    'respondeu', 'sem_interesse', 'sem_whatsapp', 'falhou', 'descartado', 'pulado')),
  ordem_chegada timestamptz not null,
  texto_rascunho text,
  proposta_id bigint,
  tentativas int not null default 0,
  motivo text,
  aprovado_em timestamptz,
  enviado_em timestamptz,
  integrado_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index reativacao_estado_idx on mayara.reativacao (estado, ordem_chegada desc);
alter table mayara.reativacao enable row level security;
revoke all on mayara.reativacao from anon, authenticated;

create table mayara.contexto_reativacao (
  id bigserial primary key,
  reativacao_id bigint not null references mayara.reativacao (id) on delete cascade,
  fonte text not null check (fonte in ('exportacao', 'memoria', 'crm')),
  linhas jsonb not null default '[]'::jsonb,
  confirmado_por text,
  confirmado_em timestamptz,
  importado_em timestamptz not null default now()
);
create unique index contexto_reativacao_uma_por_fonte on mayara.contexto_reativacao (reativacao_id, fonte);
alter table mayara.contexto_reativacao enable row level security;
revoke all on mayara.contexto_reativacao from anon, authenticated;

alter table mayara.propostas_abordagem
  add column if not exists tipo text not null default 'abordagem' check (tipo in ('abordagem', 'reativacao')),
  add column if not exists reativacao_id bigint;

create or replace function mayara._telefone_canonico(p_texto text)
returns text language sql immutable set search_path = '' as $$
  select case
           when x.d ~ '^55[0-9]{10,11}$' then '+' || x.d
           when x.d ~ '^[0-9]{10,11}$' then '+55' || x.d
           else null
         end
    from (select regexp_replace(coalesce(p_texto, ''), '\D', '', 'g') as d) x
$$;

create or replace function mayara.reativacao_cadastrar()
returns jsonb language plpgsql set search_path = '' as $$
declare
  r record; l record;
  v_chave text; v_tel text; v_status text;
  v_novos int := 0; v_lista int := 0; v_devolvidos int := 0; v_ignorados int := 0;
begin
  for r in
    select distinct on (mayara.chave_telefone(c.phone)) c.id, c.name, c.phone, c.created_at
      from crm_sync.leads c
     where mayara.chave_telefone(c.phone) is not null
     order by mayara.chave_telefone(c.phone), c.created_at desc
  loop
    v_chave := mayara.chave_telefone(r.phone);
    if exists (select 1 from mayara.reativacao x where x.telefone_chave = v_chave) then
      continue;
    end if;
    if exists (select 1 from mayara.administradores a where a.telefone_chave = v_chave) then
      v_ignorados := v_ignorados + 1;
      continue;
    end if;
    select la.telefone, la.status into v_tel, v_status from mayara.leads_autorizados la where la.telefone_chave = v_chave;
    if v_status is null then
      v_tel := mayara._telefone_canonico(r.phone);
      if v_tel is null then
        v_ignorados := v_ignorados + 1;
        continue;
      end if;
      insert into mayara.leads_autorizados (telefone, nome, origem, espocrm_lead_id)
      values (v_tel, nullif(btrim(r.name), ''), 'reativacao_crm', r.id);
      insert into mayara.reativacao (telefone_chave, telefone, nome, crm_lead_id, origem, ordem_chegada)
      values (v_chave, v_tel, nullif(btrim(r.name), ''), r.id, 'crm_fora_da_lista', r.created_at);
      v_novos := v_novos + 1;
    else
      if v_status = 'bloqueado' then
        perform mayara.devolver_lead(v_tel);
        v_devolvidos := v_devolvidos + 1;
        v_status := 'ativo';
      end if;
      insert into mayara.reativacao (telefone_chave, telefone, nome, crm_lead_id, origem, estado, ordem_chegada)
      values (v_chave, v_tel, nullif(btrim(r.name), ''), r.id, 'lista',
              case when v_status = 'sem_interesse' then 'sem_interesse' else 'cadastrado' end, r.created_at);
      v_lista := v_lista + 1;
    end if;
  end loop;

  for l in
    select la.telefone, la.telefone_chave, la.nome, la.status, la.espocrm_lead_id, la.criado_em
      from mayara.leads_autorizados la
     where not exists (select 1 from mayara.reativacao x where x.telefone_chave = la.telefone_chave)
       and not exists (select 1 from mayara.administradores a where a.telefone_chave = la.telefone_chave)
  loop
    v_status := l.status;
    if v_status = 'bloqueado' then
      perform mayara.devolver_lead(l.telefone);
      v_devolvidos := v_devolvidos + 1;
      v_status := 'ativo';
    end if;
    insert into mayara.reativacao (telefone_chave, telefone, nome, crm_lead_id, origem, estado, ordem_chegada)
    values (l.telefone_chave, l.telefone, l.nome, l.espocrm_lead_id, 'lista',
            case when v_status = 'sem_interesse' then 'sem_interesse' else 'cadastrado' end, l.criado_em);
    v_lista := v_lista + 1;
  end loop;

  return jsonb_build_object('novos', v_novos, 'da_lista', v_lista, 'devolvidos', v_devolvidos, 'ignorados', v_ignorados);
end $$;

create or replace function mayara.reativacao_vagas(p_agora timestamptz default now())
returns int language sql stable set search_path = '' as $$
  select greatest(
    coalesce((select valor::int from mayara.config where chave = 'reativacao_limite_dia'), 10)
    - (select count(*) from mayara.envios_log e
        where e.origem = 'reativacao' and e.ok
          and (e.criado_em at time zone 'America/Sao_Paulo')::date = (p_agora at time zone 'America/Sao_Paulo')::date)
    - (select count(*) from mayara.reativacao r where r.estado in ('proposta_aberta', 'aprovado', 'enviando')),
    0)::int
$$;

create or replace function mayara.reativacao_resumo()
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'por_estado', coalesce((select jsonb_object_agg(estado, n) from (select estado, count(*) n from mayara.reativacao group by estado) x), '{}'::jsonb),
    'total', (select count(*) from mayara.reativacao),
    'enviados_hoje', (select count(*) from mayara.envios_log e where e.origem = 'reativacao' and e.ok
                       and (e.criado_em at time zone 'America/Sao_Paulo')::date = (now() at time zone 'America/Sao_Paulo')::date),
    'limite_dia', coalesce((select valor::int from mayara.config where chave = 'reativacao_limite_dia'), 10),
    'vagas', mayara.reativacao_vagas(now()),
    'ligada', coalesce((select valor from mayara.config where chave = 'reativacao_ligada'), 'false') = 'true'
  )
$$;

revoke all on function mayara._telefone_canonico(text) from public, anon, authenticated;
revoke all on function mayara.reativacao_cadastrar() from public, anon, authenticated;
revoke all on function mayara.reativacao_vagas(timestamptz) from public, anon, authenticated;
revoke all on function mayara.reativacao_resumo() from public, anon, authenticated;
```

- [ ] **Step 4: Aplicar a migration (`apply_migration`, nome `mayara_reativacao_base`) e rodar o teste**

Expected: `OK 0056`. Se `_telefone_canonico('+1 202 555 0100')` devolver `+5512025550100`, o teste já aceita; se uma asserção de contagem divergir porque o ambiente tem leads reais além dos sintéticos, comparar apenas as linhas sintéticas (ledger: `Ruling`), nunca relaxar as asserções de idempotência.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0056_mayara_reativacao_base.sql supabase/tests/0056_reativacao_base.test.sql
git commit -m "feat(reativacao): tabelas, configuracao e cadastro dos leads (migration 0056)"
```

---

### Task 2: Porta de entrada da régua

**Files:**
- Create: `supabase/migrations/0057_mayara_reativacao_porta_regua.sql`
- Test: `supabase/tests/0057_reativacao_porta_regua.test.sql`

**Interfaces:**
- Consumes: `mayara._lead_excluido(p_chave, p_agora) returns text` (definição **viva** abaixo, com `liberar_prioridade_juridica`), `mayara.followups_elegiveis(p_agora)`, `mayara.followup_estado`, `mayara.reativacao`.
- Produces: `_lead_excluido` passa a devolver `'aguardando_reativacao'` para lead com linha em `reativacao`, `integrado_em` nulo e estado diferente de `respondeu`.

Regra: lead da reativação só entra na régua se foi integrado (enviado) ou se respondeu por conta própria. `descartado`, `pulado`, `sem_whatsapp`, `falhou`, `sem_interesse` continuam excluídos mesmo que o lead tenha envios antigos.

- [ ] **Step 1: Conferir a definição viva antes de substituir**

Run (`execute_sql`): `select pg_get_functiondef('mayara._lead_excluido(text,timestamptz)'::regprocedure);`
Expected: o corpo é o mesmo do bloco da migration abaixo, **menos** o trecho `aguardando_reativacao`. Se divergir (alguém alterou a função depois de 16/10), parar, reaplicar a diferença no bloco abaixo e registrar `Ruling`.

- [ ] **Step 2: Escrever o teste SQL (deve falhar)**

```sql
-- supabase/tests/0057_reativacao_porta_regua.test.sql
begin;
do $t$
declare
  ca text := mayara.chave_telefone('+5511999990711');  -- cadastrado, nao integrado
  cb text := mayara.chave_telefone('+5511999990712');  -- integrado (enviado)
  cc text := mayara.chave_telefone('+5511999990713');  -- respondeu sozinho
  cd text := mayara.chave_telefone('+5511999990714');  -- descartado
  ce text := mayara.chave_telefone('+5511999990715');  -- fora da reativacao
  ciclo timestamptz := now() - interval '20 days';
  chave text; n int;
begin
  insert into mayara.leads_autorizados (telefone, nome, status) values
    ('+5511999990711', 'Porta A', 'ativo'), ('+5511999990712', 'Porta B', 'ativo'), ('+5511999990713', 'Porta C', 'ativo'),
    ('+5511999990714', 'Porta D', 'ativo'), ('+5511999990715', 'Porta E', 'ativo');
  insert into mayara.reativacao (telefone_chave, telefone, nome, origem, estado, ordem_chegada, integrado_em) values
    (ca, '+5511999990711', 'Porta A', 'lista', 'cadastrado', now(), null),
    (cb, '+5511999990712', 'Porta B', 'lista', 'enviado',    now(), now()),
    (cc, '+5511999990713', 'Porta C', 'lista', 'respondeu',  now(), null),
    (cd, '+5511999990714', 'Porta D', 'lista', 'descartado', now(), null);
  -- todos tiveram uma saida antiga da Mayara e estado de regua, sem resposta do lead
  foreach chave in array array[ca, cb, cc, cd, ce] loop
    insert into mayara.envios_log (canal_id, destino_chave, tipo, ok, provedor_message_id, origem, criado_em)
      values ('escritorio', chave, 'texto', true, 'PR' || chave, 'ponte', ciclo);
    insert into mayara.followup_estado (chave, ciclo_saida, etapa_atual) values (chave, ciclo, 0);
  end loop;

  assert mayara._lead_excluido(ca) = 'aguardando_reativacao', 'cadastrado nao integrado fica de fora: ' || coalesce(mayara._lead_excluido(ca), 'null');
  assert mayara._lead_excluido(cd) = 'aguardando_reativacao', 'descartado continua de fora: ' || coalesce(mayara._lead_excluido(cd), 'null');
  assert mayara._lead_excluido(cb) is null, 'integrado passa: ' || coalesce(mayara._lead_excluido(cb), 'null');
  assert mayara._lead_excluido(cc) is null, 'respondeu passa: ' || coalesce(mayara._lead_excluido(cc), 'null');
  assert mayara._lead_excluido(ce) is null, 'lead fora da reativacao nao muda: ' || coalesce(mayara._lead_excluido(ce), 'null');

  -- na pratica: so os liberados aparecem como elegiveis
  select count(*) into n from mayara.followups_elegiveis(now()) where lead_chave in (ca, cd);
  assert n = 0, 'cadastrado e descartado nunca elegiveis: ' || n;
  select count(*) into n from mayara.followups_elegiveis(now()) where lead_chave in (cb, cc, ce);
  assert n = 3, 'integrado, respondeu e fora da reativacao elegiveis: ' || n;

  -- ao integrar, o lead cadastrado passa a ser elegivel
  update mayara.reativacao set estado = 'enviado', integrado_em = now() where telefone_chave = ca;
  assert mayara._lead_excluido(ca) is null, 'depois de integrar passa';
  select count(*) into n from mayara.followups_elegiveis(now()) where lead_chave = ca;
  assert n = 1, 'depois de integrar e elegivel: ' || n;
end $t$;
rollback;
select 'OK 0057';
```

- [ ] **Step 3: Rodar e ver falhar**

Run: o teste com `execute_sql`.
Expected: FAIL na primeira asserção (`cadastrado nao integrado fica de fora`: hoje devolve `null`).

- [ ] **Step 4: Escrever a migration**

```sql
-- supabase/migrations/0057_mayara_reativacao_porta_regua.sql
-- Porta de entrada da regua: lead da reativacao so entra depois de integrado (enviado) ou se respondeu sozinho.
create or replace function mayara._lead_excluido(p_chave text, p_agora timestamp with time zone default now())
returns text language plpgsql stable set search_path = '' as $$
declare fe mayara.followup_estado%rowtype;
begin
  if not exists (select 1 from mayara.leads_autorizados la where la.telefone_chave = p_chave and la.status = 'ativo') then
    return 'lead_inativo';
  end if;
  if exists (select 1 from mayara.administradores a where a.telefone_chave = p_chave) then
    return 'administrador';
  end if;
  if exists (select 1 from mayara.reativacao r
              where r.telefone_chave = p_chave and r.integrado_em is null and r.estado <> 'respondeu') then
    return 'aguardando_reativacao';
  end if;
  if exists (select 1 from mayara.session_state s
              where mayara.chave_telefone(s.phone) = p_chave
                and (s.estado in ('S6_AGENDADO', 'S7_HANDOFF_HUMANO') or s.consulta_agendada_em is not null)) then
    return 'excluido_seguranca';
  end if;
  select * into fe from mayara.followup_estado where chave = p_chave;
  if not coalesce(fe.liberar_prioridade_juridica, false)
     and exists (select 1 from mayara.session_state s
                  where mayara.chave_telefone(s.phone) = p_chave
                    and (s.estado = 'S3_PRIORIDADE_JURIDICA'
                         or coalesce(s.fatos_json ->> 'situacaoJudicial', 'nenhuma') in
                            ('execucao', 'execução', 'recuperacao_judicial', 'recuperação_judicial', 'falencia', 'falência'))) then
    return 'excluido_seguranca';
  end if;
  if found then
    if fe.status <> 'ativo' then
      return fe.status;
    end if;
    if fe.pausado_ate is not null and fe.pausado_ate > p_agora then
      return 'pausado';
    end if;
  end if;
  return null;
end $$;

revoke all on function mayara._lead_excluido(text, timestamptz) from public, anon, authenticated;
```

- [ ] **Step 5: Aplicar (`apply_migration`, nome `mayara_reativacao_porta_regua`), rodar o teste e a regressão**

Run: o teste desta task, depois os testes `0044_followup_comando.test.sql` e `0045_followup_liberar.test.sql` (que usam `_lead_excluido`).
Expected: `OK 0057`, e os dois antigos continuam passando.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0057_mayara_reativacao_porta_regua.sql supabase/tests/0057_reativacao_porta_regua.test.sql
git commit -m "feat(reativacao): porta de entrada da regua de follow-up (migration 0057)"
```

---

### Task 3: Proposta de reativação, aprovação agendada, fila e registro de envio

**Files:**
- Create: `supabase/migrations/0058_mayara_reativacao_proposta_fila.sql`
- Test: `supabase/tests/0058_reativacao_proposta_fila.test.sql`

**Interfaces:**
- Consumes: Tasks 1 e 2; `mayara.propostas_abordagem` (com `tipo` e `reativacao_id`); `mayara.aprovar_proposta`, `decidir_proposta`, `finalizar_envio_proposta`, `confirmar_envio_proposta` (definições vivas); `mayara.autorizar_abordagem(telefone, nome, crm_id, horas)`; `mayara.iniciar_sessao_reativacao(...)`; `mayara.sessao_do_lead`; `mayara.resposta_permitida(p_agora)`; `mayara.canal_estado`; `mayara._ultima_entrada`.
- Produces: as funções `reativacao_criar_proposta`, `reativacao_proximo_envio`, `reativacao_registrar_envio`, `reativacao_sincronizar`, `_variante_nono_digito`; `aprovar_proposta` e `decidir_proposta` com ramo `tipo = 'reativacao'`; `confirmar_envio_proposta` gravando na sessão canônica.

Regras:
- `reativacao_criar_proposta(id, texto, fatos)`: só para estado `cadastrado`, `contexto_pronto` ou `rascunho`; recusa texto vazio, acima de 700 caracteres ou com link (`https?://`, `www.`); lead precisa estar `ativo`; recusa `conversa_recente` (lead escreveu nas últimas 48 h); uma proposta aberta por telefone. Cria a proposta com `tipo = 'reativacao'`, move a reativação para `proposta_aberta`.
- `aprovar_proposta` com `tipo = 'reativacao'`: marca `aprovada` e a reativação `aprovado`, **sem** `autorizar_abordagem` e **sem** sessão; devolve `agendada = true`.
- `decidir_proposta`: se `agendada`, responde "Aprovada: a mensagem para <nome> (final XXXX) entra na fila de envio e sai no próximo horário livre (até N por dia, intervalo mínimo de M minutos)."
- `reativacao_proximo_envio(p_agora)`: devolve `enviar = false` com `motivo` em `desligada`, `canal_fechado`, `fora_do_expediente`, `limite_diario`, `intervalo`, `em_andamento` ou `fila_vazia`; senão escolhe o aprovado mais recente do CRM, abre a janela de 24 h (`autorizar_abordagem`), cria a sessão, marca `enviando` e devolve os dados do envio e a variante com ou sem nono dígito.
- `reativacao_registrar_envio(proposta, ok, erro, sem_whatsapp)`: sucesso → `enviado` + `integrado_em`; sem WhatsApp → `sem_whatsapp`; outra falha → `falhou`; três falhas seguidas (ignorando `sem_whatsapp`) desligam `reativacao_ligada`.
- `reativacao_sincronizar(p_agora)`: proposta descartada → `descartado` (ou `pulado` se a causa foi lead inativo); expirada → `contexto_pronto`; lead `sem_interesse` → `sem_interesse`; lead que escreveu depois do cadastro → `respondeu` (e fecha proposta aberta); `enviado` com resposta depois do envio → `respondeu`; `enviando` há mais de 15 minutos → `falhou`.
- `confirmar_envio_proposta`: grava a memória na sessão canônica (`sessao_do_lead`), com fallback para a chave antiga.

- [ ] **Step 1: Conferir as definições vivas que serão substituídas**

Run (`execute_sql`): `select proname, pg_get_functiondef(oid) from pg_proc where pronamespace = 'mayara'::regnamespace and proname in ('aprovar_proposta','decidir_proposta','confirmar_envio_proposta')`.
Expected: `aprovar_proposta` e `decidir_proposta` iguais aos blocos da migration abaixo (sem o ramo de reativação) e `confirmar_envio_proposta` igual ao da migration 0035. Divergência: parar, incorporar a diferença e registrar `Ruling`.

- [ ] **Step 2: Escrever o teste SQL (deve falhar)**

```sql
-- supabase/tests/0058_reativacao_proposta_fila.test.sql
begin;
do $t$
declare
  j jsonb; r mayara.reativacao%rowtype; p mayara.propostas_abordagem%rowtype;
  segunda timestamptz := timestamptz '2026-10-19 13:00:00+00';   -- segunda 10:00 em Sao Paulo
  domingo timestamptz := timestamptz '2026-10-18 13:00:00+00';
  id1 bigint; id2 bigint; id3 bigint; pid1 bigint; pid2 bigint; pid3 bigint; n int; sid text;
begin
  insert into mayara.leads_autorizados (telefone, nome, status) values
    ('+5511999990721', 'Fila Um', 'ativo'), ('+5511999990722', 'Fila Dois', 'ativo'), ('+5511999990723', 'Fila Tres', 'ativo'),
    ('+5511999990724', 'Fila Inativo', 'sem_interesse');
  insert into mayara.reativacao (telefone_chave, telefone, nome, origem, ordem_chegada) values
    (mayara.chave_telefone('+5511999990721'), '+5511999990721', 'Fila Um',    'lista', now() - interval '3 days'),
    (mayara.chave_telefone('+5511999990722'), '+5511999990722', 'Fila Dois',  'lista', now() - interval '1 day'),
    (mayara.chave_telefone('+5511999990723'), '+5511999990723', 'Fila Tres',  'lista', now() - interval '2 days'),
    (mayara.chave_telefone('+5511999990724'), '+5511999990724', 'Fila Inativo', 'lista', now() - interval '4 days');
  select id into id1 from mayara.reativacao where telefone = '+5511999990721';
  select id into id2 from mayara.reativacao where telefone = '+5511999990722';
  select id into id3 from mayara.reativacao where telefone = '+5511999990723';
  update mayara.canal_estado set estado = 'open' where canal_id = 'escritorio';
  update mayara.config set valor = 'true' where chave = 'reativacao_ligada';
  update mayara.config set valor = '2' where chave = 'reativacao_limite_dia';
  update mayara.config set valor = '25' where chave = 'reativacao_intervalo_min';

  -- criar proposta: validacoes
  assert (mayara.reativacao_criar_proposta(id1, '   ', '{}'::jsonb) ->> 'motivo') = 'texto_vazio', 'texto vazio';
  assert (mayara.reativacao_criar_proposta(id1, repeat('a', 701), '{}'::jsonb) ->> 'motivo') = 'texto_longo', 'texto longo';
  assert (mayara.reativacao_criar_proposta(id1, 'Veja https://exemplo.com', '{}'::jsonb) ->> 'motivo') = 'texto_com_link', 'link';
  assert (mayara.reativacao_criar_proposta(999999999, 'oi', '{}'::jsonb) ->> 'motivo') = 'nao_encontrada', 'inexistente';
  assert (mayara.reativacao_criar_proposta((select id from mayara.reativacao where telefone = '+5511999990724'), 'Oi', '{}'::jsonb) ->> 'motivo') = 'lead_inativo', 'lead inativo';
  insert into mayara.session_state (session_key, phone, estado, last_lead_message_at) values ('whatsapp:escritorio:+5511999990723', '+5511999990723', 'S2_QUALIFICACAO', now() - interval '1 hour');
  assert (mayara.reativacao_criar_proposta(id3, 'Oi, tudo bem?', '{}'::jsonb) ->> 'motivo') = 'conversa_recente', 'conversa recente';
  update mayara.session_state set last_lead_message_at = now() - interval '5 days' where session_key = 'whatsapp:escritorio:+5511999990723';

  j := mayara.reativacao_criar_proposta(id1, 'Olá, Fila Um. Posso retomar o seu atendimento?', '{"origemLead":"reativacao"}'::jsonb);
  assert (j ->> 'ok') = 'true', 'cria proposta: ' || j::text;
  pid1 := (j ->> 'id')::bigint;
  select * into p from mayara.propostas_abordagem where id = pid1;
  assert p.tipo = 'reativacao' and p.reativacao_id = id1 and p.estado = 'aberta', 'proposta de reativacao';
  assert (select estado from mayara.reativacao where id = id1) = 'proposta_aberta', 'reativacao proposta_aberta';
  assert (mayara.reativacao_criar_proposta(id1, 'Outra', '{}'::jsonb) ->> 'motivo') = 'estado_invalido', 'nao cria duas';
  j := mayara.reativacao_criar_proposta(id2, 'Olá, Fila Dois. Posso retomar o seu atendimento?', '{}'::jsonb); pid2 := (j ->> 'id')::bigint;
  j := mayara.reativacao_criar_proposta(id3, 'Olá, Fila Tres. Posso retomar o seu atendimento?', '{}'::jsonb); pid3 := (j ->> 'id')::bigint;

  -- aprovar nao abre janela nem cria sessao: so agenda
  j := mayara.decidir_proposta('aprovar', pid1, null, 'x');
  assert j ->> 'acao' = 'responder' and (j ->> 'resposta') like 'Aprovada: a mensagem para Fila Um (final 0721) entra na fila de envio%', 'decidir agenda: ' || j::text;
  assert (select estado from mayara.reativacao where id = id1) = 'aprovado', 'reativacao aprovado';
  assert (select estado from mayara.propostas_abordagem where id = pid1) = 'aprovada', 'proposta aprovada';
  assert (select abordagem_ate from mayara.leads_autorizados where telefone = '+5511999990721') is null, 'aprovar nao abre janela';
  assert not exists (select 1 from mayara.session_state where session_key = 'whatsapp:escritorio:+5511999990721'), 'aprovar nao cria sessao';
  perform mayara.decidir_proposta('aprovar', pid2, null, 'x');
  perform mayara.decidir_proposta('aprovar', pid3, null, 'x');

  -- fila: gates
  update mayara.config set valor = 'false' where chave = 'reativacao_ligada';
  assert (mayara.reativacao_proximo_envio(segunda) ->> 'motivo') = 'desligada', 'desligada';
  update mayara.config set valor = 'true' where chave = 'reativacao_ligada';
  update mayara.canal_estado set estado = 'close' where canal_id = 'escritorio';
  assert (mayara.reativacao_proximo_envio(segunda) ->> 'motivo') = 'canal_fechado', 'canal fechado';
  update mayara.canal_estado set estado = 'open' where canal_id = 'escritorio';
  assert (mayara.reativacao_proximo_envio(domingo) ->> 'motivo') = 'fora_do_expediente', 'domingo';
  assert (mayara.reativacao_proximo_envio(timestamptz '2026-10-19 08:00:00+00') ->> 'motivo') = 'fora_do_expediente', '05:00 em Sao Paulo';

  -- primeiro envio: o lead mais recente do CRM (Fila Dois), janela aberta so agora
  j := mayara.reativacao_proximo_envio(segunda);
  assert (j ->> 'enviar') = 'true' and j ->> 'destino' = '+5511999990722' and j ->> 'nome' = 'Fila Dois', 'mais recente primeiro: ' || j::text;
  assert j ->> 'variante' = '+551199990722', 'variante sem nono digito: ' || (j ->> 'variante');
  assert (select estado from mayara.reativacao where id = id2) = 'enviando', 'marcado enviando';
  assert (select abordagem_ate from mayara.leads_autorizados where telefone = '+5511999990722') is not null, 'janela aberta no envio';
  assert exists (select 1 from mayara.session_state where session_key = 'whatsapp:escritorio:+5511999990722'), 'sessao criada no envio';
  -- enquanto o primeiro esta em andamento, nada sai
  assert (mayara.reativacao_proximo_envio(segunda + interval '1 minute') ->> 'motivo') = 'em_andamento', 'em andamento';

  -- registrar envio ok: integra e respeita o intervalo
  pid2 := (j ->> 'proposta_id')::bigint;
  j := mayara.reativacao_registrar_envio(pid2, true, null, false);
  assert j ->> 'estado' = 'enviado' and (j ->> 'pausada') = 'false', 'envio ok: ' || j::text;
  select * into r from mayara.reativacao where id = id2;
  assert r.estado = 'enviado' and r.integrado_em is not null and r.enviado_em is not null, 'integrado';
  assert (select estado from mayara.propostas_abordagem where id = pid2) = 'enviada', 'proposta enviada';
  select h.message ->> 'content' into sid from public.n8n_chat_histories h where h.session_id = mayara.sessao_do_lead('+5511999990722', null) order by h.id desc limit 1;
  assert sid like 'Olá, Fila Dois%', 'memoria na sessao canonica: ' || coalesce(sid, 'null');
  insert into mayara.envios_log (canal_id, destino_chave, tipo, ok, provedor_message_id, origem, criado_em)
    values ('escritorio', mayara.chave_telefone('+5511999990722'), 'texto', true, 'FILA1', 'reativacao', segunda);
  assert (mayara.reativacao_proximo_envio(segunda + interval '10 minutes') ->> 'motivo') = 'intervalo', 'intervalo de 25 min';

  -- depois do intervalo sai o proximo (Fila Tres, mais recente que Fila Um)
  j := mayara.reativacao_proximo_envio(segunda + interval '30 minutes');
  assert j ->> 'destino' = '+5511999990723', 'segundo da fila: ' || j::text;
  pid3 := (j ->> 'proposta_id')::bigint;
  j := mayara.reativacao_registrar_envio(pid3, true, null, false);
  insert into mayara.envios_log (canal_id, destino_chave, tipo, ok, provedor_message_id, origem, criado_em)
    values ('escritorio', mayara.chave_telefone('+5511999990723'), 'texto', true, 'FILA2', 'reativacao', segunda + interval '30 minutes');
  -- limite diario (2)
  assert (mayara.reativacao_proximo_envio(segunda + interval '90 minutes') ->> 'motivo') = 'limite_diario', 'limite diario';
  -- no dia seguinte sai o terceiro
  j := mayara.reativacao_proximo_envio(segunda + interval '1 day');
  assert j ->> 'destino' = '+5511999990721', 'dia seguinte: ' || j::text;
  pid1 := (j ->> 'proposta_id')::bigint;

  -- sem WhatsApp nao conta como falha e nao pausa
  j := mayara.reativacao_registrar_envio(pid1, false, 'exists:false', true);
  assert j ->> 'estado' = 'sem_whatsapp' and (j ->> 'pausada') = 'false', 'sem whatsapp: ' || j::text;
  assert (select valor from mayara.config where chave = 'reativacao_ligada') = 'true', 'continua ligada';

  -- tres falhas seguidas pausam
  update mayara.config set valor = '50' where chave = 'reativacao_limite_dia';
  update mayara.config set valor = '1' where chave = 'reativacao_intervalo_min';
  for n in 1..3 loop
    insert into mayara.leads_autorizados (telefone, nome, status) values ('+55119999907' || (30 + n), 'Falha ' || n, 'ativo');
    insert into mayara.reativacao (telefone_chave, telefone, nome, origem, ordem_chegada, estado)
      values (mayara.chave_telefone('+55119999907' || (30 + n)), '+55119999907' || (30 + n), 'Falha ' || n, 'lista', now() + n * interval '1 minute', 'cadastrado');
    j := mayara.reativacao_criar_proposta((select id from mayara.reativacao where telefone = '+55119999907' || (30 + n)), 'Olá, tudo bem?', '{}'::jsonb);
    perform mayara.decidir_proposta('aprovar', (j ->> 'id')::bigint, null, 'x');
    j := mayara.reativacao_proximo_envio(segunda + interval '2 days' + n * interval '5 minutes');
    assert (j ->> 'enviar') = 'true', 'falha ' || n || ' liberada: ' || j::text;
    j := mayara.reativacao_registrar_envio((j ->> 'proposta_id')::bigint, false, 'erro 500', false);
    assert j ->> 'estado' = 'falhou', 'falhou ' || n;
    assert (j ->> 'pausada') = (n = 3)::text, 'pausa so na terceira: ' || j::text;
  end loop;
  assert (select valor from mayara.config where chave = 'reativacao_ligada') = 'false', 'tres falhas desligam';

  -- sincronizar: descartada, expirada, resposta
  update mayara.config set valor = 'true' where chave = 'reativacao_ligada';
  insert into mayara.leads_autorizados (telefone, nome, status) values ('+5511999990741', 'Sync Um', 'ativo'), ('+5511999990742', 'Sync Dois', 'ativo'), ('+5511999990743', 'Sync Tres', 'ativo');
  insert into mayara.reativacao (telefone_chave, telefone, nome, origem, ordem_chegada) values
    (mayara.chave_telefone('+5511999990741'), '+5511999990741', 'Sync Um', 'lista', now()),
    (mayara.chave_telefone('+5511999990742'), '+5511999990742', 'Sync Dois', 'lista', now()),
    (mayara.chave_telefone('+5511999990743'), '+5511999990743', 'Sync Tres', 'lista', now());
  j := mayara.reativacao_criar_proposta((select id from mayara.reativacao where telefone = '+5511999990741'), 'Olá, Sync Um.', '{}'::jsonb);
  perform mayara.descartar_proposta((j ->> 'id')::bigint);
  j := mayara.reativacao_criar_proposta((select id from mayara.reativacao where telefone = '+5511999990742'), 'Olá, Sync Dois.', '{}'::jsonb);
  update mayara.propostas_abordagem set expira_em = now() - interval '1 minute' where id = (j ->> 'id')::bigint;
  update mayara.leads_autorizados set status = 'sem_interesse' where telefone = '+5511999990743';
  perform mayara.reativacao_sincronizar(now());
  assert (select estado from mayara.reativacao where telefone = '+5511999990741') = 'descartado', 'descartada vira descartado';
  assert (select estado from mayara.reativacao where telefone = '+5511999990742') = 'contexto_pronto', 'expirada volta para contexto_pronto';
  assert (select estado from mayara.reativacao where telefone = '+5511999990743') = 'sem_interesse', 'sem_interesse sincroniza';

  assert not has_function_privilege('anon', 'mayara.reativacao_proximo_envio(timestamptz)', 'execute'), 'anon sem execute';
end $t$;
rollback;
select 'OK 0058';
```

- [ ] **Step 3: Rodar e ver falhar**

Run: o teste com `execute_sql`.
Expected: ERRO `function mayara.reativacao_criar_proposta(bigint, text, jsonb) does not exist`.

- [ ] **Step 4: Escrever a migration**

```sql
-- supabase/migrations/0058_mayara_reativacao_proposta_fila.sql
-- Variante do numero com/sem o nono digito (para tentar de novo quando a Evolution diz que o numero nao existe).
create or replace function mayara._variante_nono_digito(p_telefone text)
returns text language sql immutable set search_path = '' as $$
  select case
           when d ~ '^55[0-9]{2}9[0-9]{8}$' then '+' || substr(d, 1, 4) || substr(d, 6)
           when d ~ '^55[0-9]{2}[0-9]{8}$' then '+' || substr(d, 1, 4) || '9' || substr(d, 5)
           else null
         end
    from (select regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g') as d) x
$$;

create or replace function mayara.reativacao_criar_proposta(p_reativacao_id bigint, p_texto text, p_fatos jsonb default '{}'::jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  r mayara.reativacao%rowtype;
  v_texto text := btrim(coalesce(p_texto, ''));
  v_status text; v_id bigint;
begin
  select * into r from mayara.reativacao where id = p_reativacao_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'nao_encontrada');
  end if;
  if r.estado not in ('cadastrado', 'contexto_pronto', 'rascunho') then
    return jsonb_build_object('ok', false, 'motivo', 'estado_invalido');
  end if;
  if v_texto = '' then
    return jsonb_build_object('ok', false, 'motivo', 'texto_vazio');
  end if;
  if char_length(v_texto) > 700 then
    return jsonb_build_object('ok', false, 'motivo', 'texto_longo');
  end if;
  if v_texto ~* '(https?://|www\.)' then
    return jsonb_build_object('ok', false, 'motivo', 'texto_com_link');
  end if;
  select status into v_status from mayara.leads_autorizados where telefone_chave = r.telefone_chave;
  if v_status is distinct from 'ativo' then
    return jsonb_build_object('ok', false, 'motivo', 'lead_inativo');
  end if;
  if exists (select 1 from mayara.session_state s
              where mayara.chave_telefone(s.phone) = r.telefone_chave and s.last_lead_message_at > now() - interval '48 hours') then
    return jsonb_build_object('ok', false, 'motivo', 'conversa_recente');
  end if;
  insert into mayara.propostas_abordagem (telefone, telefone_chave, nome, crm_lead_id, fatos, texto, texto_original, tipo, reativacao_id)
  values (r.telefone, r.telefone_chave, r.nome, r.crm_lead_id, coalesce(p_fatos, '{}'::jsonb), v_texto, v_texto, 'reativacao', r.id)
  returning id into v_id;
  update mayara.reativacao
     set estado = 'proposta_aberta', proposta_id = v_id, texto_rascunho = v_texto, atualizado_em = now()
   where id = r.id;
  return jsonb_build_object('ok', true, 'id', v_id);
exception when unique_violation then
  return jsonb_build_object('ok', false, 'motivo', 'ja_aberta');
end $$;

-- aprovar: proposta de reativacao so agenda (nao abre janela, nao cria sessao, nao envia)
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
  if p.tipo = 'reativacao' then
    update mayara.propostas_abordagem set estado = 'aprovada', aprovada_por = p_autor where id = p.id;
    update mayara.reativacao set estado = 'aprovado', aprovado_em = now(), atualizado_em = now() where id = p.reativacao_id;
    return jsonb_build_object('ok', true, 'id', p.id, 'agendada', true, 'destino', p.telefone, 'texto', p.texto, 'nome', p.nome);
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
  if (r ->> 'ok') = 'true' and (r ->> 'agendada') = 'true' then
    return jsonb_build_object('acao', 'responder', 'resposta',
      'Aprovada: a mensagem para ' || coalesce(r ->> 'nome', 'o lead') || ' (final '
      || right(coalesce(mayara.chave_telefone(r ->> 'destino'), ''), 4)
      || ') entra na fila de envio e sai no próximo horário livre (até '
      || coalesce((select valor from mayara.config where chave = 'reativacao_limite_dia'), '10')
      || ' por dia, intervalo mínimo de '
      || coalesce((select valor from mayara.config where chave = 'reativacao_intervalo_min'), '25') || ' minutos).');
  end if;
  if (r ->> 'ok') = 'true' then
    return jsonb_build_object('acao', 'enviar', 'id', p_id, 'destino', r ->> 'destino', 'texto', r ->> 'texto',
                              'nome', r ->> 'nome', 'crm_lead_id', r ->> 'crm_lead_id');
  end if;
  return jsonb_build_object('acao', 'responder', 'resposta', mayara._motivo_proposta(r ->> 'motivo', p_id));
end $$;

-- memoria do envio na sessao canonica do lead
create or replace function mayara.confirmar_envio_proposta(p_id bigint, p_ok boolean, p_erro text)
returns text language plpgsql set search_path = '' as $$
declare p mayara.propostas_abordagem%rowtype; v_sid text;
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
    v_sid := coalesce(mayara.sessao_do_lead(p.telefone, null), 'whatsapp:escritorio:' || p.telefone);
    insert into public.n8n_chat_histories (session_id, message, created_at)
    values (v_sid,
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

create or replace function mayara.reativacao_proximo_envio(p_agora timestamptz default now())
returns jsonb language plpgsql set search_path = '' as $$
declare
  r mayara.reativacao%rowtype; p mayara.propostas_abordagem%rowtype; a jsonb;
  v_lim int := coalesce((select valor::int from mayara.config where chave = 'reativacao_limite_dia'), 10);
  v_int int := coalesce((select valor::int from mayara.config where chave = 'reativacao_intervalo_min'), 25);
  v_hoje int; v_ultimo timestamptz;
begin
  if coalesce((select valor from mayara.config where chave = 'reativacao_ligada'), 'false') <> 'true' then
    return jsonb_build_object('enviar', false, 'motivo', 'desligada');
  end if;
  if coalesce((select estado from mayara.canal_estado where canal_id = 'escritorio'), 'close') <> 'open' then
    return jsonb_build_object('enviar', false, 'motivo', 'canal_fechado');
  end if;
  if not mayara.resposta_permitida(p_agora) then
    return jsonb_build_object('enviar', false, 'motivo', 'fora_do_expediente');
  end if;
  if exists (select 1 from mayara.reativacao x where x.estado = 'enviando' and x.atualizado_em > p_agora - interval '15 minutes') then
    return jsonb_build_object('enviar', false, 'motivo', 'em_andamento');
  end if;
  select count(*) into v_hoje from mayara.envios_log e
   where e.origem = 'reativacao' and e.ok
     and (e.criado_em at time zone 'America/Sao_Paulo')::date = (p_agora at time zone 'America/Sao_Paulo')::date;
  if v_hoje >= v_lim then
    return jsonb_build_object('enviar', false, 'motivo', 'limite_diario');
  end if;
  select greatest(
           (select max(e.criado_em) from mayara.envios_log e where e.origem = 'reativacao' and e.ok),
           (select max(x.enviado_em) from mayara.reativacao x))
    into v_ultimo;
  if v_ultimo is not null and v_ultimo > p_agora - make_interval(mins => v_int) then
    return jsonb_build_object('enviar', false, 'motivo', 'intervalo');
  end if;
  select x.* into r
    from mayara.reativacao x
    join mayara.propostas_abordagem pa on pa.id = x.proposta_id and pa.estado = 'aprovada'
   where x.estado = 'aprovado'
   order by x.ordem_chegada desc, x.id
   limit 1
   for update of x skip locked;
  if not found then
    return jsonb_build_object('enviar', false, 'motivo', 'fila_vazia');
  end if;
  select * into p from mayara.propostas_abordagem where id = r.proposta_id;
  a := mayara.autorizar_abordagem(r.telefone, r.nome, r.crm_lead_id, 24);
  if (a ->> 'abordagem_liberada') <> 'true' then
    update mayara.propostas_abordagem set estado = 'descartada', encerrada_em = now(), erro = 'lead_' || coalesce(a ->> 'status', 'inativo') where id = p.id;
    update mayara.reativacao set estado = 'pulado', motivo = 'lead_' || coalesce(a ->> 'status', 'inativo'), atualizado_em = now() where id = r.id;
    return jsonb_build_object('enviar', false, 'motivo', 'lead_inativo');
  end if;
  perform mayara.iniciar_sessao_reativacao('whatsapp:escritorio:' || r.telefone, r.telefone, p.fatos);
  update mayara.reativacao set estado = 'enviando', tentativas = tentativas + 1, atualizado_em = p_agora where id = r.id;
  return jsonb_build_object('enviar', true, 'proposta_id', p.id, 'reativacao_id', r.id, 'destino', r.telefone,
                            'variante', mayara._variante_nono_digito(r.telefone), 'texto', p.texto,
                            'nome', r.nome, 'crm_lead_id', r.crm_lead_id);
end $$;

create or replace function mayara.reativacao_registrar_envio(p_proposta_id bigint, p_ok boolean, p_erro text, p_sem_whatsapp boolean default false)
returns jsonb language plpgsql set search_path = '' as $$
declare r mayara.reativacao%rowtype; v_pausada boolean := false; v_ultimas text[];
begin
  select * into r from mayara.reativacao where proposta_id = p_proposta_id for update;
  if not found then
    return jsonb_build_object('estado', 'nao_encontrada', 'pausada', false);
  end if;
  perform mayara.finalizar_envio_proposta(p_proposta_id, p_ok, p_erro);
  if p_ok then
    update mayara.reativacao
       set estado = 'enviado', enviado_em = now(), integrado_em = now(), atualizado_em = now(), motivo = null
     where id = r.id;
    return jsonb_build_object('estado', 'enviado', 'pausada', false);
  end if;
  if p_sem_whatsapp then
    update mayara.reativacao set estado = 'sem_whatsapp', motivo = left(coalesce(p_erro, 'sem_whatsapp'), 200), atualizado_em = now() where id = r.id;
    return jsonb_build_object('estado', 'sem_whatsapp', 'pausada', false);
  end if;
  update mayara.reativacao set estado = 'falhou', motivo = left(coalesce(p_erro, 'erro_desconhecido'), 200), atualizado_em = now() where id = r.id;
  select array_agg(x.estado order by x.atualizado_em desc) into v_ultimas
    from (select estado, atualizado_em from mayara.reativacao
           where estado in ('enviado', 'falhou') order by atualizado_em desc limit 3) x;
  if coalesce(array_length(v_ultimas, 1), 0) = 3 and v_ultimas = array['falhou', 'falhou', 'falhou'] then
    update mayara.config set valor = 'false' where chave = 'reativacao_ligada';
    v_pausada := true;
  end if;
  return jsonb_build_object('estado', 'falhou', 'pausada', v_pausada);
end $$;

create or replace function mayara.reativacao_sincronizar(p_agora timestamptz default now())
returns jsonb language plpgsql set search_path = '' as $$
declare v_desc int := 0; v_exp int := 0; v_sem int := 0; v_resp int := 0; v_trav int := 0; v int;
begin
  perform mayara.expirar_propostas(p_agora);
  update mayara.reativacao r set estado = 'descartado', atualizado_em = p_agora
    from mayara.propostas_abordagem p
   where r.proposta_id = p.id and r.estado = 'proposta_aberta' and p.estado = 'descartada' and coalesce(p.erro, '') = '';
  get diagnostics v = row_count; v_desc := v;
  update mayara.reativacao r set estado = 'pulado', motivo = p.erro, atualizado_em = p_agora
    from mayara.propostas_abordagem p
   where r.proposta_id = p.id and r.estado = 'proposta_aberta' and p.estado = 'descartada' and coalesce(p.erro, '') <> '';
  update mayara.reativacao r set estado = 'contexto_pronto', proposta_id = null, atualizado_em = p_agora
    from mayara.propostas_abordagem p
   where r.proposta_id = p.id and r.estado = 'proposta_aberta' and p.estado = 'expirada';
  get diagnostics v = row_count; v_exp := v;
  update mayara.reativacao r set estado = 'sem_interesse', atualizado_em = p_agora
   where r.estado not in ('sem_interesse', 'respondeu', 'enviado', 'sem_whatsapp', 'falhou', 'descartado', 'pulado')
     and exists (select 1 from mayara.leads_autorizados la where la.telefone_chave = r.telefone_chave and la.status = 'sem_interesse');
  get diagnostics v = row_count; v_sem := v;
  update mayara.propostas_abordagem p set estado = 'descartada', encerrada_em = p_agora, erro = 'lead_respondeu'
   where p.tipo = 'reativacao' and p.estado = 'aberta'
     and exists (select 1 from mayara.reativacao r where r.id = p.reativacao_id and mayara._ultima_entrada(r.telefone_chave) > r.criado_em);
  update mayara.reativacao r set estado = 'respondeu', atualizado_em = p_agora
   where r.estado in ('cadastrado', 'contexto_pronto', 'rascunho', 'proposta_aberta')
     and mayara._ultima_entrada(r.telefone_chave) > r.criado_em;
  get diagnostics v = row_count; v_resp := v;
  update mayara.reativacao r set estado = 'respondeu', atualizado_em = p_agora
   where r.estado = 'enviado' and mayara._ultima_entrada(r.telefone_chave) > r.enviado_em;
  get diagnostics v = row_count; v_resp := v_resp + v;
  update mayara.reativacao r set estado = 'falhou', motivo = 'envio_sem_confirmacao', atualizado_em = p_agora
   where r.estado = 'enviando' and r.atualizado_em < p_agora - interval '15 minutes';
  get diagnostics v = row_count; v_trav := v;
  return jsonb_build_object('descartados', v_desc, 'expirados', v_exp, 'sem_interesse', v_sem, 'responderam', v_resp, 'travados', v_trav);
end $$;

revoke all on function mayara._variante_nono_digito(text) from public, anon, authenticated;
revoke all on function mayara.reativacao_criar_proposta(bigint, text, jsonb) from public, anon, authenticated;
revoke all on function mayara.aprovar_proposta(bigint, text) from public, anon, authenticated;
revoke all on function mayara.decidir_proposta(text, bigint, text, text) from public, anon, authenticated;
revoke all on function mayara.confirmar_envio_proposta(bigint, boolean, text) from public, anon, authenticated;
revoke all on function mayara.reativacao_proximo_envio(timestamptz) from public, anon, authenticated;
revoke all on function mayara.reativacao_registrar_envio(bigint, boolean, text, boolean) from public, anon, authenticated;
revoke all on function mayara.reativacao_sincronizar(timestamptz) from public, anon, authenticated;
```

Notas de implementação para o executor:
- A contagem do dia usa só `envios_log` (origem `reativacao`, `ok`): o workflow grava o log no `Canal: Enviar` antes de chamar `reativacao_registrar_envio`, e `reativacao_vagas` (Task 1) usa a mesma fonte.
- `v_ultimo` usa o maior entre o último log de envio e `enviado_em`, para o intervalo valer mesmo se um dos dois atrasar.

- [ ] **Step 5: Aplicar (`apply_migration`, nome `mayara_reativacao_proposta_fila`) e rodar o teste**

Expected: `OK 0058`. Divergências de horário (por exemplo, o 05:00 de São Paulo cair dentro do expediente se a tabela `expediente` tiver sido alterada) se corrigem no **teste** apenas se o expediente real for diferente do documentado; regras de limite, intervalo e porta nunca se relaxam.

- [ ] **Step 6: Regressão dos testes antigos que usam as funções substituídas**

Run: `0033`, `0034`, `0035`, `0036` (propostas) e `0057`.
Expected: todos `OK`. O comportamento das propostas do tipo `abordagem` não pode mudar.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0058_mayara_reativacao_proposta_fila.sql supabase/tests/0058_reativacao_proposta_fila.test.sql
git commit -m "feat(reativacao): proposta, aprovacao agendada, fila e registro de envio (migration 0058)"
```

---

### Task 4: Cadastro real, conferência e handoff da Fase 1

**Files:**
- Modify: `docs/handoffs/claude-status.md`

**Interfaces:**
- Consumes: Tasks 1 a 3 aplicadas.
- Produces: os 69 leads cadastrados em `mayara.reativacao` (sem janela, sem régua, sem envio) e a base pronta para a Fase 2.

- [ ] **Step 1: Prova de que ninguém recebe nada ainda**

Run (`execute_sql`):
```sql
select (select valor from mayara.config where chave = 'reativacao_ligada') ligada,
       (select valor from mayara.config where chave = 'followup_modo') followup,
       (select valor from mayara.config where chave = 'respostas_retidas') retidas;
```
Expected: `reativacao_ligada = false`, `followup_modo = desligado`, `respostas_retidas = true`.

- [ ] **Step 2: Cadastrar os leads (única operação com efeito em dados reais desta fase)**

Run: `select mayara.reativacao_cadastrar();`
Expected: `novos` próximo de 59, `da_lista` próximo de 10, `devolvidos` igual ao número de leads que estavam `bloqueado` (3 em 16/10, conforme o spec; se o número real for outro, registrar). Nenhuma mensagem sai, porque `reativacao_ligada = false` e nenhum envio existe.

- [ ] **Step 3: Conferir o estado**

Run:
```sql
select mayara.reativacao_resumo();
select count(*) filter (where abordagem_ate is not null) janelas_abertas from mayara.leads_autorizados la join mayara.reativacao r using (telefone_chave) where r.origem = 'crm_fora_da_lista';
select count(*) from mayara.followup_estado f join mayara.reativacao r on r.telefone_chave = f.chave where r.origem = 'crm_fora_da_lista';
```
Expected: `total` próximo de 69, todos `cadastrado` (exceto `sem_interesse`, se houver); `janelas_abertas = 0`; estados de régua dos novos = 0.

- [ ] **Step 4: Registrar o handoff (sem nomes, telefones ou textos)**

Acrescentar uma seção "Reativação em massa, Fase 1 (banco)" a `docs/handoffs/claude-status.md` com: migrations 0056 a 0058, testes (`OK 0056`, `OK 0057`, `OK 0058`), contagens do cadastro, estado das chaves e o próximo passo (plano detalhado da Fase 2).

```bash
git add docs/handoffs/claude-status.md
git commit -m "docs(handoff): reativacao em massa, fase 1 concluida"
```

---

## Fase 2: Importador das exportações (plano detalhado a escrever ao concluir a Fase 1)

**Objetivo:** transformar os `.txt` de exportação do WhatsApp em linhas estruturadas de contexto, ligadas ao lead **com a confirmação do administrador**.

**Tarefas previstas:**
1. **Parser** (`docs/superpowers/specs/2026-10-NN-reativacao/exportacao.mjs`, com testes): formatos `[dd/mm/aaaa hh:mm:ss] Nome: texto` e `dd/mm/aaaa hh:mm - Nome: texto`, mensagens de várias linhas, mensagens de sistema ignoradas, mídia omitida; separa "escritório" de "lead" por nome indicado pelo administrador. O formato real é conferido com **um arquivo de exemplo** que o administrador exporta antes da escrita do plano detalhado.
2. **Ligação** (`ligar.mjs`): nome do arquivo e do contato contra o nome do lead (sem acento, todas as palavras relevantes); resultados `unico`, `ambiguo`, `nenhum`; gera a tabela de confirmação arquivo→lead.
3. **Gravação** (`mayara.reativacao_gravar_contexto(reativacao_id, fonte, linhas, confirmado_por)`, migration própria com teste SQL): grava em `contexto_reativacao`, move `cadastrado` para `contexto_pronto` e preenche `fonte_contexto`; recusa gravação sem confirmação.
4. **Contexto de memória e CRM**: função que monta `linhas` a partir de `n8n_chat_histories` da sessão canônica (incluindo notas de contexto) para leads que já conversaram, e dados do CRM para os demais.
5. **Privacidade**: `dados-privados/` no `.gitignore`; opção de apagar os `.txt` depois de gravar.

**Testes:** parser com fixtures sintéticas; ligação (único, ambíguo, ausente, nomes com acento); SQL (confirmação obrigatória, idempotência).

## Fase 3: Redação (plano detalhado a escrever ao concluir a Fase 2)

**Objetivo:** gerar um rascunho individual válido por lead.
**Tarefas previstas:** `reativar.mjs` (montagem do pedido ao modelo com o texto do lead delimitado como dado; validação de tamanho, link, promessa, ação humana fingida, nome do lead, no máximo uma pergunta; modelo determinístico para quem só tem CRM); gerador de corpos de nó; workflow `Reativação: Preparar` (usa `reativacao_vagas` para saber quantos rascunhos criar; chama `reativacao_criar_proposta`; modo simulação que só conta); testes de unidade e execução em simulação sobre os 69.

## Fase 4: Apresentação ao administrador (plano a escrever ao concluir a Fase 3)

**Objetivo:** o administrador recebe uma proposta por vez, com a fonte do contexto, e decide com `sim N`, `editar N`, `não N` e `ver N`.
**Tarefas previstas:** extensão de `reservar_notificacoes` e do workflow `Notificar` para propostas `tipo = 'reativacao'` (texto com "Contexto: exportação | memória | CRM"); comando `ver N` (resumo do contexto usado, sem expor o histórico inteiro); ajuste do classificador da Central (testes em `central-propostas.test.mjs`); cota de apresentação limitada por `reativacao_vagas`; aceite pelo WhatsApp com um lead de teste.

## Fase 5: Envio (plano a escrever ao concluir a Fase 4)

**Objetivo:** enviar só as aprovadas, no ritmo combinado, com proteção do número.
**Tarefas previstas:** workflow `Reativação: Enviar` agendado a cada 5 minutos (chama `reativacao_proximo_envio`; envia pelo `Canal: Enviar` com `origem = 'reativacao'`; se a Evolution disser que o número não existe, tenta `variante` uma vez; chama `reativacao_registrar_envio`; atualiza o CRM como a abordagem assistida faz); chamada periódica de `reativacao_sincronizar`; alerta ao administrador quando a reativação se pausa sozinha; piloto de 3 leads. `reativacao_ligada` só é ligada com pedido explícito.

## Fase 6: Comandos e operação (plano a escrever ao concluir a Fase 5)

**Tarefas previstas:** `/reativacao status|pausar|retomar` na Central (`executar_central` ganha o ramo, com teste); consulta no modo livre ("como está a reativação?") via `reativacao_resumo`; runbook `docs/runbooks/reativacao.md`; handoff.

## Fase 7: Saída da retenção e régua ligada (plano a escrever ao concluir a Fase 6)

**Tarefas previstas:** conferência de que todos os leads estão integrados ou em estado final; resumo ao administrador; **somente com a decisão explícita dele**, `respostas_retidas = false` e `followup_modo = 'ligado'`; primeiro ciclo observado e registrado.
