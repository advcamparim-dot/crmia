# Painel Camparim, Etapa 2 (Base do painel): Plano de Execução

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar a tela inicial configurável do painel: barra de períodos, faixa de números, fila "Precisa de você", leads por etapa, follow-ups do dia, fontes de lead e tempo de resposta, com dados reais da Mayara e grade de quadros arrastáveis com arranjo guardado no banco.

**Architecture:** Cada quadro lê de uma função SQL do schema `painel` (sobre as tabelas da Mayara e do espelho do CRM), pelo `carregar()` da Etapa 1, então um quadro que falha mostra "indisponível" sozinho. A tela é uma nova rota `/painel` com uma grade (`react-grid-layout`); o arranjo é validado no servidor e guardado por uma função de banco. A etapa 3 (eventos, funil, metas, contratos) vem depois e acrescenta quadros ao mesmo catálogo.

**Tech Stack:** Next.js 14, React 18, `pg`, Vitest, `react-grid-layout`, Supabase Postgres (`wuhvlvsolewslkawazlq`).

**Spec:** `docs/superpowers/specs/2026-10-18-painel-camparim-design.md` (etapa anterior: `docs/superpowers/plans/2026-10-18-painel-camparim.md`, tasks 1 a 3 concluídas).

## Global Constraints

- Só leitura nesta etapa, com **uma** exceção: salvar o arranjo dos quadros (função `painel.layout_salvar`). Contratos, parcelas, metas e funil por coorte ficam para a etapa 3.
- Um quadro que falha mostra "indisponível" (usar `carregar`/`texto` de `lib/carregado.ts`); nunca zero por erro.
- O painel não mostra texto de conversa de lead: nenhuma função de `painel` devolve conteúdo de mensagem.
- Não alterar a Mayara, a régua de follow-up nem a abordagem automática. A única mudança fora do painel é acrescentar um registro de falha de agendamento no workflow `Avisar Falha de Agendamento` (Task 4).
- Fuso `America/Sao_Paulo` em todas as fronteiras de período. Contagem de leads sempre por `telefone_chave` (nunca por sessão: há leads com duas sessões e variantes do nono dígito).
- Migrations a partir de `0066` (`0062` reservado ao trabalho paralelo de handoff). Testes SQL em `supabase/tests/NNNN_*.test.sql`, dentro de `begin; ... rollback;`, terminando em `select 'OK NNNN' as resultado;`, com dados sintéticos (`+551199999xxxx`). Funções com `set search_path = ''`, `revoke all ... from public, anon, authenticated` e `grant execute ... to painel_leitura`. A ferramenta SQL recusa `delete` e `drop`.
- Identidade "Câmara" (`#0d1310`, `#141d18`, `#b08a5a`, `#c9ab7d`; Lora, Karla, IBM Plex Mono). Login único.
- Commits terminam com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; nada de senhas, URLs de conexão nem telefones reais em arquivos versionados.

## Definições (decisões minhas, do design, para o construtor seguir)

- **Estágio de um lead** (primeira regra que casar): `Contrato` (sempre 0 até a etapa 3) → `Consulta` (`consulta_agendada_em` preenchida) → `Com a equipe` (`leads_autorizados.status = 'bloqueado'` ou `session_state.estado = 'S7_HANDOFF_HUMANO'`) → `Em conversa` (o lead já respondeu alguma vez) → `Novo` (o lead nunca respondeu). `sem_interesse` conta à parte como "Perdidos".
- **Faixa de números** (período `[de, ate)`): *Leads novos* = `crm_sync.leads.created_at` no período. *Em conversa* = leads distintos que escreveram no período. *Sem resposta* = leads cuja primeira mensagem da Mayara caiu no período e que nunca responderam. *Follow-ups* = `followups_log.estado = 'enviado'` no período. *Consultas* = `consulta_agendada_em` dentro do período. *Canal* = `canal_estado.estado`.
- **Tempo de resposta** = média do intervalo entre mensagem do lead e a resposta seguinte da Mayara (histórico `n8n_chat_histories`, ignorando linhas de ferramenta, `'[]'` e notas do sistema), mais a maior espera atual de um lead da fila tipo 1.
- **Fonte de lead** = `crm_sync.leads.campaign`, ou "sem origem".

## Review Focus

1. **Item da fila some quando resolve:** para cada tipo, o teste cobre o caso em aberto e o resolvido (resposta do escritório depois do lead; consulta marcada depois da falha; lead devolvido à Mayara).
2. **Fronteiras de período:** "Hoje", "Ontem", "Semana", "Mês" e "Período livre" em `America/Sao_Paulo`, inclusive meia-noite, virada de mês e datas invertidas no período livre.
3. **Lead duplicado não conta dobrado:** lead com duas sessões ou duas variantes do telefone entra uma vez só em todas as contagens.
4. **Arranjo salvo estragado ou antigo:** JSON inválido, versão desconhecida ou quadro que saiu do catálogo cai no arranjo padrão sem quebrar a página; quadro novo do catálogo aparece no fim.
5. **Nenhum texto de mensagem sai do banco:** teste confere que as colunas das funções de `painel` não incluem conteúdo de conversa.
6. **Celular:** abaixo de 700 px os quadros empilham em uma coluna, com a fila primeiro, e o arrastar fica desligado.
7. **Falha de um quadro não afeta os outros**, já na rota nova.

## File Structure

- Create: `supabase/migrations/0066_painel_numeros.sql`, `0067_painel_falhas_agendamento.sql`, `0068_painel_fila.sql`, `0069_painel_layout.sql` e os testes `supabase/tests/0066_..0069_*.test.sql`
- Create: `painel-executivo/lib/periodos.ts`, `lib/layout.ts`, `lib/widgets.ts`, `lib/painel-dados.ts` (+ testes `.test.ts` ao lado)
- Create: `painel-executivo/app/painel/page.tsx`, `app/painel/Grade.tsx` (cliente), `app/painel/widgets/*.tsx`, `app/painel/actions.ts`
- Modify: `painel-executivo/app/page.tsx` (redireciona para `/painel`), `painel-executivo/package.json` (`react-grid-layout`), workflow `2Z3f0Ka1aOsuRwr8` e `docs/superpowers/specs/workflows/mayara-avisar-falha-agendamento.json`
- Test: os `.test.ts` e `.test.sql` acima, e `app/painel/page.test.ts`

---

### Task 1: Períodos

**Files:** Create `lib/periodos.ts`; Test `lib/periodos.test.ts`

**Interfaces:** Produces `type Preset = 'hoje' | 'ontem' | 'semana' | 'mes' | 'livre'`; `resolverPeriodo(preset: Preset, agora: Date, livre?: { de: string; ate: string }): { de: Date; ate: Date; rotulo: string }` (intervalo `[de, ate)`, fuso `America/Sao_Paulo`); `lerPeriodoDaUrl(params: { periodo?: string; de?: string; ate?: string }, agora: Date): { preset: Preset; de: Date; ate: Date; rotulo: string }` (valor desconhecido cai em `semana`).

- [ ] **Step 1: Escrever `lib/periodos.test.ts`:** `hoje vai de 00:00 a 24:00 de São Paulo`, `ontem é o dia anterior completo`, `semana começa na segunda 00:00` (inclusive quando hoje é domingo), `mes começa no dia 1 e funciona na virada de mês e de ano`, `livre usa as datas dadas, ate inclusivo vira o início do dia seguinte`, `livre com datas invertidas troca de/ate`, `livre inválido cai em semana`, `lerPeriodoDaUrl com valor desconhecido devolve semana`.
- [ ] **Step 2: Rodar** `npx vitest run lib/periodos.test.ts`. Expected: FAIL (módulo não existe).
- [ ] **Step 3: Implementar** `lib/periodos.ts` com `Intl.DateTimeFormat` em `America/Sao_Paulo` (sem dependência nova); o relógio entra por parâmetro para o teste ser determinístico.
- [ ] **Step 4: Rodar** o teste e `npx tsc --noEmit`. Expected: passam. **Commit** `feat(painel): periodos Hoje, Ontem, Semana, Mes e Periodo livre`.

### Task 2: Faixa de números e leads por etapa (SQL)

**Files:** Create `0066_painel_numeros.sql`; Test `0066_painel_numeros.test.sql`

**Interfaces:** Produces (schema `painel`): `faixa_numeros(p_de timestamptz, p_ate timestamptz) returns jsonb` com as chaves `leads_novos`, `em_conversa`, `sem_resposta`, `followups`, `consultas`, `canal` (inteiros e texto); `leads_por_etapa() returns table(etapa text, quantidade int)` (as cinco etapas sempre presentes, mais `Perdidos`); `followups_periodo(p_de, p_ate) returns table(enviados int, respostas int, falhas int)` (*respostas* = lead respondeu depois de um follow-up no período); `fontes_de_lead(p_de, p_ate) returns table(fonte text, quantidade int)`; `tempo_resposta(p_de, p_ate) returns table(media_segundos int, maior_espera_segundos int)`.

- [ ] **Step 1: Escrever o teste SQL** com leads sintéticos que cobrem: lead com duas sessões e duas variantes do telefone contado uma vez; lead que respondeu e lead que nunca respondeu; lead com consulta marcada; lead assumido (`bloqueado`); lead `sem_interesse` em "Perdidos"; mensagem na fronteira do período (`>= de` e `< ate`); `fontes_de_lead` com campanha nula virando "sem origem"; `tempo_resposta` ignorando linhas `'[]'`, de ferramenta e notas do sistema; `leads_por_etapa` somando o total de leads cadastrados; `anon` sem `execute`.
- [ ] **Step 2: Rodar** o teste com `execute_sql`. Expected: erro (funções não existem).
- [ ] **Step 3: Escrever a migration** com as cinco funções (somente leitura, `stable`), aplicar com `apply_migration` e rodar o teste. Expected: `OK 0066`.
- [ ] **Step 4: Conferir contra os dados reais** (consulta manual, sem alterar nada): `select * from painel.leads_por_etapa()` soma o número de leads em `leads_autorizados`. **Commit** `feat(painel): funcoes de numeros e etapas (migration 0066)`.

### Task 3: Falhas de agendamento (registro novo)

**Files:** Create `0067_painel_falhas_agendamento.sql`, `0067_painel_falhas_agendamento.test.sql`; Modify workflow `2Z3f0Ka1aOsuRwr8`, `docs/superpowers/specs/workflows/mayara-avisar-falha-agendamento.json`

**Interfaces:** Produces tabela `painel.falhas_agendamento(id bigserial, telefone_chave text, motivo text, criada_em timestamptz default now(), resolvida_em timestamptz)` e `painel.registrar_falha_agendamento(p_telefone text, p_motivo text) returns bigint` (idempotente: não duplica falha aberta do mesmo lead nos últimos 10 minutos).

- [ ] **Step 1: Escrever o teste SQL:** registra e devolve o id; segunda chamada em 10 min devolve o mesmo id; telefone inválido recusa; `anon` sem `execute`. Rodar. Expected: erro.
- [ ] **Step 2: Escrever a migration**, aplicar e rodar. Expected: `OK 0067`.
- [ ] **Step 3: Patch do workflow `Avisar Falha de Agendamento`:** acrescentar um nó Postgres que chama `painel.registrar_falha_agendamento($1, $2)` com o telefone da sessão e o `motivoFalha`, em paralelo ao aviso existente e com `onError: continueRegularOutput` (nunca atrapalha o aviso ao administrador). Padrão do projeto: GET do workflow vivo, patch gerado com teste de estrutura (Node), PUT, GET para conferir, exportar para `docs/superpowers/specs/workflows/`.
- [ ] **Step 4: Provar com uma execução de teste** do sub-workflow (dados fictícios, mensagem de teste ao administrador) e conferir a linha em `painel.falhas_agendamento`. **Commit** `feat(painel): registro de falhas de agendamento (migration 0067)`.

### Task 4: Fila "Precisa de você"

**Files:** Create `0068_painel_fila.sql`, `0068_painel_fila.test.sql`

**Interfaces:** Produces `painel.fila_atencao() returns table(tipo text, urgencia int, lead_nome text, telefone_fim text, telefone text, crm_lead_id text, desde timestamptz, detalhe text)`, ordenada por `urgencia` e depois por `desde`. `tipo` ∈ `lead_esperando` (1), `transferencia` (2), `agendamento_falhou` (3), `consulta_24h` (4), `parcela_atrasada` (5, sem linhas até a etapa 3), `fim_sequencia` (6), `canal` (7). `detalhe` nunca contém texto de mensagem.

- [ ] **Step 1: Escrever o teste SQL**, um bloco por tipo com caso **em aberto** e caso **resolvido**: *lead_esperando* (lead assumido cuja última mensagem é do lead; some quando o escritório escreve depois); *transferencia* (`S7_HANDOFF_HUMANO`; some quando status ≠ assumido ou o escritório responde); *agendamento_falhou* (some quando `consulta_agendada_em` é preenchida depois da falha ou o escritório escreve ao lead); *consulta_24h* (entre agora e +24 h; fora disso não aparece); *fim_sequencia* (`followup_estado.status = 'revisao_humana'`; some quando vira `ativo` ou `encerrado`); *canal* (`estado <> 'open'`); ordenação por urgência; lead com duas sessões aparece uma vez; nenhuma coluna de texto de conversa.
- [ ] **Step 2: Rodar.** Expected: erro (função não existe).
- [ ] **Step 3: Escrever a migration** (união de sete consultas somente leitura; `crm_lead_id` vem de `leads_autorizados.espocrm_lead_id`), aplicar e rodar. Expected: `OK 0068`.
- [ ] **Step 4: Conferir com os dados reais** que a fila de hoje lista os casos que o Dr. Santo conhece (por exemplo, leads assumidos e a falha de agendamento de 16/10 aparece só se já foi registrada pelo novo nó; a de 16/10 não, porque é anterior). **Commit** `feat(painel): fila de atencao (migration 0068)`.

### Task 5: Arranjo dos quadros (banco e validação)

**Files:** Create `0069_painel_layout.sql`, `0069_painel_layout.test.sql`, `lib/layout.ts`, `lib/widgets.ts`; Test `lib/layout.test.ts`

**Interfaces:**
- SQL: tabela `painel.layout(id int primary key check (id = 1), layout jsonb not null, atualizado_em)`; `painel.layout_ler() returns jsonb` (nulo se nunca salvo); `painel.layout_salvar(p_layout jsonb) returns void` (recusa `versao` ≠ 1, mais de 40 itens, `x/y/w/h` fora de faixa ou JSON maior que 20 KB).
- TS (`lib/widgets.ts`): `type WidgetId` (os ids do catálogo: `kpi-leads-novos`, `kpi-em-conversa`, `kpi-sem-resposta`, `kpi-followups`, `kpi-consultas`, `kpi-canal`, `fila`, `leads-por-etapa`, `followups-dia`, `fontes`, `tempo-resposta`); `CATALOGO: Record<WidgetId, { titulo: string; w: number; h: number }>`.
- TS (`lib/layout.ts`): `type Item = { id: WidgetId; x: number; y: number; w: number; h: number; oculto?: boolean }`; `ARRANJO_PADRAO: { versao: 1; itens: Item[] }` (faixa de números no topo, `fila` grande à esquerda, `leads-por-etapa` ao lado, os demais embaixo); `normalizarArranjo(entrada: unknown): { versao: 1; itens: Item[] }` (inválido → padrão; ids desconhecidos descartados; quadros do catálogo ausentes entram no fim com o tamanho padrão); `arranjoParaCelular(a: { versao: 1; itens: Item[] }): Item[]` (coluna única, `fila` primeiro, depois a faixa, depois o resto).

- [ ] **Step 1: Escrever o teste SQL** (`layout_salvar` grava, `layout_ler` devolve; recusa versão errada, excesso de itens, valor fora de faixa e JSON enorme; segunda gravação substitui; `anon` sem `execute`) e `lib/layout.test.ts` (`JSON inválido devolve o padrão`, `versão desconhecida devolve o padrão`, `id desconhecido é descartado`, `quadro novo do catálogo aparece no fim`, `arranjoParaCelular põe a fila primeiro e deixa uma coluna`).
- [ ] **Step 2: Rodar** os dois. Expected: FAIL.
- [ ] **Step 3: Implementar** a migration (aplicar, `OK 0069`), `lib/widgets.ts` e `lib/layout.ts`.
- [ ] **Step 4: Rodar** `npx vitest run lib/layout.test.ts` e `npx tsc --noEmit`. **Commit** `feat(painel): arranjo dos quadros (migration 0069)`.

### Task 6: Camada de dados do painel

**Files:** Create `lib/painel-dados.ts`; Test `lib/painel-dados.test.ts`

**Interfaces:** Consumes Tasks 1, 2, 4, 5 e `carregar` (Etapa 1). Produces `carregarPainel(periodo: { de: Date; ate: Date }, consulta?: Consulta): Promise<{ numeros: Carregado<FaixaNumeros>; fila: Carregado<ItemFila[]>; etapas: Carregado<EtapaLead[]>; followups: Carregado<FollowupsPeriodo>; fontes: Carregado<FonteLead[]>; tempo: Carregado<TempoResposta> }>` e `lerArranjo(consulta?: Consulta): Promise<{ versao: 1; itens: Item[] }>` (usa `normalizarArranjo`; falha de banco devolve o padrão). Os tipos `FaixaNumeros`, `ItemFila`, `EtapaLead`, `FollowupsPeriodo`, `FonteLead`, `TempoResposta` espelham as colunas das funções SQL.

- [ ] **Step 1: Escrever o teste** com consulta falsa injetada: cada seção chama a função SQL certa com `de` e `ate`; uma seção lançando erro vira `{ estado: 'indisponivel' }` e as outras continuam `ok`; `lerArranjo` com banco fora do ar devolve `ARRANJO_PADRAO`.
- [ ] **Step 2: Rodar.** Expected: FAIL. **Step 3: Implementar** com `Promise.all` de `carregar(...)` por seção. **Step 4: Rodar** `npx vitest run` e `npx tsc --noEmit`. **Commit** `feat(painel): camada de dados dos quadros`.

### Task 7: Tela `/painel`, quadros e modo "Configurar"

**Files:** Create `app/painel/page.tsx`, `app/painel/Grade.tsx`, `app/painel/widgets/*.tsx`, `app/painel/actions.ts`; Modify `app/page.tsx`, `package.json`; Test `app/painel/page.test.ts`

**Interfaces:** Consumes Tasks 1, 5 e 6. Produces a rota `/painel` (exige sessão; lê `?periodo=&de=&ate=`), componente cliente `Grade({ arranjo, quadros, celular }: ...)` com os modos Ver e Configurar, e a ação de servidor `salvarArranjo(arranjo: unknown): Promise<{ ok: boolean }>` (exige sessão, normaliza com `normalizarArranjo` e chama `painel.layout_salvar`). Cada quadro é um componente que recebe um `Carregado<...>` e mostra `texto(...)` ou o selo "indisponível".

- [ ] **Step 1: Escrever `app/painel/page.test.ts`** (renderização com `renderToStaticMarkup`, mesmo padrão da Etapa 1): `um quadro que falha mostra "indisponível" e os demais mostram dados`; `nenhum zero aparece quando todas as consultas falham`; `a fila mostra o tipo, o nome, a espera e os botões Abrir no WhatsApp e Abrir no CRM`; `a barra de períodos marca o período ativo`; `não há texto de conversa na página`.
- [ ] **Step 2: Rodar.** Expected: FAIL. **Step 3: Instalar** `react-grid-layout` e seus tipos na versão estável compatível com React 18 (conferir `npm ls` sem conflito de peers; o `Dockerfile` usa `npm ci` sem opções).
- [ ] **Step 4: Implementar** a página (servidor), os quadros (um arquivo por quadro), `Grade.tsx` (carregada com `dynamic(..., { ssr: false })`; grade de 12 colunas; abaixo de 700 px usa `arranjoParaCelular` e desliga o arrastar; o botão "Configurar" libera arrastar e redimensionar, mostra "Adicionar quadro" com os escondidos e um "Esconder" em cada quadro; "Salvar" chama `salvarArranjo`, "Cancelar" volta ao último arranjo) e `app/page.tsx` redirecionando para `/painel`. A rota antiga `/painel-executivo` continua acessível.
- [ ] **Step 5: Rodar** `npx vitest run`, `npx tsc --noEmit` e `npx next build`. Expected: passam. **Commit** `feat(painel): tela inicial configuravel`.

### Task 8: Publicar e aceitar com dados reais

**Files:** nenhum arquivo novo; atualizar `docs/handoffs/claude-status.md` e o registro deste plano.

- [ ] **Step 1: Pré-condição:** a correção da Etapa 1 já está publicada (Task 4 daquele plano) e `/api/saude` responde 200.
- [ ] **Step 2: Gerar a cópia limpa** em `publicar/` como na Etapa 1 e provar `npm ci`, testes e build; o Dr. Santo publica e faz o deploy.
- [ ] **Step 3: Aceite com o Dr. Santo logado** (critérios 1 a 4 do design): `/painel` mostra os números reais de hoje; a fila mostra os casos conhecidos; arrastar, esconder, adicionar e salvar persistem após recarregar e em outro aparelho; no celular os quadros empilham com a fila primeiro; derrubar uma consulta de teste só deixa aquele quadro "indisponível".
- [ ] **Step 4: Registrar** o resultado (sem dados de clientes) e fazer o commit final da etapa.

---

## Self-review

- **Cobertura da Etapa 2 do design:** grade configurável e arranjo no banco (Tasks 5 e 7), barra de períodos (1), faixa de números (2), fila com os sete tipos (3 e 4; "parcela atrasada" só ganha linhas na etapa 3), leads por etapa, follow-ups do dia, fontes e tempo de resposta (2), falha por quadro (6 e 7), celular (5 e 7), aceite (8).
- **Consistência de nomes:** `Carregado`/`carregar`/`texto` (Etapa 1), `Preset`, `resolverPeriodo`, `painel.faixa_numeros`, `painel.fila_atencao`, `painel.layout_ler`/`layout_salvar`, `normalizarArranjo`, `arranjoParaCelular`, `carregarPainel`, `lerArranjo` e `salvarArranjo` aparecem iguais em todas as tasks que os usam.
- **Risco declarado:** a Task 3 altera um workflow vivo (padrão do projeto: patch testado, PUT, GET, exportar); a Task 8 depende da publicação feita pelo Dr. Santo; as funções novas só têm `execute` para o dono e `painel_leitura` (o mesmo cuidado com o usuário do `SUPABASE_DB_URL` da Etapa 1).
- **Decisões minhas a conferir:** a ordem de precedência dos estágios; "Sem resposta" medido pelo primeiro contato no período; o canal como último item da fila (a ordem do design), mesmo sendo urgente (ele também aparece em vermelho na faixa); o arrastar desligado no celular.

## Registro de execução

- **Task 1 concluída em 19/10** (58/58 testes do painel, `tsc` limpo). `lib/periodos.ts` com `resolverPeriodo` e `lerPeriodoDaUrl`, só com `Intl` (sem dependência nova), relógio por parâmetro. 12 testes cobrem a meia-noite de São Paulo (23:59 ainda é "hoje" e 01 min depois já é o dia seguinte, mesmo com UTC já no dia seguinte), virada de mês e de ano, semana começando na segunda inclusive aos domingos, período livre com "ate" inclusivo, datas invertidas e inválidas (inclusive `2026-02-30`).
  - Ruling: "Semana" e "Mês" vão de `de` até o fim de hoje (não até o fim da semana ou do mês), como o Kommo mostra "esta semana".
  - Ruling: período livre sem datas válidas cai em `semana`, e o `preset` devolvido diz `semana` (não `livre`), para a barra não marcar o botão errado.
- **Task 2 concluída em 19/10** (`OK 0066`; números reais conferidos). Migration `0066` (`_mensagens`, `_entradas`, `faixa_numeros`, `leads_por_etapa`, `followups_periodo`, `fontes_de_lead`, `tempo_resposta`), aplicada em duas etapas (`painel_numeros` e `painel_numeros_fonte_canal`); o arquivo do repositório tem o estado final.
  - **Ruling (muda o plano):** a atividade dos leads vem do canal, não do histórico do n8n. O histórico grava a mensagem do lead junto com a resposta da Mayara (mesmo instante), então o tempo de resposta dava 0 s. Agora: chegada = `canal_eventos` (`resultado = 'aceito'`, só números da lista, inclui o que ficou retido); saídas da Mayara = `envios_log` (resposta = origem `ponte`); mensagens da equipe = histórico (`papel = 'equipe'`). Valores reais: tempo médio da semana 70 s; maior espera de lead aguardando a equipe cerca de 10,7 h.
  - **Ruling:** `fontes_de_lead` usa `campanha` do `fatos_json` da sessão, depois `crm_sync.leads.campaign`, depois "sem origem" (a coluna do CRM está nula nos 78 leads; hoje 17 leads têm campanha pelo `fatos_json`).
  - A soma de `leads_por_etapa` é igual ao total de `leads_autorizados` (19 = 19) e há sempre seis linhas.
  - **Impacto na Task 4 (fila):** "lead esperando" e "transferência" devem usar `painel._entradas()` e as saídas de `envios_log` + mensagens da equipe, não o histórico.
- **Task 3 concluída em 19/10** (`OK 0067`; 8/8 testes do patch). Migration `0067` (`painel.falhas_agendamento` e `registrar_falha_agendamento`, idempotente em 10 min e por chave do telefone, motivo limitado a 200 caracteres) e patch do workflow vivo `Avisar Falha de Agendamento` (`2Z3f0Ka1aOsuRwr8`): novo nó Postgres `Registrar Falha no Painel`, no ramo `Falha Tecnica?` em paralelo ao aviso e à Task, com `onError: continueRegularOutput` (nunca atrapalha o aviso). Gerador testado em `docs/superpowers/specs/2026-10-19-painel-falha-agendamento/`; workflow relido, ativo e exportado para `docs/superpowers/specs/workflows/mayara-avisar-falha-agendamento.json`.
  - **Ruling:** em vez de executar o sub-workflow real (mandaria um aviso falso ao administrador e criaria uma Task no CRM), provei só o nó novo num workflow temporário (apagado) com dados fictícios: `success`, devolveu o id e gravou a linha com a chave certa. A linha de teste (`motivo = 'teste_painel'`) foi marcada como resolvida e nunca aparece na fila.
  - **Limite conhecido:** o ramo só dispara para `motivoFalha = 'erro_desconhecido'` (comportamento já existente do workflow); outros motivos de falha não geram registro nem Task.
- **Task 4 concluída em 19/10** (`OK 0068`). `painel.fila_atencao()` com os seis tipos ativos (a parcela atrasada entra na etapa 3), um caso em aberto e um resolvido por tipo, dedupe do lead assumido e transferido (aparece uma vez, como `lead_esperando`), lead com duas sessões aparece uma vez, ordenação por urgência e depois por `desde`, e nenhuma coluna de texto de conversa. Fila real de hoje: 2 itens (`lead_esperando`), coerentes com o que o Dr. Santo conhece.
  - **Ruling:** a "transferência" e a "falha de agendamento" só são resolvidas por mensagem **humana** da equipe (ou, na falha, por consulta marcada depois); a fala automática de aviso da Mayara não resolve. Já "lead esperando" considera qualquer saída posterior (Mayara, sistema ou equipe).
- **Task 6 concluída em 20/10** (77/77 testes, `tsc` limpo). `lib/painel-dados.ts`: `carregarPainel(periodo, consulta?)` com `Promise.all` de `carregar(...)` por seção e `lerArranjo(consulta?)` (banco fora do ar ou nunca salvo devolve `ARRANJO_PADRAO`). Nomes de colunas conferidos contra as funções reais.
  - Ruling: resposta vazia de `faixa_numeros`, `followups_periodo` ou `tempo_resposta` vira "indisponível" (nunca zero); `bigint` do `pg` (texto) é convertido para número.
- **Task 7 concluída em 20/10** (91/91 testes, `tsc` limpo, `next build` ok: rota `/painel` 23,7 kB). `app/painel/page.tsx` (servidor: sessão, período da URL, `carregarPainel` + `lerArranjo` em paralelo), `Grade.tsx` (cliente, `react-grid-layout@1.5.4`, 12 colunas; Configurar/Adicionar quadro/Esconder/Salvar/Cancelar), seis quadros em `widgets/`, `actions.ts` (`salvarArranjo` exige sessão e chama `gravarArranjo` → `painel.layout_salvar`), `app/page.tsx` redireciona para `/painel`; `/painel-executivo` continua acessível.
  - Ruling: em vez de `dynamic(..., { ssr: false })`, a grade renderiza primeiro empilhada (igual ao celular, igual ao servidor, sem erro de hidratação) e troca para a grade arrastável depois de medir a largura (≥ 700 px). Mesmo efeito do plano, sem tela vazia no primeiro desenho.
  - Ruling: o botão "Abrir no CRM" usa `CRM_URL` (padrão `https://crm.camparimadvogados.com.br`) + `/#Lead/view/<id>`; sem `crm_lead_id` o botão não aparece. "Configurar" só existe em tela larga.
  - Risco: o arrastar/redimensionar só foi verificado por teste da renderização do servidor e build; a conferência visual com dados reais fica para o aceite (Task 8), porque não há credencial do banco neste computador.
