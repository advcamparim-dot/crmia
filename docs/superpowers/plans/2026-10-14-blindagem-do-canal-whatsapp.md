# Blindagem do Canal WhatsApp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Mayara deixa de depender de a conexão da Evolution ser perfeita: o canal é vigiado a cada 2 minutos, tenta se curar sozinho, avisa você por fora do WhatsApp quando não consegue, e, ao voltar, recupera as mensagens perdidas (inclusive as que você respondeu pelo celular) sem nunca duplicar e sem responder sem contexto.

**Architecture:** (1) Banco: tabela de mensagens já vistas (idempotência), função de decisão `leitura_canal` (política de reinício, alerta e recuperação) e função `tratar_mensagem_humana` (assume o lead e grava a fala humana na memória da Mayara). (2) Três workflows novos: `Canal: Vigia` (agendado, 2 min), `Canal: Recuperar` (busca mensagens na Evolution, processa só as não vistas) e `Canal: Alertar Fora do WhatsApp` (e-mail + tarefa no CRM). (3) O receptor de webhook existente passa a marcar cada mensagem como vista e a usar `tratar_mensagem_humana`. Tudo atrás de uma chave de desligamento (`canal_vigia`).

**Tech Stack:** Postgres/plpgsql (Supabase), n8n 2.x (Schedule, HTTP Request, Postgres, Code, Switch, IF, Loop Over Items, Execute Workflow, Gmail), Evolution API v2.3.7 (`https://evolution.camparimadvogados.com.br`, instância `escritorio`), Node.js (`node:test`).

**Spec:** `docs/superpowers/specs/2026-10-03-camada-de-canal-whatsapp-design.md` (camada de canal e `Canal: Estado`). Esta blindagem é um complemento operacional; não há spec novo. O diagnóstico da causa raiz das quedas (logs da Evolution) corre em paralelo e é do usuário (Task 0).

## Global Constraints

- **Aprovação:** este plano muda a estrutura do canal. Só executar depois da aprovação do usuário. Ao concluir cada etapa, atualizar `docs/handoffs/claude-status.md` (objetivo, arquivos, testes, resultado, pendências, riscos), sem senhas, tokens, chaves nem dados pessoais de clientes.
- **Segredos:** a chave da API do n8n está em `~/.claude.json` e nunca é impressa nem gravada no repositório. A credencial da Evolution (`Evolution API`, id `vA1UKEhHVqwcLGWW`) só é usada pelo n8n. O e-mail do destinatário dos alertas fica em `mayara.config.alerta_email_destino`, não no código.
- **Idempotência:** nenhuma mensagem é processada duas vezes. A identidade é `(canal_id, message_id)` em `mayara.mensagens_canal_vistas`.
- **Sem reprocessar o passado:** a primeira recuperação após a implantação parte de `sincronizado_ate = momento da migration`; nunca olha antes disso. Janela máxima de busca: 48 horas.
- **Respostas continuam respeitando os portões existentes:** retenção (`respostas_retidas`), expediente e feriados, canal aberto. A recuperação nunca contorna esses portões; ela entrega o evento ao `Canal: Processar Evento`, como o webhook faz.
- **Mensagem humana:** quando o escritório responde pelo celular, o lead é assumido (`humano_assumiu`, regra que já existe) e o texto vai para a memória da Mayara como `Mensagem enviada por uma pessoa do escritório: <texto>`. Devolver o lead à Mayara continua sendo decisão do administrador (`/devolver`).
- **Limites de segurança:** no máximo 3 reinícios por queda (4 min de intervalo), 12 lembretes por queda (a cada 60 min), 200 mensagens buscadas e 100 processadas por execução de recuperação.
- **n8n:** n8n-mcp é instável (“Connection closed” muitas vezes aplica a mudança): reler por GET (REST) antes de repetir. Alterações em workflows ao vivo seguem o padrão já usado (baixar o JSON vivo, aplicar o patch gerado e testado, PUT, GET para conferir, reexportar para `docs/superpowers/specs/workflows/`). A Central publicada exige sub-workflows referenciados publicados.
- **Migrations:** número `0049`. Testes SQL em `supabase/tests/`, dentro de `begin; ... rollback;`, terminando com `select 'OK 0049';`. Funções com `set search_path = ''` e `revoke all ... from public, anon, authenticated`. A ferramenta SQL recusa `delete`, `drop` e `update` sem `where`.
- Textos ao administrador em português com acentos. Commits terminam com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Primeira execução após a implantação não reprocessa histórico:** com a tabela de vistas vazia, a recuperação só considera mensagens com data posterior ao `sincronizado_ate` inicial; a execução de ensaio (`simular`) prova isso antes de ligar.
2. **Mensagem recebida pelo webhook e depois vista na recuperação é processada uma vez:** a segunda passagem encontra o `message_id` na tabela e pula.
3. **Mensagem enviada pela própria Mayara nunca assume o lead:** `humano_assumiu` já consulta `envios_log`; a recuperação passa pelo mesmo caminho, sem a espera de 5 s do webhook, e o teste cobre o caso.
4. **Tempestade de reinícios e de alertas:** no máximo 3 reinícios por queda e 12 lembretes; reinício não tenta curar `loggedOut` (isso exige QR), então o alerta sai depois da terceira tentativa.
5. **Evolution inalcançável (a própria API fora do ar) não é confundida com “conectado”:** erro de HTTP vira `inalcancavel` e segue a mesma trilha de alerta.
6. **Chave de desligamento:** com `canal_vigia = 'false'`, `leitura_canal` devolve `nada` e nenhuma ação sai; o webhook continua funcionando como hoje.

## File Structure

- Create: `supabase/migrations/0049_mayara_blindagem_canal.sql`, `supabase/tests/0049_blindagem_canal.test.sql`
- Create: `docs/superpowers/specs/2026-10-14-blindagem-canal/vigia.mjs`, `vigia.test.mjs`, `recuperar.mjs`, `recuperar.test.mjs`, `gerar-nodes.mjs`, `gerar-nodes.test.mjs`, `gerar-workflows.mjs`, `gerar-workflows.test.mjs`, `gerar-receber-patch.mjs`, `gerar-receber-patch.test.mjs`
- Create (gerados): `vigia.node.js`, `recuperar.node.js`, `docs/superpowers/specs/workflows/mayara-canal-vigia.json`, `mayara-canal-recuperar.json`, `mayara-canal-alertar-fora.json`, `receber-patch.json`
- Create: `docs/superpowers/specs/2026-10-14-blindagem-canal/evolution-contrato.md` (resultado da sonda), `docs/runbooks/canal-whatsapp.md`
- Modify: `docs/superpowers/specs/2026-10-03-camada-canal/evolucao.mjs` (evento humano com texto e data), `evolucao.test.mjs`, `docs/superpowers/specs/workflows/mayara-canal-receber-evolution.json` (reexportação), `docs/handoffs/claude-status.md`

---

### Task 0: Pré-requisitos do usuário e sonda da API da Evolution

Esta task combina duas coisas que não exigem código no repositório, mas definem tudo o que vem depois. Pontos de parada permitidos: ações do usuário e credenciais.

**Parte A: do usuário (em paralelo, sem bloquear as Tasks 1 e 2)**

- [ ] **A1. Logs da Evolution.** O usuário abre o Coolify, serviço da Evolution, aba de logs, e cola aqui as ~50 linhas em torno de 06:18 (Brasília) de 13/10, sem a chave. Eu identifico o código da desconexão e confiro esta lista de causas:
  - 401/`loggedOut`: aparelho desvinculado (precisa QR).
  - 440/conexão substituída: a mesma sessão aberta em outro lugar (segunda instância ou contêiner).
  - Reinício do contêiner ou falta de memória; volume da instância sem persistência.
  - Variável `DEL_INSTANCE` com valor numérico (apaga instância desconectada após N minutos); deve ficar `false`.
  - Versão antiga: conferir a tag da imagem e a variável da versão do WhatsApp Web (`CONFIG_SESSION_PHONE_VERSION`).
  Resultado esperado: um parágrafo no handoff com a causa e a correção (que o usuário aplica no Coolify). Isto não bloqueia o código do plano.
- [ ] **A2. Credencial de e-mail no n8n.** O usuário cria no n8n uma credencial Gmail OAuth2 (Credentials > Create > Gmail OAuth2 API) e me passa só o **ID** e o nome dela (não segredos). Sem ela, a Task 5 envia só a tarefa no CRM e registra a pendência.
- [ ] **A3. Destinatário.** O usuário confirma o e-mail que recebe os alertas; eu o gravo em `mayara.config.alerta_email_destino` por SQL (Task 7), nunca no código.

**Parte B: sonda da API (eu faço)**

Objetivo: descobrir, sem expor o endpoint publicamente, a forma exata das respostas da Evolution v2.3.7: `GET /instance/connectionState/escritorio`, `PUT /instance/restart/escritorio` (só verificar que o método existe: **não executar** o reinício agora), e `POST /chat/findMessages/escritorio` com janela de tempo.

- [ ] **B1. Workflow de sonda por agendamento.** Criar (REST) o workflow temporário `Sonda Evolution (temporario)` com `scheduleTrigger` (um disparo no próximo minuto) → HTTP Request GET `connectionState` → HTTP Request POST `findMessages` com corpo `{ "where": { "messageTimestamp": { "gte": <agora-3h em segundos>, "lte": <agora em segundos> } }, "page": 1, "offset": 5 }` → Code que devolve **só a estrutura** (nomes e tipos de campos; nunca o texto das mensagens). Sem webhook, sem trigger público. Publicar, esperar o disparo, ler pelo `n8n_executions`, **despublicar e apagar** o workflow.
- [ ] **B2. Registrar o contrato.** Gravar em `docs/superpowers/specs/2026-10-14-blindagem-canal/evolution-contrato.md`: o formato de `connectionState` (campo do estado), o corpo aceito pelo `findMessages` (se `messageTimestamp` aceita `gte/lte`; senão, qual filtro alternativo), onde ficam os registros na resposta (`messages.records`, `records` ou array), campos `key.id`, `key.fromMe`, `key.remoteJid`, `messageTimestamp`, e se a página vem do mais novo para o mais antigo. Se o filtro por data não existir, o plano usa `offset` alto e filtra por `messageTimestamp` no Code (ledger: `Ruling`).
- [ ] **B3. Commit.**

```bash
git add docs/superpowers/specs/2026-10-14-blindagem-canal/evolution-contrato.md
git commit -m "docs(canal): contrato observado da API da Evolution v2.3.7 (sonda)"
```

Expected: contrato registrado; sonda apagada do n8n (conferir por GET que o workflow não existe mais).

---

### Task 1: Banco: mensagens vistas, tratamento de mensagem humana, política do vigia

**Files:**
- Create: `supabase/migrations/0049_mayara_blindagem_canal.sql`
- Test: `supabase/tests/0049_blindagem_canal.test.sql`

**Interfaces:**
- Consumes: `mayara.canal_estado(canal_id, estado, atualizado_em, alertado_em, ultimo_open_em)`; `mayara.humano_assumiu(canal, telefone, message_id) returns jsonb` (`acao` em `mayara|telefone_invalido|assumido|ignorado`); `mayara.chave_telefone(text)`; `public.n8n_chat_histories(session_id, message, created_at)`; `mayara.session_state`, `mayara.leads_autorizados`; `mayara.config(chave, valor)`.
- Produces:
  - tabela `mayara.mensagens_canal_vistas(canal_id, message_id, direcao, origem, visto_em)` com PK `(canal_id, message_id)`;
  - `mayara.marcar_mensagem_vista(p_canal text, p_message_id text, p_direcao text, p_origem text) returns boolean` (true se nova);
  - `mayara.mensagem_ja_vista(p_canal text, p_message_id text) returns boolean`;
  - `mayara.registrar_mensagem_humana(p_telefone text, p_texto text, p_quando timestamptz) returns boolean`;
  - `mayara.tratar_mensagem_humana(p_canal text, p_telefone text, p_message_id text, p_texto text, p_quando timestamptz) returns jsonb` (`{acao, memoria}`);
  - colunas novas em `canal_estado`: `queda_desde`, `tentativas_restart`, `ultimo_restart_em`, `lembretes_enviados`, `ultimo_lembrete_em`, `sincronizado_ate`, `ultima_recuperacao_em`;
  - `mayara.leitura_canal(p_canal text, p_estado_real text, p_agora timestamptz default now()) returns jsonb` com `{acao: 'nada'|'reiniciar'|'alertar'|'lembrar'|'recuperar', desde, minutos_fora, tentativas}`;
  - `mayara.concluir_recuperacao(p_canal text, p_ate timestamptz) returns void`;
  - chaves de configuração `canal_vigia` (padrão `false`) e `alerta_email_destino` (padrão vazio).

Política de `leitura_canal` (tudo com `p_agora` explícito para ser testável):
- `canal_vigia <> 'true'` → `{acao:'nada', motivo:'vigia_desligado'}`; leitura fora de `open|connecting|close|inalcancavel` → `nada`; canal inexistente → `nada`.
- `open`: se havia queda (`queda_desde` não nulo ou `estado <> 'open'`) **ou** `ultima_recuperacao_em` é nula ou tem 15 min ou mais → `recuperar`, com `desde = max(coalesce(sincronizado_ate, p_agora - 30 min) - 10 min, p_agora - 48 h)`; zera `queda_desde`, tentativas, lembretes; grava `ultima_recuperacao_em`. Senão `nada`.
- Não `open`: `connecting` por mais de 6 min desde `queda_desde` vale como `close`; `connecting` sem queda registra `queda_desde = p_agora` e devolve `nada`. Para `close`: se `tentativas_restart < 3` e último reinício há 4 min ou mais (ou nunca) → `reiniciar` (incrementa). Senão, se (`close` com 3 tentativas e último reinício há 4 min ou mais) ou (`inalcancavel` com 6 min ou mais de queda) e ainda não houve lembrete → `alertar` (lembretes = 1). Senão, se já houve lembrete há 60 min ou mais e `lembretes_enviados < 12` → `lembrar`. Caso contrário `nada`. O estado gravado é `connecting` (enquanto aguardando) ou `close`.

- [ ] **Step 1: Escrever o teste SQL (deve falhar)**

```sql
-- supabase/tests/0049_blindagem_canal.test.sql
begin;
do $t$
declare
  r jsonb; b boolean; t0 timestamptz := timestamptz '2026-10-20 12:00:00+00';
  sid text; n int;
begin
  -- mensagens vistas
  assert mayara.marcar_mensagem_vista('teste_vigia', 'MSG1', 'entrada', 'webhook') = true, 'primeira vez e nova';
  assert mayara.marcar_mensagem_vista('teste_vigia', 'MSG1', 'entrada', 'recuperacao') = false, 'segunda vez nao e nova';
  assert mayara.mensagem_ja_vista('teste_vigia', 'MSG1') = true and mayara.mensagem_ja_vista('teste_vigia', 'MSG2') = false, 'ja_vista';
  begin
    perform mayara.marcar_mensagem_vista('teste_vigia', 'MSG3', 'invalida', 'webhook');
    assert false, 'direcao invalida deveria falhar';
  exception when check_violation then null;
  end;

  -- mensagem humana: memoria e assuncao do lead
  insert into mayara.leads_autorizados (telefone, nome, status) values ('+5511999990491', 'Humano Teste', 'ativo');
  insert into mayara.session_state (session_key, estado, phone) values ('whatsapp:escritorio:+5511999990491', 'S2_QUALIFICACAO', '+5511999990491');
  r := mayara.tratar_mensagem_humana('teste_vigia', '+5511999990491', 'HUM1', 'Olá, aqui é do escritório. Posso ligar hoje?', t0);
  assert r ->> 'acao' = 'assumido' and (r ->> 'memoria') = 'true', 'humano assume e grava: ' || r::text;
  assert (select status from mayara.leads_autorizados where telefone = '+5511999990491') = 'bloqueado', 'lead assumido';
  select h.message ->> 'content' into sid from public.n8n_chat_histories h
   where h.session_id = 'whatsapp:escritorio:+5511999990491' order by h.id desc limit 1;
  assert sid = 'Mensagem enviada por uma pessoa do escritório: Olá, aqui é do escritório. Posso ligar hoje?', 'memoria: ' || coalesce(sid, 'null');
  assert (select (message ->> 'type') from public.n8n_chat_histories where session_id = 'whatsapp:escritorio:+5511999990491' order by id desc limit 1) = 'ai', 'tipo ai';
  assert mayara.registrar_mensagem_humana('+5511999990491', '   ', t0) = false, 'texto vazio nao grava';
  assert mayara.registrar_mensagem_humana('+5500000000000', 'x', t0) = false, 'telefone sem lead nao grava';

  -- mensagem da propria Mayara nao assume e nao grava
  insert into mayara.leads_autorizados (telefone, nome, status) values ('+5511999990492', 'Mayara Propria', 'ativo');
  insert into mayara.envios_log (canal_id, provedor, destino_chave, tipo, resultado, provedor_message_id, origem)
  values ('teste_vigia', 'evolution', mayara.chave_telefone('+5511999990492'), 'texto', 'enviado', 'PROPRIA1', 'teste');
  r := mayara.tratar_mensagem_humana('teste_vigia', '+5511999990492', 'PROPRIA1', 'texto da mayara', t0);
  assert r ->> 'acao' = 'mayara' and (r ->> 'memoria') = 'false', 'mensagem propria: ' || r::text;
  assert (select status from mayara.leads_autorizados where telefone = '+5511999990492') = 'ativo', 'mensagem propria nao assume';

  -- politica do vigia
  insert into mayara.canal_estado (canal_id, estado, atualizado_em, sincronizado_ate)
  values ('teste_vigia', 'open', t0, t0 - interval '5 minutes');
  update mayara.config set valor = 'false' where chave = 'canal_vigia';
  assert mayara.leitura_canal('teste_vigia', 'close', t0) ->> 'acao' = 'nada', 'vigia desligado';
  update mayara.config set valor = 'true' where chave = 'canal_vigia';
  assert mayara.leitura_canal('teste_vigia', 'xyz', t0) ->> 'acao' = 'nada', 'leitura invalida';
  assert mayara.leitura_canal('canal_que_nao_existe', 'open', t0) ->> 'acao' = 'nada', 'canal desconhecido';

  r := mayara.leitura_canal('teste_vigia', 'open', t0);
  assert r ->> 'acao' = 'recuperar' and (r ->> 'desde')::timestamptz = t0 - interval '15 minutes', 'primeira leitura recupera desde sincronizado-10min: ' || r::text;
  assert mayara.leitura_canal('teste_vigia', 'open', t0 + interval '2 minutes') ->> 'acao' = 'nada', 'open normal nao faz nada';
  assert mayara.leitura_canal('teste_vigia', 'open', t0 + interval '16 minutes') ->> 'acao' = 'recuperar', 'recuperacao periodica a cada 15 min';
  perform mayara.concluir_recuperacao('teste_vigia', t0 + interval '16 minutes');

  r := mayara.leitura_canal('teste_vigia', 'close', t0 + interval '20 minutes');
  assert r ->> 'acao' = 'reiniciar' and (r ->> 'tentativas')::int = 1, 'queda: reinicio 1: ' || r::text;
  assert mayara.leitura_canal('teste_vigia', 'close', t0 + interval '22 minutes') ->> 'acao' = 'nada', 'intervalo de 4 min';
  assert mayara.leitura_canal('teste_vigia', 'close', t0 + interval '24 minutes') ->> 'acao' = 'reiniciar', 'reinicio 2';
  assert mayara.leitura_canal('teste_vigia', 'close', t0 + interval '28 minutes') ->> 'acao' = 'reiniciar', 'reinicio 3';
  assert mayara.leitura_canal('teste_vigia', 'close', t0 + interval '30 minutes') ->> 'acao' = 'nada', 'espera apos o 3o reinicio';
  r := mayara.leitura_canal('teste_vigia', 'close', t0 + interval '32 minutes');
  assert r ->> 'acao' = 'alertar' and (r ->> 'minutos_fora')::int = 12, 'alerta apos 3 reinicios: ' || r::text;
  assert mayara.leitura_canal('teste_vigia', 'close', t0 + interval '34 minutes') ->> 'acao' = 'nada', 'sem alerta repetido de imediato';
  assert mayara.leitura_canal('teste_vigia', 'close', t0 + interval '93 minutes') ->> 'acao' = 'lembrar', 'lembrete apos 60 min';
  update mayara.canal_estado set lembretes_enviados = 12, ultimo_lembrete_em = t0 - interval '1 day' where canal_id = 'teste_vigia';
  assert mayara.leitura_canal('teste_vigia', 'close', t0 + interval '200 minutes') ->> 'acao' = 'nada', 'teto de 12 lembretes';

  r := mayara.leitura_canal('teste_vigia', 'open', t0 + interval '210 minutes');
  assert r ->> 'acao' = 'recuperar' and (r ->> 'desde')::timestamptz <= t0 + interval '20 minutes', 'volta: recupera cobrindo a queda: ' || r::text;
  select tentativas_restart, lembretes_enviados into n, sid from mayara.canal_estado where canal_id = 'teste_vigia';
  assert n = 0 and sid = '0' and (select queda_desde from mayara.canal_estado where canal_id = 'teste_vigia') is null, 'estado zerado ao voltar';

  -- connecting longo vale como close
  assert mayara.leitura_canal('teste_vigia', 'connecting', t0 + interval '300 minutes') ->> 'acao' = 'nada', 'connecting inicial registra queda';
  assert mayara.leitura_canal('teste_vigia', 'connecting', t0 + interval '305 minutes') ->> 'acao' = 'nada', 'connecting curto nao age';
  assert mayara.leitura_canal('teste_vigia', 'connecting', t0 + interval '307 minutes') ->> 'acao' = 'reiniciar', 'connecting de mais de 6 min vale como close';

  -- inalcancavel nao reinicia, so alerta depois de 6 min
  perform mayara.leitura_canal('teste_vigia', 'open', t0 + interval '400 minutes');
  assert mayara.leitura_canal('teste_vigia', 'inalcancavel', t0 + interval '410 minutes') ->> 'acao' = 'nada', 'inalcancavel inicial';
  r := mayara.leitura_canal('teste_vigia', 'inalcancavel', t0 + interval '417 minutes');
  assert r ->> 'acao' = 'alertar', 'inalcancavel alerta: ' || r::text;
  assert (select tentativas_restart from mayara.canal_estado where canal_id = 'teste_vigia') = 0, 'inalcancavel nao conta reinicio';

  -- concluir_recuperacao avanca o cursor e nunca recua
  perform mayara.concluir_recuperacao('teste_vigia', t0 + interval '500 minutes');
  perform mayara.concluir_recuperacao('teste_vigia', t0 + interval '100 minutes');
  assert (select sincronizado_ate from mayara.canal_estado where canal_id = 'teste_vigia') = t0 + interval '500 minutes', 'cursor so avanca';
end $t$;
rollback;
select 'OK 0049';
```

Antes de escrever a migration, conferir com `execute_sql` os nomes reais das colunas de `mayara.envios_log` (`select column_name from information_schema.columns where table_schema = 'mayara' and table_name = 'envios_log'`) e ajustar o `insert` do teste, não a regra testada. Conferir também que `mayara.session_state` aceita o `insert` mínimo do teste (colunas obrigatórias).

- [ ] **Step 2: Rodar e ver falhar**

Run: o teste acima com `execute_sql` (projeto `wuhvlvsolewslkawazlq`).
Expected: ERRO `function mayara.marcar_mensagem_vista(unknown, unknown, unknown, unknown) does not exist`.

- [ ] **Step 3: Escrever a migration**

```sql
-- supabase/migrations/0049_mayara_blindagem_canal.sql
insert into mayara.config (chave, valor) values ('canal_vigia', 'false') on conflict (chave) do nothing;
insert into mayara.config (chave, valor) values ('alerta_email_destino', '') on conflict (chave) do nothing;

create table if not exists mayara.mensagens_canal_vistas (
  canal_id text not null,
  message_id text not null,
  direcao text not null check (direcao in ('entrada', 'saida_humana', 'saida_mayara')),
  origem text not null check (origem in ('webhook', 'recuperacao')),
  visto_em timestamptz not null default now(),
  primary key (canal_id, message_id)
);
alter table mayara.mensagens_canal_vistas enable row level security;
revoke all on mayara.mensagens_canal_vistas from anon, authenticated;
create index if not exists mensagens_canal_vistas_visto_idx on mayara.mensagens_canal_vistas (visto_em);

alter table mayara.canal_estado
  add column if not exists queda_desde timestamptz,
  add column if not exists tentativas_restart int not null default 0,
  add column if not exists ultimo_restart_em timestamptz,
  add column if not exists lembretes_enviados int not null default 0,
  add column if not exists ultimo_lembrete_em timestamptz,
  add column if not exists sincronizado_ate timestamptz,
  add column if not exists ultima_recuperacao_em timestamptz;

-- Cursor inicial: a recuperacao nunca olha antes da implantacao.
update mayara.canal_estado
   set sincronizado_ate = coalesce(sincronizado_ate, now()), ultima_recuperacao_em = coalesce(ultima_recuperacao_em, now())
 where canal_id = 'escritorio';

create or replace function mayara.marcar_mensagem_vista(p_canal text, p_message_id text, p_direcao text, p_origem text)
returns boolean language plpgsql set search_path = '' as $$
declare v int;
begin
  if coalesce(btrim(p_message_id), '') = '' then
    return true;
  end if;
  insert into mayara.mensagens_canal_vistas (canal_id, message_id, direcao, origem)
  values (p_canal, p_message_id, p_direcao, p_origem)
  on conflict (canal_id, message_id) do nothing;
  get diagnostics v = row_count;
  return v > 0;
end $$;

create or replace function mayara.mensagem_ja_vista(p_canal text, p_message_id text)
returns boolean language sql stable set search_path = '' as $$
  select exists (select 1 from mayara.mensagens_canal_vistas where canal_id = p_canal and message_id = p_message_id)
$$;

create or replace function mayara.registrar_mensagem_humana(p_telefone text, p_texto text, p_quando timestamptz)
returns boolean language plpgsql set search_path = '' as $$
declare v_chave text := mayara.chave_telefone(p_telefone); v_sid text; v_texto text := btrim(coalesce(p_texto, ''));
begin
  if v_chave is null or v_texto = '' then
    return false;
  end if;
  select h.session_id into v_sid from public.n8n_chat_histories h
   where mayara.chave_telefone(substring(h.session_id from '[+0-9]+$')) = v_chave
   order by h.created_at desc limit 1;
  if v_sid is null then
    select s.session_key into v_sid from mayara.session_state s
     where mayara.chave_telefone(s.phone) = v_chave order by s.updated_at desc limit 1;
  end if;
  if v_sid is null then
    select 'whatsapp:escritorio:' || la.telefone into v_sid from mayara.leads_autorizados la where la.telefone_chave = v_chave;
  end if;
  if v_sid is null then
    return false;
  end if;
  insert into public.n8n_chat_histories (session_id, message, created_at)
  values (v_sid, jsonb_build_object('type', 'ai',
            'content', 'Mensagem enviada por uma pessoa do escritório: ' || left(v_texto, 1500),
            'tool_calls', '[]'::jsonb, 'additional_kwargs', '{}'::jsonb,
            'response_metadata', '{}'::jsonb, 'invalid_tool_calls', '[]'::jsonb),
          least(coalesce(p_quando, now()), now()));
  return true;
end $$;

create or replace function mayara.tratar_mensagem_humana(p_canal text, p_telefone text, p_message_id text, p_texto text, p_quando timestamptz)
returns jsonb language plpgsql set search_path = '' as $$
declare r jsonb; v_mem boolean := false;
begin
  r := mayara.humano_assumiu(p_canal, p_telefone, p_message_id);
  if (r ->> 'acao') in ('assumido', 'ignorado') then
    v_mem := mayara.registrar_mensagem_humana(p_telefone, p_texto, p_quando);
  end if;
  return r || jsonb_build_object('memoria', v_mem);
end $$;

create or replace function mayara.leitura_canal(p_canal text, p_estado_real text, p_agora timestamptz default now())
returns jsonb language plpgsql set search_path = '' as $$
#variable_conflict use_column
declare
  c mayara.canal_estado%rowtype;
  v_est text := lower(coalesce(p_estado_real, ''));
  v_acao text := 'nada';
  v_desde timestamptz;
  v_min int := 0;
  v_gravar text;
begin
  if coalesce((select valor from mayara.config where chave = 'canal_vigia'), 'false') <> 'true' then
    return jsonb_build_object('acao', 'nada', 'motivo', 'vigia_desligado');
  end if;
  if v_est not in ('open', 'connecting', 'close', 'inalcancavel') then
    return jsonb_build_object('acao', 'nada', 'motivo', 'leitura_invalida');
  end if;
  select * into c from mayara.canal_estado where canal_id = p_canal for update;
  if not found then
    return jsonb_build_object('acao', 'nada', 'motivo', 'canal_desconhecido');
  end if;

  if v_est = 'open' then
    if c.queda_desde is not null or c.estado <> 'open'
       or c.ultima_recuperacao_em is null or c.ultima_recuperacao_em <= p_agora - interval '15 minutes' then
      v_acao := 'recuperar';
      v_desde := greatest(coalesce(c.sincronizado_ate, p_agora - interval '30 minutes') - interval '10 minutes', p_agora - interval '48 hours');
    end if;
    update mayara.canal_estado
       set estado = 'open', atualizado_em = p_agora, ultimo_open_em = p_agora, queda_desde = null,
           tentativas_restart = 0, ultimo_restart_em = null, lembretes_enviados = 0, ultimo_lembrete_em = null,
           ultima_recuperacao_em = case when v_acao = 'recuperar' then p_agora else c.ultima_recuperacao_em end
     where canal_id = p_canal;
    return jsonb_build_object('acao', v_acao, 'desde', v_desde, 'minutos_fora', 0, 'tentativas', 0);
  end if;

  if c.queda_desde is null then
    c.queda_desde := p_agora;
  end if;
  v_min := floor(extract(epoch from (p_agora - c.queda_desde)) / 60)::int;
  if v_est = 'connecting' and v_min > 6 then
    v_est := 'close';
  end if;
  v_gravar := case when v_est = 'connecting' then 'connecting' else 'close' end;

  if v_est = 'close' and c.tentativas_restart < 3
     and (c.ultimo_restart_em is null or c.ultimo_restart_em <= p_agora - interval '4 minutes') then
    v_acao := 'reiniciar';
    c.tentativas_restart := c.tentativas_restart + 1;
    c.ultimo_restart_em := p_agora;
  elsif c.ultimo_lembrete_em is null
        and ((v_est = 'close' and c.tentativas_restart >= 3 and c.ultimo_restart_em <= p_agora - interval '4 minutes')
             or (v_est = 'inalcancavel' and v_min >= 6)) then
    v_acao := 'alertar';
    c.lembretes_enviados := 1;
    c.ultimo_lembrete_em := p_agora;
  elsif c.ultimo_lembrete_em is not null and c.ultimo_lembrete_em <= p_agora - interval '60 minutes'
        and c.lembretes_enviados < 12 then
    v_acao := 'lembrar';
    c.lembretes_enviados := c.lembretes_enviados + 1;
    c.ultimo_lembrete_em := p_agora;
  end if;

  update mayara.canal_estado
     set estado = v_gravar, atualizado_em = p_agora, queda_desde = c.queda_desde,
         tentativas_restart = c.tentativas_restart, ultimo_restart_em = c.ultimo_restart_em,
         lembretes_enviados = c.lembretes_enviados, ultimo_lembrete_em = c.ultimo_lembrete_em
   where canal_id = p_canal;
  return jsonb_build_object('acao', v_acao, 'desde', null, 'minutos_fora', v_min, 'tentativas', c.tentativas_restart);
end $$;

create or replace function mayara.concluir_recuperacao(p_canal text, p_ate timestamptz)
returns void language sql set search_path = '' as $$
  update mayara.canal_estado
     set sincronizado_ate = greatest(coalesce(sincronizado_ate, p_ate), p_ate)
   where canal_id = p_canal
$$;

revoke all on function mayara.marcar_mensagem_vista(text, text, text, text) from public, anon, authenticated;
revoke all on function mayara.mensagem_ja_vista(text, text) from public, anon, authenticated;
revoke all on function mayara.registrar_mensagem_humana(text, text, timestamptz) from public, anon, authenticated;
revoke all on function mayara.tratar_mensagem_humana(text, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function mayara.leitura_canal(text, text, timestamptz) from public, anon, authenticated;
revoke all on function mayara.concluir_recuperacao(text, timestamptz) from public, anon, authenticated;
```

- [ ] **Step 4: Aplicar a migration (`apply_migration`, nome `mayara_blindagem_canal`) e rodar o teste**

Run: o teste do Step 1 com `execute_sql`.
Expected: `OK 0049`. Se uma asserção do vigia divergir por detalhe de tempo (por exemplo `desde` ou `minutos_fora`), corrigir a **migration** quando for erro de lógica, e o teste só quando o erro estiver na conta dos minutos do próprio teste (ledger: `Ruling`). Depois conferir que `select canal_id, sincronizado_ate from mayara.canal_estado where canal_id = 'escritorio'` mostra o cursor inicial e que `canal_vigia` continua `false`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0049_mayara_blindagem_canal.sql supabase/tests/0049_blindagem_canal.test.sql
git commit -m "feat(canal): mensagens vistas, mensagem humana e politica do vigia (migration 0049)"
```

---

### Task 2: Bibliotecas `vigia.mjs` e `recuperar.mjs`

**Files:**
- Create: `docs/superpowers/specs/2026-10-14-blindagem-canal/vigia.mjs`, `vigia.test.mjs`, `recuperar.mjs`, `recuperar.test.mjs`

**Interfaces:**
- Consumes: `evolution-contrato.md` (Task 0, parte B) para a forma de `connectionState` e de `findMessages`; `normalizarEvolution(corpo, instancia)` de `docs/superpowers/specs/2026-10-03-camada-canal/evolucao.mjs`.
- Produces:
  - `vigia.mjs`: `estadoReal(resposta): 'open'|'connecting'|'close'|'inalcancavel'` e `textoAlerta(acao, minutosFora, tentativas): { assunto, texto }`;
  - `recuperar.mjs`: `janelaBusca(desdeIso, agoraIso): { gte, lte, ateIso }` (segundos, limite de 48 h e mínimo de 5 min), `corpoBusca(janela, pagina, tamanho): object`, `extrairRegistros(resposta): object[]` (aceita `array`, `{messages:{records}}` e `{records}`), `registroParaEvento(registro, instancia): object` (formato de webhook `messages.upsert`), `prepararLote(resposta, instancia, janela, limite): object[]` (ordem cronológica, só registros dentro da janela, corta em `limite`, sempre termina com um item sentinela `{ fim: true, ateIso }`).

- [ ] **Step 1: Escrever os testes (devem falhar)**

```js
// vigia.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { estadoReal, textoAlerta } from './vigia.mjs';

test('estadoReal le o estado da Evolution e trata falha como inalcancavel', () => {
  assert.equal(estadoReal({ instance: { instanceName: 'escritorio', state: 'open' } }), 'open');
  assert.equal(estadoReal({ state: 'connecting' }), 'connecting');
  assert.equal(estadoReal({ instance: { state: 'close' } }), 'close');
  assert.equal(estadoReal({ instance: { state: 'refused' } }), 'close');
  assert.equal(estadoReal({ error: 'timeout' }), 'inalcancavel');
  assert.equal(estadoReal({ message: 'Not Found', statusCode: 404 }), 'inalcancavel');
  assert.equal(estadoReal(null), 'inalcancavel');
  assert.equal(estadoReal(undefined), 'inalcancavel');
  assert.equal(estadoReal('texto'), 'inalcancavel');
});

test('textoAlerta explica o que fazer sem inventar o motivo', () => {
  const a = textoAlerta('alertar', 12, 3);
  assert.match(a.assunto, /WhatsApp do escritório fora do ar/);
  assert.match(a.texto, /12 minutos/);
  assert.match(a.texto, /3 tentativas de reinício/);
  assert.match(a.texto, /Conectar/);
  assert.match(a.texto, /não são recuperadas automaticamente|podem não ser recuperadas/);
  const l = textoAlerta('lembrar', 135, 3);
  assert.match(l.assunto, /continua fora do ar/);
  assert.match(l.texto, /2 horas e 15 minutos/);
  assert.doesNotMatch(l.texto, /senha|token|chave/i);
});
```

```js
// recuperar.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { janelaBusca, corpoBusca, extrairRegistros, registroParaEvento, prepararLote } from './recuperar.mjs';

const AGORA = '2026-10-20T15:00:00.000Z';
const reg = (id, ts, extra = {}) => ({ key: { id, fromMe: false, remoteJid: '5511999990401@s.whatsapp.net' }, messageTimestamp: ts, message: { conversation: 'oi ' + id }, ...extra });
const epoch = (iso) => Math.floor(Date.parse(iso) / 1000);

test('janela: respeita o desde, o minimo de 5 min e o teto de 48 h', () => {
  const j = janelaBusca('2026-10-20T14:00:00.000Z', AGORA);
  assert.equal(j.gte, epoch('2026-10-20T14:00:00.000Z'));
  assert.equal(j.lte, epoch(AGORA));
  assert.equal(j.ateIso, AGORA);
  assert.equal(janelaBusca('2026-10-20T14:59:00.000Z', AGORA).gte, epoch(AGORA) - 300);
  assert.equal(janelaBusca('2026-10-01T00:00:00.000Z', AGORA).gte, epoch(AGORA) - 48 * 3600);
  assert.equal(janelaBusca('lixo', AGORA).gte, epoch(AGORA) - 1800);
});

test('corpo de busca usa a janela e a paginacao', () => {
  const j = janelaBusca('2026-10-20T14:00:00.000Z', AGORA);
  assert.deepEqual(corpoBusca(j, 1, 200), { where: { messageTimestamp: { gte: j.gte, lte: j.lte } }, page: 1, offset: 200 });
});

test('extrai registros de array, de messages.records e de records', () => {
  const a = [reg('A', 1)];
  assert.deepEqual(extrairRegistros(a), a);
  assert.deepEqual(extrairRegistros({ messages: { records: a } }), a);
  assert.deepEqual(extrairRegistros({ records: a }), a);
  assert.deepEqual(extrairRegistros({ messages: { total: 0 } }), []);
  assert.deepEqual(extrairRegistros(null), []);
  assert.deepEqual(extrairRegistros({ error: 'x' }), []);
});

test('registro vira evento de webhook messages.upsert', () => {
  const e = registroParaEvento(reg('A', 10), 'escritorio');
  assert.equal(e.event, 'messages.upsert');
  assert.equal(e.instance, 'escritorio');
  assert.equal(e.data.key.id, 'A');
});

test('lote: cronologico, so dentro da janela, corta no limite e termina com sentinela', () => {
  const j = janelaBusca('2026-10-20T14:00:00.000Z', AGORA);
  const dentro = (min) => epoch('2026-10-20T14:00:00.000Z') + min * 60;
  const resp = { messages: { records: [reg('C', dentro(30)), reg('FORA', epoch('2026-10-20T13:00:00.000Z')), reg('A', dentro(5)), reg('B', dentro(10))] } };
  const lote = prepararLote(resp, 'escritorio', j, 100);
  assert.deepEqual(lote.map((i) => (i.fim ? 'FIM' : i.evento.data.key.id)), ['A', 'B', 'C', 'FIM']);
  assert.equal(lote[3].ateIso, AGORA);
  assert.deepEqual(prepararLote(resp, 'escritorio', j, 2).map((i) => (i.fim ? 'FIM' : i.evento.data.key.id)), ['A', 'B', 'FIM']);
  const vazio = prepararLote({ messages: { records: [] } }, 'escritorio', j, 100);
  assert.deepEqual(vazio, [{ fim: true, ateIso: AGORA }]);
  assert.deepEqual(prepararLote(null, 'escritorio', j, 100), [{ fim: true, ateIso: AGORA }]);
});

test('timestamp em objeto {low} tambem entra na janela', () => {
  const j = janelaBusca('2026-10-20T14:00:00.000Z', AGORA);
  const r = reg('L', { low: epoch('2026-10-20T14:30:00.000Z'), high: 0 });
  const lote = prepararLote([r], 'escritorio', j, 100);
  assert.equal(lote.length, 2);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test docs/superpowers/specs/2026-10-14-blindagem-canal/*.test.mjs`
Expected: FAIL (`Cannot find module './vigia.mjs'`).

- [ ] **Step 3: Implementar**

```js
// vigia.mjs
// Funcoes puras do vigia do canal. O corpo (sem export) e gerado para Code nodes do n8n por gerar-nodes.mjs.

export function estadoReal(resposta) {
  if (!resposta || typeof resposta !== 'object') return 'inalcancavel';
  const estado = String((resposta.instance && resposta.instance.state) ?? resposta.state ?? '').toLowerCase();
  if (estado === 'open') return 'open';
  if (estado === 'connecting') return 'connecting';
  if (estado === 'close' || estado === 'closed' || estado === 'refused') return 'close';
  return 'inalcancavel';
}

function duracao(minutos) {
  const m = Math.max(0, Math.round(minutos));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return m + ' minutos';
  return h + (h === 1 ? ' hora' : ' horas') + (r ? ' e ' + r + ' minutos' : '');
}

export function textoAlerta(acao, minutosFora, tentativas) {
  const fora = duracao(minutosFora);
  const assunto = acao === 'lembrar' ? 'WhatsApp do escritório continua fora do ar' : 'WhatsApp do escritório fora do ar';
  const texto = [
    'O WhatsApp do escritório está fora do ar há ' + fora + '. A Mayara não recebe nem responde leads enquanto isso.',
    tentativas > 0 ? 'O sistema fez ' + tentativas + ' tentativas de reinício automático sem sucesso.' : 'O sistema não conseguiu falar com a Evolution.',
    'O que fazer: abra o painel da Evolution (instância escritorio) e use Conectar para ler o QR no celular do escritório.',
    'Quando a conexão voltar, o sistema busca sozinho as mensagens do período e registra o que foi respondido pelo celular. Mensagens recebidas durante a queda podem não ser recuperadas automaticamente; confira no celular se algum lead ficou sem resposta.',
  ].join('\n\n');
  return { assunto, texto };
}
```

```js
// recuperar.mjs
// Funcoes puras da recuperacao de mensagens. O corpo (sem export) e gerado para Code nodes do n8n.

export function janelaBusca(desdeIso, agoraIso) {
  const agora = Date.parse(agoraIso);
  let desde = Date.parse(desdeIso);
  if (!Number.isFinite(desde)) desde = agora - 30 * 60 * 1000;
  desde = Math.max(desde, agora - 48 * 3600 * 1000);
  desde = Math.min(desde, agora - 5 * 60 * 1000);
  return { gte: Math.floor(desde / 1000), lte: Math.floor(agora / 1000), ateIso: new Date(agora).toISOString() };
}

export function corpoBusca(janela, pagina = 1, tamanho = 200) {
  return { where: { messageTimestamp: { gte: janela.gte, lte: janela.lte } }, page: pagina, offset: tamanho };
}

export function extrairRegistros(resposta) {
  if (Array.isArray(resposta)) return resposta;
  if (!resposta || typeof resposta !== 'object') return [];
  if (resposta.messages && Array.isArray(resposta.messages.records)) return resposta.messages.records;
  if (Array.isArray(resposta.records)) return resposta.records;
  return [];
}

export function registroParaEvento(registro, instancia) {
  return { event: 'messages.upsert', instance: instancia, data: registro };
}

function segundos(ts) {
  const n = Number(ts && typeof ts === 'object' ? ts.low : ts);
  return Number.isFinite(n) ? n : 0;
}

export function prepararLote(resposta, instancia, janela, limite) {
  const dentro = extrairRegistros(resposta)
    .map((r) => ({ r, t: segundos(r && r.messageTimestamp) }))
    .filter((x) => x.t >= janela.gte && x.t <= janela.lte)
    .sort((a, b) => a.t - b.t)
    .slice(0, Math.max(0, limite))
    .map((x) => ({ evento: registroParaEvento(x.r, instancia), timestamp: x.t }));
  return [...dentro, { fim: true, ateIso: janela.ateIso }];
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test docs/superpowers/specs/2026-10-14-blindagem-canal/*.test.mjs`
Expected: `pass 8`, `fail 0`. Se o contrato observado (Task 0) mostrar outro formato de resposta ou de filtro, ajustar `corpoBusca`/`extrairRegistros` **com teste novo primeiro** e registrar `Ruling`.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-10-14-blindagem-canal/
git commit -m "feat(canal): bibliotecas do vigia e da recuperacao de mensagens"
```

---

### Task 3: Evento humano com texto e data, e geração dos corpos de nó

**Files:**
- Modify: `docs/superpowers/specs/2026-10-03-camada-canal/evolucao.mjs` (ramo `fromMe`), `evolucao.test.mjs`
- Create: `docs/superpowers/specs/2026-10-14-blindagem-canal/gerar-nodes.mjs`, `gerar-nodes.test.mjs`
- Create (gerados): `vigia.node.js`, `recuperar.node.js`, `normalizar-lote.node.js`

**Interfaces:**
- Consumes: Task 2; `normalizarEvolution` (hoje devolve `{ acao: 'humano', canalId, phone, messageId }` para `fromMe`).
- Produces: `normalizarEvolution` passa a devolver também `texto` (string, pode ser vazia) e `timestamp` (ISO) no evento humano; `gerar-nodes.mjs` exporta `corpoVigia` (lê a resposta do `Estado Real` e devolve `{ estado }`), `corpoJanela` (entrada `desde`, devolve `janela`), `corpoLote` (junta `normalizarEvolution` e `prepararLote` e devolve itens `{ evento (normalizado), ... }` ou o sentinela), `corpoTextoAlerta`.

- [ ] **Step 1: Escrever o teste do evento humano (deve falhar)**

```js
// acrescentar a evolucao.test.mjs (usar o helper de fixture que o arquivo ja tem; ajustar o nome se for outro)
test('mensagem fromMe devolve acao humano com texto e data', () => {
  const corpo = {
    event: 'messages.upsert', instance: 'escritorio',
    data: { key: { id: 'HUM9', fromMe: true, remoteJid: '5511999990402@s.whatsapp.net' },
            messageTimestamp: 1760972400, message: { conversation: 'Bom dia, posso ligar agora?' } },
  };
  const r = normalizarEvolution(corpo, 'escritorio');
  assert.equal(r.acao, 'humano');
  assert.equal(r.messageId, 'HUM9');
  assert.equal(r.texto, 'Bom dia, posso ligar agora?');
  assert.equal(r.timestamp, new Date(1760972400 * 1000).toISOString());
});

test('fromMe sem texto (midia) devolve texto vazio', () => {
  const corpo = { event: 'messages.upsert', instance: 'escritorio',
    data: { key: { id: 'HUM10', fromMe: true, remoteJid: '5511999990402@s.whatsapp.net' }, messageTimestamp: 1760972400, message: { imageMessage: {} } } };
  assert.equal(normalizarEvolution(corpo, 'escritorio').texto, '');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test docs/superpowers/specs/2026-10-03-camada-canal/evolucao.test.mjs`
Expected: FAIL (`r.texto` indefinido).

- [ ] **Step 3: Alterar `evolucao.mjs`**

Na linha do ramo `fromMe` (hoje `return { acao: 'humano', canalId, phone, messageId };`), trocar por:

```js
    return { acao: 'humano', canalId, phone, messageId, texto: extrairTexto(data.message), timestamp: paraIso(data.messageTimestamp) };
```

(`extrairTexto` e `paraIso` já existem no arquivo.) Se o ramo calcular `texto` antes de chegar ali com outro nome, reaproveitar a variável existente.

- [ ] **Step 4: Rodar o teste da Task 3 e a suíte do canal**

Run: `node --test docs/superpowers/specs/2026-10-03-camada-canal/*.test.mjs`
Expected: `fail 0`.

- [ ] **Step 5: Escrever o teste do gerador de nós (deve falhar), depois o gerador**

```js
// gerar-nodes.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { corpoVigia, corpoJanela, corpoLote, corpoTextoAlerta } from './gerar-nodes.mjs';

const rodar = (corpo, entradas) => new Function('$', '$input', corpo)(
  (nome) => ({ first: () => ({ json: entradas[nome] || {} }) }),
  { first: () => ({ json: entradas.__input || {} }) });

test('nenhum corpo tem import/export', () => {
  for (const c of [corpoVigia, corpoJanela, corpoLote, corpoTextoAlerta]) assert.equal(/^\s*(import|export)\s/m.test(c), false);
});

test('vigia: converte a resposta da Evolution em estado', () => {
  assert.deepEqual(rodar(corpoVigia, { __input: { instance: { state: 'open' } } })[0].json, { estado: 'open' });
  assert.deepEqual(rodar(corpoVigia, { __input: { error: 'x' } })[0].json, { estado: 'inalcancavel' });
});

test('janela: usa o desde da entrada e a hora atual', () => {
  const j = rodar(corpoJanela, { 'Execute Workflow Trigger': { desde: '2026-10-20T14:00:00.000Z', simular: 'true' } })[0].json;
  assert.equal(typeof j.gte, 'number');
  assert.ok(j.lte >= j.gte + 300);
  assert.match(j.ateIso, /^\d{4}-\d\d-\d\dT/);
  assert.equal(j.simular, 'true');
  assert.deepEqual(j.corpo.where.messageTimestamp, { gte: j.gte, lte: j.lte });
});

test('lote: normaliza cada mensagem e termina com sentinela', () => {
  const janela = { gte: 1760972000, lte: 1760973000, ateIso: '2026-10-20T15:00:00.000Z', simular: 'false' };
  const resposta = { messages: { records: [
    { key: { id: 'IN1', fromMe: false, remoteJid: '5511999990403@s.whatsapp.net' }, messageTimestamp: 1760972500, message: { conversation: 'Quero ajuda' } },
    { key: { id: 'HUM1', fromMe: true, remoteJid: '5511999990403@s.whatsapp.net' }, messageTimestamp: 1760972600, message: { conversation: 'Já te respondo' } },
    { key: { id: 'GRP1', fromMe: false, remoteJid: '1203630@g.us' }, messageTimestamp: 1760972700, message: { conversation: 'grupo' } },
  ] } };
  const itens = rodar(corpoLote, { 'Janela': janela, __input: resposta }).map((i) => i.json);
  assert.equal(itens[itens.length - 1].fim, true);
  assert.equal(itens[itens.length - 1].simular, 'false');
  const por = Object.fromEntries(itens.filter((i) => !i.fim).map((i) => [i.messageId, i]));
  assert.equal(por.IN1.norm.acao, 'processar');
  assert.equal(por.HUM1.norm.acao, 'humano');
  assert.equal(por.HUM1.norm.texto, 'Já te respondo');
  assert.equal(por.GRP1.norm.acao, 'descartar');
});

test('texto do alerta usa a leitura do vigia', () => {
  const r = rodar(corpoTextoAlerta, { 'Registrar Leitura': { r: { acao: 'alertar', minutos_fora: 14, tentativas: 3 } } })[0].json;
  assert.match(r.assunto, /fora do ar/);
  assert.match(r.texto, /14 minutos/);
});
```

```js
// gerar-nodes.mjs: corpos dos Code nodes dos workflows de blindagem, a partir das bibliotecas testadas.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const sem = (arq) => readFileSync(arq, 'utf8').replace(/^export\s+/gm, '');
const vigia = sem(join(dir, 'vigia.mjs'));
const recuperar = sem(join(dir, 'recuperar.mjs'));
const evolucao = sem(join(dir, '..', '2026-10-03-camada-canal', 'evolucao.mjs'));
const CAB = '// Gerado por gerar-nodes.mjs a partir das bibliotecas testadas. Colar como esta.\n';

export const corpoVigia = [CAB, vigia,
  'const resposta = $input.first().json;',
  'return [{ json: { estado: estadoReal(resposta) } }];', ''].join('\n');

export const corpoJanela = [CAB, recuperar,
  "const e = $('Execute Workflow Trigger').first().json;",
  'const j = janelaBusca(e.desde, new Date().toISOString());',
  "return [{ json: { ...j, simular: String(e.simular || 'false'), corpo: corpoBusca(j, 1, 200) } }];", ''].join('\n');

export const corpoLote = [CAB, recuperar, evolucao,
  "const janela = $('Janela').first().json;",
  'const lote = prepararLote($input.first().json, "escritorio", janela, 100);',
  'return lote.map((i) => {',
  "  if (i.fim) return { json: { fim: true, ateIso: i.ateIso, simular: janela.simular } };",
  '  const norm = normalizarEvolution(i.evento, "escritorio");',
  "  return { json: { fim: false, simular: janela.simular, messageId: i.evento.data.key.id, timestamp: i.timestamp, norm } };",
  '});', ''].join('\n');

export const corpoTextoAlerta = [CAB, vigia,
  "const r = $('Registrar Leitura').first().json.r;",
  'return [{ json: textoAlerta(r.acao, r.minutos_fora, r.tentativas) }];', ''].join('\n');

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(join(dir, 'vigia.node.js'), corpoVigia);
  writeFileSync(join(dir, 'recuperar.node.js'), corpoJanela);
  writeFileSync(join(dir, 'normalizar-lote.node.js'), corpoLote);
  console.log('corpos gerados');
}
```

- [ ] **Step 6: Rodar tudo e commitar**

Run: `node --test docs/superpowers/specs/2026-10-14-blindagem-canal/*.test.mjs docs/superpowers/specs/2026-10-03-camada-canal/*.test.mjs && node docs/superpowers/specs/2026-10-14-blindagem-canal/gerar-nodes.mjs`
Expected: `fail 0`. O evento humano do Normalizar do webhook só muda ao vivo na Task 6.

```bash
git add docs/superpowers/specs/2026-10-03-camada-canal/evolucao.mjs docs/superpowers/specs/2026-10-03-camada-canal/evolucao.test.mjs docs/superpowers/specs/2026-10-14-blindagem-canal/
git commit -m "feat(canal): evento humano com texto e data e geracao dos corpos de no"
```

---

### Task 4: Workflows `Canal: Alertar Fora do WhatsApp`, `Canal: Recuperar` e `Canal: Vigia`

**Files:**
- Create: `docs/superpowers/specs/2026-10-14-blindagem-canal/gerar-workflows.mjs`, `gerar-workflows.test.mjs`
- Create (gerados): `docs/superpowers/specs/workflows/mayara-canal-alertar-fora.json`, `mayara-canal-recuperar.json`, `mayara-canal-vigia.json`

**Interfaces:**
- Consumes: Tasks 1 a 3; IDs vivos: credencial Postgres `nNpCUIhnDuVvTApU`, Evolution `vA1UKEhHVqwcLGWW`, EspoCRM `3CNvCGWMMDOyGD2n`, workflow de erro `CQyjBKLX0UheNh1q`; ID do `Canal: Processar Evento` (buscar por nome via REST); credencial Gmail (Task 0, A2).
- Produces: `montarAlertarFora(credEmail)`, `montarRecuperar(idProcessar, nosProcessar)`, `montarVigia(idAlertar, idRecuperar)`, cada uma devolvendo o JSON do workflow. O `Processar Evento` do `Recuperar` **reutiliza os parâmetros do nó de mesmo nome do receptor** (lidos de `mayara-canal-receber-evolution.json`) para não divergir.

Desenho:

`Canal: Alertar Fora do WhatsApp` (entrada `assunto`, `texto`, `criarTarefa`): `Destino` (Postgres: `select valor from mayara.config where chave = 'alerta_email_destino'`) → `Enviar E-mail` (Gmail send, `onError: continueRegularOutput`) → `Tarefa?` (IF `$('Execute Workflow Trigger').first().json.criarTarefa === 'true'`) → `Criar Tarefa no CRM` (mesmo POST da Task do `Canal: Estado`, com `name = assunto` e `description = texto`, `cAlertRule: 'WHATSAPP_LINHA_CAIDA_V1'`, `cAlertKey` com data/hora). Sem credencial de e-mail, o nó Gmail é gerado desabilitado (`disabled: true`) e o gerador avisa no console.

`Canal: Recuperar` (entrada `desde`, `simular`):
`Janela` (Code `corpoJanela`) → `Buscar` (HTTP POST `https://evolution.camparimadvogados.com.br/chat/findMessages/escritorio`, corpo `={{ JSON.stringify($json.corpo) }}`, credencial Evolution, `onError: continueRegularOutput`, timeout 30 s) → `Lote` (Code `corpoLote`) → `Cada Mensagem` (Loop Over Items, lote 1; saída 0 = concluído, saída 1 = item) → ramo do item: `Util?` (IF `norm.acao` é `processar` ou `humano`; falso volta ao laço) → `Marcar Vista` (Postgres; consulta por expressão: se `simular == 'true'` usa `select not mayara.mensagem_ja_vista($1,$2) as novo`, senão `select mayara.marcar_mensagem_vista($1,$2,$3,'recuperacao') as novo`) → `Novo?` (IF `novo === true`; falso volta ao laço) → `Simular?` (IF `simular == 'true'`; verdadeiro volta ao laço) → `Tipo` (Switch: `humano`, `processar`) → `Tratar Humano` (Postgres `select mayara.tratar_mensagem_humana($1,$2,$3,$4,$5::timestamptz) as r`, volta ao laço) | `Registrar Aceito` (Postgres `mayara.registrar_evento_canal(..., 'aceito', 'recuperacao', ...)`) → `Processar Evento` (Execute Workflow, `onError: continueRegularOutput`, volta ao laço). Saída concluído: `Concluir` (Postgres `select mayara.concluir_recuperacao('escritorio', $1::timestamptz)` apenas quando `simular != 'true'`, via `Concluir?` IF).

`Canal: Vigia`: `Agendar` (a cada 2 minutos) → `Estado Real` (HTTP GET `connectionState/escritorio`, credencial Evolution, `onError: continueRegularOutput`, timeout 10 s) → `Normalizar Leitura` (Code `corpoVigia`) → `Registrar Leitura` (Postgres `select mayara.leitura_canal('escritorio', $1) as r`) → `Acao` (Switch por `r.acao`: `reiniciar`, `alertar`, `lembrar`, `recuperar`) → `Reiniciar Instancia` (HTTP PUT `restart/escritorio`, `onError: continueRegularOutput`) | `Texto do Alerta` (Code `corpoTextoAlerta`; recebe `alertar` e `lembrar`) → `Alertar Fora do WhatsApp` (Execute Workflow; `criarTarefa = ={{ $('Registrar Leitura').first().json.r.acao === 'alertar' }}`) | `Recuperar` (Execute Workflow `Canal: Recuperar`, `desde = r.desde`, `simular = false`).

- [ ] **Step 1: Escrever o teste (deve falhar)**

```js
// gerar-workflows.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { montarAlertarFora, montarRecuperar, montarVigia } from './gerar-workflows.mjs';

const nomes = (w) => w.nodes.map((n) => n.name);
const no = (w, nome) => w.nodes.find((n) => n.name === nome);
const destinos = (w, origem, saida = 0) => (w.connections[origem].main[saida] || []).map((x) => x.node);
const PROC = { workflowId: { __rl: true, value: 'PROCESSAR_ID', mode: 'list' }, options: { waitForSubWorkflow: true }, workflowInputs: { value: {} } };

test('vigia: agendado a cada 2 min, sem webhook, com chaves de saida corretas', () => {
  const w = montarVigia('ALERTAR_ID', 'RECUPERAR_ID');
  assert.equal(w.name, 'Mayara — Canal: Vigia');
  assert.equal(no(w, 'Agendar').type, 'n8n-nodes-base.scheduleTrigger');
  assert.deepEqual(no(w, 'Agendar').parameters.rule.interval, [{ field: 'minutes', minutesInterval: 2 }]);
  for (const n of w.nodes) assert.ok(!/webhook|formTrigger|chatTrigger/i.test(n.type), n.type);
  assert.equal(no(w, 'Estado Real').onError, 'continueRegularOutput');
  assert.equal(no(w, 'Estado Real').parameters.url, 'https://evolution.camparimadvogados.com.br/instance/connectionState/escritorio');
  assert.equal(no(w, 'Estado Real').credentials.httpHeaderAuth.id, 'vA1UKEhHVqwcLGWW');
  assert.equal(no(w, 'Reiniciar Instancia').parameters.method, 'PUT');
  assert.equal(no(w, 'Reiniciar Instancia').parameters.url, 'https://evolution.camparimadvogados.com.br/instance/restart/escritorio');
  assert.deepEqual(destinos(w, 'Acao', 0), ['Reiniciar Instancia']);
  assert.deepEqual(destinos(w, 'Acao', 1), ['Texto do Alerta']);
  assert.deepEqual(destinos(w, 'Acao', 2), ['Texto do Alerta']);
  assert.deepEqual(destinos(w, 'Acao', 3), ['Recuperar']);
  assert.equal(no(w, 'Alertar Fora do WhatsApp').parameters.workflowId.value, 'ALERTAR_ID');
  assert.equal(no(w, 'Recuperar').parameters.workflowId.value, 'RECUPERAR_ID');
  assert.equal(no(w, 'Recuperar').parameters.workflowInputs.value.simular, 'false');
  assert.equal(w.settings.errorWorkflow, 'CQyjBKLX0UheNh1q');
});

test('vigia: o corpo do Code e o gerado e nao ha segredo no JSON', () => {
  const w = montarVigia('A', 'R');
  assert.ok(no(w, 'Normalizar Leitura').parameters.jsCode.includes('estadoReal('));
  assert.ok(no(w, 'Texto do Alerta').parameters.jsCode.includes('textoAlerta('));
  assert.doesNotMatch(JSON.stringify(w), /apikey|api[_-]?key"\s*:\s*"[A-Za-z0-9]{12,}|Bearer /i);
});

test('recuperar: laco por mensagem, idempotencia e simulacao', () => {
  const w = montarRecuperar(PROC);
  assert.equal(w.name, 'Mayara — Canal: Recuperar [Sub-workflow]');
  assert.deepEqual(no(w, 'Execute Workflow Trigger').parameters.workflowInputs.values.map((v) => v.name), ['desde', 'simular']);
  assert.equal(no(w, 'Buscar').parameters.url, 'https://evolution.camparimadvogados.com.br/chat/findMessages/escritorio');
  assert.equal(no(w, 'Buscar').onError, 'continueRegularOutput');
  assert.equal(no(w, 'Cada Mensagem').type, 'n8n-nodes-base.splitInBatches');
  assert.equal(no(w, 'Cada Mensagem').parameters.batchSize, 1);
  assert.deepEqual(destinos(w, 'Cada Mensagem', 0), ['Concluir?']);
  assert.deepEqual(destinos(w, 'Cada Mensagem', 1), ['Util?']);
  assert.ok(destinos(w, 'Util?', 1).includes('Cada Mensagem'));
  assert.ok(destinos(w, 'Novo?', 1).includes('Cada Mensagem'));
  assert.ok(destinos(w, 'Simular?', 0).includes('Cada Mensagem'));
  assert.ok(destinos(w, 'Tratar Humano', 0).includes('Cada Mensagem'));
  assert.ok(destinos(w, 'Processar Evento', 0).includes('Cada Mensagem'));
  assert.equal(no(w, 'Processar Evento').onError, 'continueRegularOutput');
  assert.equal(no(w, 'Processar Evento').parameters.workflowId.value, 'PROCESSAR_ID');
  const q = no(w, 'Marcar Vista').parameters.query;
  assert.ok(q.includes('mensagem_ja_vista') && q.includes('marcar_mensagem_vista') && q.includes("'recuperacao'"));
  assert.ok(no(w, 'Concluir').parameters.query.includes('concluir_recuperacao'));
  assert.ok(no(w, 'Tratar Humano').parameters.query.includes('tratar_mensagem_humana'));
  assert.ok(no(w, 'Registrar Aceito').parameters.query.includes('registrar_evento_canal'));
  for (const n of w.nodes) assert.ok(!/webhook|scheduleTrigger/i.test(n.type), n.type);
});

test('alertar fora: e-mail com destino da configuracao e tarefa no CRM so quando pedido', () => {
  const w = montarAlertarFora({ id: 'GMAIL_ID', name: 'Gmail account' });
  assert.deepEqual(nomes(w), ['Execute Workflow Trigger', 'Destino', 'Enviar E-mail', 'Tarefa?', 'Criar Tarefa no CRM']);
  assert.ok(no(w, 'Destino').parameters.query.includes("alerta_email_destino"));
  assert.equal(no(w, 'Enviar E-mail').onError, 'continueRegularOutput');
  assert.equal(no(w, 'Enviar E-mail').credentials.gmailOAuth2.id, 'GMAIL_ID');
  assert.equal(no(w, 'Enviar E-mail').disabled, undefined);
  assert.equal(no(w, 'Criar Tarefa no CRM').credentials.httpHeaderAuth.id, '3CNvCGWMMDOyGD2n');
  assert.deepEqual(destinos(w, 'Tarefa?', 0), ['Criar Tarefa no CRM']);
  assert.doesNotMatch(JSON.stringify(w), /@gmail\.com|@[a-z0-9-]+\.com\.br/i);
  assert.equal(no(montarAlertarFora(null), 'Enviar E-mail').disabled, true);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test docs/superpowers/specs/2026-10-14-blindagem-canal/gerar-workflows.test.mjs`
Expected: FAIL (`Cannot find module './gerar-workflows.mjs'`).

- [ ] **Step 3: Implementar o gerador**

Seguir o padrão de `docs/superpowers/specs/2026-10-12-central-linguagem-livre/gerar-workflows.mjs` e `docs/superpowers/specs/2026-10-09-abordagem-assistida/gerar-workflows.mjs` (helpers `pg`, `codigo`, `se`, `sub`, `lig`, uuids por prefixo). Pontos obrigatórios, todos cobertos pelo teste acima:

- Constantes: `EVO = 'https://evolution.camparimadvogados.com.br'`, credencial Evolution `{ httpHeaderAuth: { id: 'vA1UKEhHVqwcLGWW', name: 'Evolution API' } }`, Postgres `{ postgres: { id: 'nNpCUIhnDuVvTApU', name: 'Postgres account' } }`, CRM `{ httpHeaderAuth: { id: '3CNvCGWMMDOyGD2n', name: 'EspoCRM Integração n8n — Mayara' } }`, `ERRO = 'CQyjBKLX0UheNh1q'`, `settings: { executionOrder: 'v1', errorWorkflow: ERRO }`.
- `montarVigia(idAlertar, idRecuperar)`: nós e ligações conforme o desenho. `Acao` é um `switch` v3.2 com 4 regras sobre `={{ $json.r.acao }}` (`reiniciar`, `alertar`, `lembrar`, `recuperar`) e **sem** saída de fallback. O `Texto do Alerta` recebe as saídas 1 e 2. `Recuperar` envia `desde = ={{ $json.r.desde }}` e `simular = 'false'`.
- `montarRecuperar(parametrosProcessar)`: o parâmetro é o objeto `parameters` do nó `Processar Evento` do receptor (a CLI o lê de `mayara-canal-receber-evolution.json`, trocando o `workflowId` pelo ID vivo do `Canal: Processar Evento`). O `Tipo` é um `switch` com duas regras sobre `={{ $json.norm.acao }}` (`humano`, `processar`). `Tratar Humano` usa `queryReplacement` `[norm.canalId, norm.phone, norm.messageId, norm.texto, norm.timestamp]`. `Registrar Aceito` repete a chamada de `registrar_evento_canal` do receptor com resultado `aceito` e motivo `recuperacao`.
- Loop Over Items: `splitInBatches` `typeVersion: 3`, saída 0 = concluído, saída 1 = laço; todo caminho do corpo termina ligando de volta em `Cada Mensagem`.
- `montarAlertarFora(cred)`: com `cred` nulo o nó Gmail sai com `disabled: true`; o texto da mensagem é `={{ $('Execute Workflow Trigger').first().json.texto }}` e o assunto idem; `sendTo = ={{ $json.valor }}`. A tarefa no CRM copia o corpo do POST do `Canal: Estado` (campos `cAlert*` incluídos), com `name`/`description` vindos da entrada e `cAlertKey` = `'WHATSAPP_LINHA_CAIDA_V1:escritorio:' + $now.toUTC().toFormat('yyyyMMddHHmm')`.
- CLI: `node gerar-workflows.mjs --idProcessar <id> [--credEmail <id>:<nome>]` grava os três JSON em `docs/superpowers/specs/workflows/`; o `Vigia` e o `Recuperar` ficam ligados pelos IDs lidos de `--idAlertar` e `--idRecuperar` (passados depois que os sub-workflows existirem; ver Step 5).

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test docs/superpowers/specs/2026-10-14-blindagem-canal/*.test.mjs`
Expected: `fail 0`.

- [ ] **Step 5: Criar os três workflows no n8n, em ordem, e conferir**

1. Obter o ID do `Canal: Processar Evento` (REST `GET /workflows`, por nome).
2. Gerar e criar (REST `POST /workflows`) `Canal: Alertar Fora do WhatsApp` e **publicar**; anotar o ID.
3. Gerar e criar `Canal: Recuperar [Sub-workflow]` com o `Processar Evento` apontando para o ID do passo 1 e **publicar**; anotar o ID.
4. Gerar o `Canal: Vigia` com os IDs dos passos 2 e 3, criar **sem publicar** (inativo). A chave `canal_vigia` continua `false`.
5. Conferir cada um por GET: contagem de nós e de ligações iguais ao JSON gerado, `active` esperado, nenhuma credencial faltando.

Run (conferência): GET de cada ID e comparação de nós/ligações.
Expected: Alertar e Recuperar ativos; Vigia inativo.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-10-14-blindagem-canal/ docs/superpowers/specs/workflows/mayara-canal-alertar-fora.json docs/superpowers/specs/workflows/mayara-canal-recuperar.json docs/superpowers/specs/workflows/mayara-canal-vigia.json
git commit -m "feat(canal): workflows Vigia, Recuperar e Alertar Fora do WhatsApp"
```

---

### Task 5: Ensaio da recuperação em modo simulação (nada é enviado nem gravado)

**Files:**
- Create: nenhum (execução e registro no handoff)

**Interfaces:**
- Consumes: `Canal: Recuperar` publicado (Task 4) com `simular = 'true'`; canal `open`.
- Produces: contagem de mensagens que a recuperação trataria; prova de que a primeira execução não reprocessa histórico.

- [ ] **Step 1: Rodar o ensaio por agendamento temporário**

Não há execução manual por API, então: criar o workflow temporário `Ensaio Recuperar (temporario)` com `scheduleTrigger` (um disparo no próximo minuto) → `Execute Workflow` chamando `Canal: Recuperar` com `desde = (agora - 3 h)` e `simular = 'true'` → Code que devolve **apenas contagens** (`total`, `humano`, `processar`, `novas`); publicar, esperar o disparo, ler o resultado em `n8n_executions`, **despublicar e apagar** o temporário.
- [ ] **Step 2: Conferir os critérios**
  - Nenhuma linha nova em `mayara.mensagens_canal_vistas` (simulação não grava): `select count(*) from mayara.mensagens_canal_vistas where origem = 'recuperacao'` igual a 0.
  - Nenhuma resposta enviada: `mayara.envios_log` sem linhas novas no período do ensaio.
  - `sincronizado_ate` do canal não avançou.
  - Todas as mensagens contadas são posteriores ao `sincronizado_ate` inicial **ou** são histórico real que o webhook não registrou (o webhook só passa a marcar na Task 6); registrar quantas são, para dimensionar o risco antes de ligar (Review Focus 1).
- [ ] **Step 3: Registrar no handoff** (`docs/handoffs/claude-status.md`) as contagens, sem texto de mensagens nem telefones.

Expected: contagens plausíveis, zero efeitos colaterais. Se `novas` incluir mensagens antigas que seriam respondidas, **não avançar para a Task 7**: ajustar a janela inicial (por exemplo `sincronizado_ate = now()` de novo) com teste e `Ruling`.

---

### Task 6: Receptor de webhook: marcar vista e tratar mensagem humana

**Files:**
- Create: `docs/superpowers/specs/2026-10-14-blindagem-canal/gerar-receber-patch.mjs`, `gerar-receber-patch.test.mjs`
- Create (gerado): `docs/superpowers/specs/2026-10-14-blindagem-canal/receber-patch.json`
- Modify: `docs/superpowers/specs/workflows/mayara-canal-receber-evolution.json` (reexportação do estado vivo)

**Interfaces:**
- Consumes: `Canal: Receber Evolution` vivo (16 nós: `Normalizar Evento` → `Aceito?` → `Registrar Aceito` → `Preparar Evento` → `Processar Evento`; `Aceito?` falso → `Humano?` → `Aguardar Registro de Envio` → `Registrar Humano`); novo corpo do `Normalizar Evento` (evolucao.mjs da Task 3, mesmo gerador `gerar-receber.mjs` do canal).
- Produces: `operacoes()` no formato das operações de `n8n_update_partial_workflow`:
  - `updateNode` `Normalizar Evento` com o novo código;
  - novo nó `Marcar Vista` (Postgres, `onError: continueRegularOutput`): `select mayara.marcar_mensagem_vista($1,$2,'entrada','webhook') as novo`, entre `Registrar Aceito` e `Preparar Evento`;
  - novo nó `Marcar Vista Humano` (idem, direção `saida_humana`), entre `Humano?` (verdadeiro) e `Aguardar Registro de Envio`;
  - `updateNode` `Registrar Humano`: `select mayara.tratar_mensagem_humana($1,$2,$3,$4,$5::timestamptz) as r` com `queryReplacement` `[$json.canalId, $json.phone, $json.messageId, $json.texto, $json.timestamp]` (o nó recebe o item de `Preparar`? Conferir: se a saída do `Aguardar` já não carrega o evento, ler de `$('Normalizar Evento').first().json.evento`; o teste fixa a leitura correta).

- [ ] **Step 1: Escrever o teste do patch (deve falhar)**

```js
// gerar-receber-patch.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { operacoes } from './gerar-receber-patch.mjs';

const ops = operacoes();
const add = ops.filter((o) => o.type === 'addNode').map((o) => o.node);
const upd = ops.filter((o) => o.type === 'updateNode');
const lig = ops.filter((o) => o.type === 'addConnection');
const rem = ops.filter((o) => o.type === 'removeConnection');
const no = (n) => add.find((x) => x.name === n);

test('marca como vista toda mensagem aceita e toda mensagem humana, sem bloquear o fluxo', () => {
  assert.deepEqual(add.map((n) => n.name).sort(), ['Marcar Vista', 'Marcar Vista Humano']);
  for (const n of add) assert.equal(n.onError, 'continueRegularOutput');
  assert.ok(no('Marcar Vista').parameters.query.includes("'entrada', 'webhook'") || no('Marcar Vista').parameters.query.includes("'entrada','webhook'"));
  assert.ok(no('Marcar Vista Humano').parameters.query.includes('saida_humana'));
  assert.ok(rem.some((r) => r.source === 'Registrar Aceito' && r.target === 'Preparar Evento'));
  assert.ok(lig.some((l) => l.source === 'Registrar Aceito' && l.target === 'Marcar Vista'));
  assert.ok(lig.some((l) => l.source === 'Marcar Vista' && l.target === 'Preparar Evento'));
  assert.ok(rem.some((r) => r.source === 'Humano?' && r.target === 'Aguardar Registro de Envio'));
  assert.ok(lig.some((l) => l.source === 'Humano?' && l.target === 'Marcar Vista Humano' && l.branch === 'true'));
  assert.ok(lig.some((l) => l.source === 'Marcar Vista Humano' && l.target === 'Aguardar Registro de Envio'));
});

test('registrar humano passa a usar tratar_mensagem_humana com texto e data', () => {
  const u = upd.find((o) => o.nodeName === 'Registrar Humano');
  assert.ok(u.updates['parameters.query'].includes('tratar_mensagem_humana'));
  assert.ok(u.updates['parameters.options.queryReplacement'].includes('texto'));
  assert.ok(u.updates['parameters.options.queryReplacement'].includes('timestamp'));
});

test('o normalizador do webhook devolve texto e data do evento humano', () => {
  const u = upd.find((o) => o.nodeName === 'Normalizar Evento');
  const corpo = u.updates['parameters.jsCode'];
  assert.ok(corpo.includes('texto: extrairTexto(data.message)'));
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test docs/superpowers/specs/2026-10-14-blindagem-canal/gerar-receber-patch.test.mjs`
Expected: FAIL (`Cannot find module './gerar-receber-patch.mjs'`).

- [ ] **Step 3: Implementar o gerador do patch**

Seguir o padrão de `gerar-central-patch.mjs` da Fase 3 da linguagem livre (nós novos com ids `cd...`, funções `addNode`, `removeConnection`, `addConnection` com `branch`/`sourceIndex`, `updateNode` com chaves de caminho). O novo `jsCode` do `Normalizar Evento` é o que `gerar-receber.mjs` do canal gera com a `evolucao.mjs` nova (importar a função de montagem do corpo desse gerador; se ele não exportar, exportá-la com um teste, sem mudar o resultado atual).

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test docs/superpowers/specs/2026-10-14-blindagem-canal/*.test.mjs docs/superpowers/specs/2026-10-03-camada-canal/*.test.mjs`
Expected: `fail 0`.

- [ ] **Step 5: Aplicar ao vivo e conferir**

Procedimento do padrão do repositório: baixar o JSON vivo do `Canal: Receber Evolution` (REST GET), guardar backup fora do repositório, aplicar as operações com um aplicador local (mesma lógica de `addNode`, `removeConnection`, `addConnection` e `updateNode` usada na Central), PUT com `name`, `nodes`, `connections` e `settings` (sem `availableInMCP`), GET e conferir: 16 → 18 nós; `Registrar Aceito → Marcar Vista → Preparar Evento`; `Humano?[0] → Marcar Vista Humano → Aguardar Registro de Envio`; o workflow continua ativo. Reexportar para `docs/superpowers/specs/workflows/mayara-canal-receber-evolution.json`.

Validar o comportamento com mensagens reais só depois de reconectar o canal (Task 7). Com o canal fechado, conferir apenas a estrutura.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-10-14-blindagem-canal/ docs/superpowers/specs/workflows/mayara-canal-receber-evolution.json
git commit -m "feat(canal): receptor marca mensagens vistas e trata mensagem humana"
```

---

### Task 7: Ligar a blindagem, ensaio ao vivo, runbook e handoff

**Files:**
- Create: `docs/runbooks/canal-whatsapp.md`
- Modify: `docs/handoffs/claude-status.md`

**Interfaces:**
- Consumes: Tasks 1 a 6; canal `open` (reconectado pelo usuário); `alerta_email_destino` informado pelo usuário; `respostas_retidas` ainda `true` até o contexto ser conferido.
- Produces: vigia em produção; roteiro de operação.

- [ ] **Step 1: Configurar o destino dos alertas e ligar a chave**

`update mayara.config set valor = '<e-mail informado pelo usuário>' where chave = 'alerta_email_destino'` (executado por SQL, sem gravar o endereço em arquivo do repositório). Publicar `Canal: Vigia` e então `update mayara.config set valor = 'true' where chave = 'canal_vigia'`. Conferir nas execuções do `Vigia` (via `n8n_executions`) que roda a cada 2 minutos, lê `open` e que `ultima_recuperacao_em` avança a cada ~15 minutos.

- [ ] **Step 2: Ensaio de reinício (com aviso ao usuário)**

Combinar um horário de baixo movimento. Executar **um** `PUT /instance/restart/escritorio` pelo `Reiniciar Instancia` (disparado por um agendamento temporário de uma execução, apagado depois) e observar: `connecting`, volta a `open`, uma única `recuperar` com `desde` cobrindo a janela, nenhum alerta, nenhuma mensagem duplicada. Se o reinício não devolver `open` em 3 minutos, parar e reconectar por QR (o ensaio termina).
Expected: queda breve registrada, recuperação executada uma vez, `mensagens_canal_vistas` crescendo sem duplicatas.

- [ ] **Step 3: Ensaio de alerta (sem derrubar nada)**

Chamar `mayara.leitura_canal('escritorio', 'inalcancavel', now())` não deve ser feito em produção. Em vez disso, executar `Canal: Alertar Fora do WhatsApp` com o texto de teste `[ENSAIO] alerta de queda do WhatsApp` e `criarTarefa = false` (por agendamento temporário) e confirmar que o e-mail chegou ao usuário e que o Gmail registra o envio. Apagar o temporário.
Expected: e-mail recebido; nenhuma tarefa criada.

- [ ] **Step 4: Escrever o runbook**

`docs/runbooks/canal-whatsapp.md` com: sintomas e o que o sistema faz sozinho (vigia a cada 2 min, até 3 reinícios, alerta por e-mail e tarefa no CRM, lembrete a cada 60 min até 12 vezes); o que o usuário faz quando recebe o alerta (painel da Evolution, instância `escritorio`, Conectar, QR); como desligar a blindagem (`update mayara.config set valor = 'false' where chave = 'canal_vigia'`); como conferir a recuperação (`select * from mayara.mensagens_canal_vistas order by visto_em desc limit 20`); a checklist de causas da Task 0 (A1); e o aviso de que mensagens perdidas durante a queda podem não ser reentregues pela Evolution. Sem segredos nem dados de clientes.

- [ ] **Step 5: Atualizar o handoff e commitar**

Em `docs/handoffs/claude-status.md`: objetivo, arquivos, testes (suítes JS e `OK 0049`), resultado dos ensaios, pendências (causa raiz da Task 0, decisão sobre a API oficial da Meta) e riscos. Depois:

```bash
git add docs/runbooks/canal-whatsapp.md docs/handoffs/claude-status.md
git commit -m "docs(canal): runbook da blindagem e handoff"
```
