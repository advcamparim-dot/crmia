# Painel Camparim, Etapa 3A (Histórico e funil): Plano de Execução

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline).

**Goal:** Registrar os eventos de cada lead (reconstruídos do que já existe e mantidos em dia) e mostrar o quadro "Análise do funil" com entraram, avançaram, perderam e quantos estão agora em cada etapa.

**Architecture:** Tabela `painel.eventos` só de acréscimo, preenchida pela função `painel.eventos_atualizar()` (idempotente) a partir de `crm_sync.leads`, `mayara.envios_log`, `painel._entradas()`, `mayara.followups_log`, `mayara.session_state` e `mayara.leads_autorizados`. Um pequeno worker do n8n chama a função a cada 10 minutos (não há `pg_cron`). `painel.funil_periodo(de, ate)` calcula o funil por coorte sobre os eventos. O quadro novo entra no catálogo e é lido por `carregarPainel` como as demais seções.

**Tech Stack:** Supabase Postgres, n8n, Next.js 14, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-18-painel-camparim-design.md` (seção "Funil e histórico"); etapa anterior: `docs/superpowers/plans/2026-10-19-painel-camparim-etapa2.md`.

## Global Constraints

- Só leitura no painel; a única escrita nova é a da função de eventos, executada pelo worker (não pelo painel). Nenhuma função de `painel` devolve texto de conversa.
- Quadro que falha mostra "indisponível" (`carregar`/`texto`), nunca zero por erro.
- Contagem sempre por `telefone_chave`. Fuso `America/Sao_Paulo`. Migrations a partir de `0074`; testes SQL em transação desfeita terminando em `select 'OK NNNN'`; funções com `set search_path = ''`, sem `execute` para `public/anon/authenticated`, com `execute` para `painel_leitura`.
- Não alterar a Mayara, a régua, a reativação nem o sincronizador do funil do CRM.
- Commits terminam com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; nada de telefones ou nomes reais em arquivos versionados.

## Definições (decisões minhas)

- **Eventos:** `lead_criado` (data de criação no CRM), `primeira_mensagem` (primeiro envio da Mayara por ponte, abordagem ou reativação), `lead_respondeu` (primeira mensagem aceita do lead), `followup_enviado` (um por envio), `consulta_marcada`, `transferido_equipe`, `perdido` e, na 3B, `contrato_fechado`. O evento "devolvido à Mayara" fica de fora: nenhuma tabela guarda o instante nem o lead.
- **Datas aproximadas:** `consulta_marcada`, `transferido_equipe` e `perdido` usam a hora da última atualização da linha de origem no primeiro momento em que o evento é visto (as tabelas não guardam o instante exato). O campo `detalhe` marca `aprox: true`.
- **Etapas e posto:** Novo (1), Em conversa (2), Consulta (3), Com a equipe (3), Contrato (4). *Entraram* = leads cujo evento da etapa caiu no período; *avançaram* = entraram e têm evento de posto maior; *perderam* = entraram, têm `perdido` e nenhum evento de posto maior; *agora* = quantos estão na etapa neste momento (`painel.leads_por_etapa()`).
- **Histórico disponível:** desde 06/10/2026; o quadro avisa isso.

## Review Focus

1. Lead criado antes do histórico do canal (06/10) não pode contar como "perdido" por falta de evento.
2. Evento repetido: rodar a função duas vezes não duplica (follow-up conta um por envio).
3. Lead duplicado (duas variantes do telefone) conta uma vez em cada etapa.
4. Período que cai na fronteira (`>= de` e `< ate`).
5. Quadro novo aparece no fim do arranjo salvo, sem quebrar a página.

## File Structure

- Create: `supabase/migrations/0074_painel_eventos.sql`, `0075_painel_funil_periodo.sql` e os testes `supabase/tests/0074_*.test.sql`, `0075_*.test.sql`
- Modify: `painel-executivo/lib/widgets.ts`, `lib/layout.ts`, `lib/painel-dados.ts` (+ testes), `app/painel/page.tsx`, `app/painel/page.test.ts`
- Create: `painel-executivo/app/painel/widgets/AnaliseFunil.tsx`, workflow n8n `Painel: Atualizar Eventos [Worker]` e seu export

---

### Task 1: Tabela de eventos e função de atualização (0074)

**Interfaces:** Produces `painel.eventos(id bigserial, lead_chave text, tipo text, ocorrido_em timestamptz, ref text, detalhe jsonb, criado_em timestamptz)` com `unique (lead_chave, tipo, ref)` e `painel.eventos_atualizar() returns integer` (quantos eventos novos).

- [ ] Teste SQL com fontes sintéticas: um evento de cada tipo, rodar duas vezes sem duplicar, follow-ups separados por `ref`, lead fora da lista só com `lead_criado`, lead de variante de telefone contado uma vez, `anon` sem `execute`. Expected antes: erro (tabela não existe). Depois da migration: `OK 0074`.
- [ ] Conferir com os dados reais: contagem por tipo coerente com as tabelas de origem.

### Task 2: Funil por período (0075)

**Interfaces:** Produces `painel.funil_periodo(p_de timestamptz, p_ate timestamptz) returns table(etapa text, ordem int, entraram int, avancaram int, perderam int, agora int)`, cinco linhas (Novo, Em conversa, Consulta, Com a equipe, Contrato).

- [ ] Teste SQL com eventos inseridos à mão: avançou, perdeu na etapa, perdeu depois de avançar (não conta como perdido na etapa anterior), fronteira do período, `agora` igual a `leads_por_etapa()`, lead repetido uma vez só.
- [ ] Migration, aplicar, `OK 0075`; conferir os números reais.

### Task 3: Quadro "Análise do funil" no painel

**Interfaces:** Consumes `painel.funil_periodo`. Produces `WidgetId 'analise-funil'` (catálogo, 6×6), `FunilEtapa { etapa; entraram; avancaram; perderam; agora }`, seção `funil: Carregado<FunilEtapa[]>` em `carregarPainel` e o componente `AnaliseFunil`. `ARRANJO_PADRAO` ganha o quadro abaixo de "Leads por etapa".

- [ ] Testes: `painel-dados.test.ts` (chama a função com `de` e `ate`; falha vira indisponível sem derrubar as outras), `layout.test.ts` (padrão completo com o quadro novo), `page.test.ts` (quadro mostra as cinco etapas e o aviso "histórico desde 06/10"; quando falha mostra "indisponível").
- [ ] Implementar, rodar `vitest`, `tsc` e `next build`.

### Task 4: Atualização automática, publicação e registro

- [ ] Worker n8n `Painel: Atualizar Eventos [Worker]` (a cada 10 min, `select painel.eventos_atualizar()`), com execução de prova.
- [ ] Publicar no GitHub (repositório do painel) e conferir `/api/saude` e `/painel`.
- [ ] Registrar no handoff e neste plano.

## Registro de execução

- **Task 1 concluída em 22/10** (`OK 0074`): `painel.eventos` (única `(lead_chave, tipo, ref)`) e `painel.eventos_atualizar()`; follow-up conta um por envio (`ref = 'f' || id`), a variante do telefone conta uma vez, envio de alerta e follow-up não contam como "primeira mensagem". Carga real: 83 `lead_criado` (= leads do CRM), 51 `followup_enviado` (= `followups_log` enviados), 39 `primeira_mensagem`, 23 `lead_respondeu`, 4 `transferido_equipe`, 3 `perdido`.
  - Ruling: não houve execução RED separada do teste (a tabela e a função não existiam, falha trivial); o teste foi aplicado só depois da migration.
- **Task 2 concluída em 22/10** (`OK 0075`): `painel.funil_periodo`. Conferência real desde 01/10: Novo 83 entraram, 23 avançaram, 60 agora; Em conversa 23 entraram, 4 avançaram, 3 perderam, 16 agora (a soma fecha em cada etapa).
  - Ruling: "perderam" não exige que a perda seja posterior à entrada (as datas de perda são aproximadas); basta ter `perdido` e nenhum evento de posto maior.
- **Task 3 concluída em 22/10** (97/97 testes, `tsc` limpo, `next build` ok): quadro `analise-funil` (catálogo 12×6, no fim do arranjo padrão; arranjos salvos recebem o quadro no fim), seção `funil` em `carregarPainel`, `AnaliseFunil.tsx` com o aviso "Histórico disponível desde 06/10/2026".
- **Task 4:** worker `Painel — Atualizar Eventos [Worker]` (`IQgkk6SHyAOdUVhq`, a cada 10 min) criado e ativo; código publicado no GitHub (`46d976b`).
