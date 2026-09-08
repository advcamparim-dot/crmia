# Painel Executivo — Reconstrução — Design

**Data:** 2026-09-07
**Sub-projeto:** 2 de 3 da visão maior (fundação de dados / **dashboards** / portal do cliente). Depende do sub-projeto 1 (Fundação de dados em Supabase, concluído — ver `2026-09-06-mayara-supabase-fundacao-dados-design.md`), mas usa um schema Supabase separado.

## Contexto

Os 6 painéis atuais (Executivo, Operacional, Financeiro, Marketing, IA, e um sexto não nomeado) são páginas HTML servidas por workflows n8n, com Basic Auth, que fazem consultas sequenciais ao vivo no EspoCRM a cada carregamento de página, CSS duplicado entre painéis, e nenhum gráfico de verdade (barras desenhadas à mão em HTML/CSS). Isso foi mapeado e aprovado para reconstrução como aplicação própria (não uma ferramenta de BI genérica) em Next.js, mantendo a identidade visual do escritório.

Este spec cobre **apenas o painel Executivo** — o primeiro dos 5 a ser construído (Operacional, Financeiro, Marketing e IA ficam como abas de navegação já visíveis, mas desabilitadas/"em breve" até terem seu próprio ciclo de brainstorm → spec → plano).

## Decisões já validadas com o usuário

| Decisão | Escolha |
|---|---|
| Tecnologia do app | Next.js custom, mesma VPS/Coolify — não ferramenta de BI pronta |
| Fonte dos dados no app | Supabase (Postgres), nunca consulta ao vivo no EspoCRM por carregamento de página |
| Frescor dos dados | Alguns minutos de atraso é aceitável (sync periódico, não tempo real) |
| Usuários | Só Dr. Santo por enquanto — login simples, sem multiusuário/papéis |
| Identidade visual | Direção "Câmara" — verde-floresta (`#0d1310`/`#141d18`) + latão (`#b08a5a`/`#c9ab7d`), Lora (display) + Karla (corpo) + IBM Plex Mono (números) |
| Logo | Extraída do site (`camparimadvogados.com.br/wp-content/uploads/2024/02/logo1.png`) — brasão dourado + "CAMPARIM ADVOGADOS", embutida como asset do app |
| Navegação entre painéis | Abas estilo "divisória de fichário" no topo (não barra lateral) |
| Escopo desta spec | Só o painel Executivo; os outros 4 ficam como abas inativas |
| Dados históricos de Contratos/Pagamentos | Controle hoje é informal (memória/WhatsApp/papel) — **não há migração**; o CRM passa a ser o registro oficial a partir do momento em que a digitação começar |
| Digitação manual de Contratos/Pagamentos/Propostas | Reduzida por automação: o n8n cria rascunhos nos momentos previsíveis (proposta aceita → contrato; contrato assinado → parcelas), a pessoa só confirma/completa — ver seção "Criação assistida de registros" |

## Arquitetura

```
EspoCRM (fonte da verdade)
     │  List API, filtro modifiedAt > cursor, a cada 5 min
     ▼
n8n — "Painel Executivo — Sync CRM→Supabase" (Schedule Trigger)
     │  upsert por entidade + avança cursor em crm_sync.sync_state
     ▼
Supabase / Postgres — schema crm_sync (mesmo projeto do sub-projeto 1, schema isolado)
     │  Next.js Server Components consultam via SQL (agregações em views), service role só no servidor
     ▼
Next.js (Coolify, mesma VPS) — rota /painel-executivo, login simples de sessão única
     │
     ▼
Navegador do Dr. Santo
```

**Por que sync periódico em vez de tempo real (webhook do EspoCRM):** EspoCRM tem webhooks de entidade, mas exigiriam um endpoint público exposto e tratamento de assinatura/replay para cada uma das 6 entidades. Como "alguns minutos de atraso é ok" já foi confirmado, um `Schedule Trigger` a cada 5 minutos entrega o mesmo resultado prático com uma fração da complexidade (mesmo padrão que o worker de retry do sub-projeto 1, já validado em produção).

**Por que Postgres agrega em vez de tabelas de agregação pré-calculadas:** volume de um único escritório (dezenas de leads/mês, não milhões de linhas) — `SUM`/`COUNT`/`GROUP BY` direto em views é instantâneo e evita uma segunda camada de estado para manter consistente. Revisar essa decisão só se o volume crescer 100x+.

## Modelo de dados (EspoCRM, confirmado via `Metadata` da API)

Consulta ao `GET /api/v1/Metadata` do EspoCRM (via workflow diagnóstico descartável, apagado ao final) confirmou que os módulos abaixo **já existem e já têm dados sendo usados pela Mayara e pelo CRM manual** — nenhum precisou ser criado:

| Entidade EspoCRM | Campos relevantes ao painel | Enum `status` (valores reais) |
|---|---|---|
| `Lead` | `status`, `source`, `cLegalArea`, `cUrgencyLevel`, `cLeadScore`, `cChannel`, `cWonAt`, `cLostReason`, `opportunityAmount`, `createdAt`, link `cPropostas`/`cContratos` | `New, In Process, Converted, Dead, Consulta Agendada, Consulta Realizada` |
| `Meeting` | `status`, `dateStart`, `dateEnd`, `cNoShow`, `acceptanceStatus`, `leads` (link) | `Planned, Held, Not Held` |
| `CProposta` (custom) | `amount`, `status`, `sentAt`, `acceptedAt`, `rejectedAt`, `rejectionReason`, `lead` (link), `successFeePercentage` | `Rascunho, Enviada, Aceita, Recusada, Vencida` |
| `CContrato` (custom) | `amount`, `status`, `signedAt`, `closedAt`, `paymentStatus`, `lead`/`client`/`proposal` (links), `channel`, `source` | `status`: `Enviado, Assinado, Cancelado, Pendente` · `paymentStatus`: `Pendente, Parcial, Pago, Atrasado` |
| `CPagamento` (custom) | `amount`, `dueDate`, `paidAt`, `status`, `paymentMethod`, `installmentNumber`/`totalInstallments`, `contract`/`client` (links) | `Pendente, Pago, Atrasado, Cancelado` |
| `CCasoJuridico` (custom) | `status`, `riskLevel`, `currentPhase`, `legalArea`, `court`, `caseNumber`, `claimValue`, `nextDeadlineAt`, `lastMovementAt`, `client`/`responsibleLawyer` (links) | `status`: `Ativo, Suspenso, Encerrado - Êxito, Encerrado - Sem Êxito` · `riskLevel`: `Baixo, Médio, Alto` |

Todos os campos monetários são do tipo `currency` do EspoCRM (moeda única BRL neste CRM) — mirror usa a coluna `*_amount` já convertida, sem tratar multi-moeda.

**Confirmado também via `GET /api/v1/Settings` (`tabList`):** os 4 módulos custom já aparecem na barra lateral do EspoCRM hoje (`CCasoJuridico`, `CProposta`, `CContrato`, `CPagamento` estão na lista de abas ativas, junto de `Lead`/`Meeting`) — não é preciso nenhuma configuração de Entity Manager para começar a usar; a digitação manual já é possível na tela normal do CRM.

**Dois campos novos a criar em `CContrato`** (via Admin → Entity Manager, antes da Task de automação): `numeroParcelas` (inteiro, default 1) e `diaVencimentoPrimeiraParcela` (data, opcional — se vazio, assume `signedAt + 30 dias`). Sem eles, a criação assistida de parcelas (abaixo) não sabe em quantas vezes dividir o pagamento.

## Modelo de dados (Supabase, novo schema `crm_sync`)

Projeto: `crmia-mayara` (`wuhvlvsolewslkawazlq`, sa-east-1) — o mesmo do sub-projeto 1, schema **separado** de `mayara` (estado de conversa da IA) porque o ciclo de vida e o dono dos dados são diferentes.

```sql
create schema if not exists crm_sync;

create table crm_sync.leads (
  id text primary key,               -- id do EspoCRM
  name text not null,
  status text not null,
  source text,
  legal_area text,
  channel text,
  urgency_level text,
  lead_score numeric,
  lost_reason text,
  opportunity_amount numeric,
  created_at timestamptz not null,
  won_at timestamptz,
  modified_at timestamptz not null
);

create table crm_sync.meetings (
  id text primary key,
  name text not null,
  status text not null,
  date_start timestamptz,
  date_end timestamptz,
  no_show boolean default false,
  acceptance_status text,
  lead_id text references crm_sync.leads(id),
  created_at timestamptz not null,
  modified_at timestamptz not null
);

create table crm_sync.propostas (
  id text primary key,
  name text not null,
  amount numeric,
  status text not null,
  sent_at timestamptz,
  accepted_at timestamptz,
  rejected_at timestamptz,
  rejection_reason text,
  success_fee_percentage numeric,
  lead_id text references crm_sync.leads(id),
  created_at timestamptz not null,
  modified_at timestamptz not null
);

create table crm_sync.contratos (
  id text primary key,
  name text not null,
  amount numeric,
  status text not null,
  payment_status text,
  signed_at timestamptz,
  closed_at timestamptz,
  channel text,
  source text,
  lead_id text references crm_sync.leads(id),
  proposal_id text references crm_sync.propostas(id),
  created_at timestamptz not null,
  modified_at timestamptz not null
);

create table crm_sync.pagamentos (
  id text primary key,
  name text not null,
  amount numeric,
  status text not null,
  due_date date,
  paid_at timestamptz,
  payment_method text,
  installment_number integer,
  total_installments integer,
  contract_id text references crm_sync.contratos(id),
  created_at timestamptz not null,
  modified_at timestamptz not null
);

create table crm_sync.casos_juridicos (
  id text primary key,
  name text not null,
  status text not null,
  risk_level text not null,
  current_phase text,
  legal_area text,
  court text,
  case_number text,
  claim_value numeric,
  next_deadline_at timestamptz,
  last_movement_at timestamptz,
  client_id text,
  responsible_lawyer_id text,
  created_at timestamptz not null,
  modified_at timestamptz not null
);

-- cursor de sincronização incremental, um registro por entidade
create table crm_sync.sync_state (
  entity_name text primary key,      -- 'Lead','Meeting','CProposta','CContrato','CPagamento','CCasoJuridico'
  last_synced_at timestamptz not null default '1970-01-01'::timestamptz
);

insert into crm_sync.sync_state (entity_name) values
  ('Lead'), ('Meeting'), ('CProposta'), ('CContrato'), ('CPagamento'), ('CCasoJuridico');

alter table crm_sync.leads enable row level security;
alter table crm_sync.meetings enable row level security;
alter table crm_sync.propostas enable row level security;
alter table crm_sync.contratos enable row level security;
alter table crm_sync.pagamentos enable row level security;
alter table crm_sync.casos_juridicos enable row level security;
alter table crm_sync.sync_state enable row level security;
-- sem policies: nega tudo por padrão (deny-all intencional). Só o service_role
-- (usado pelo n8n no sync e pelo Next.js no servidor) tem acesso — nunca exposto ao navegador.
```

## Workflow de sincronização (n8n)

Novo workflow **`Painel Executivo — Sync CRM→Supabase`**, `Schedule Trigger` a cada 5 minutos, um ramo por entidade (6 ramos independentes, falha em um não bloqueia os outros):

Para cada entidade `E`:
1. `Ler Cursor` (Postgres, `select last_synced_at from crm_sync.sync_state where entity_name = $1`)
2. `Buscar no EspoCRM` (HTTP Request GET `/api/v1/{Entity}?where[0][type]=greaterThan&where[0][attribute]=modifiedAt&where[0][value]={cursor}&orderBy=modifiedAt&order=asc&maxSize=200`, credencial `EspoCRM Integração n8n — Mayara` já existente)
3. `Upsert em lote` (Postgres, `operation: upsert`, `columnToMatchOn: id`, uma linha por item retornado, mapeando os campos da tabela acima)
4. `Avançar Cursor` (Postgres, `update crm_sync.sync_state set last_synced_at = $1 where entity_name = $2`, usando o maior `modifiedAt` do lote — só avança se o lote não veio vazio)

**Tratamento de erro:** cada ramo com `onError: continueRegularOutput` isolado — uma falha na sincronização do `CPagamento`, por exemplo, não impede a de `Lead`. Erros de HTTP (4xx/5xx do EspoCRM) e de upsert (Postgres) caem em um nó `Registrar Falha de Sync` (Postgres insert em `crm_sync.sync_failures`, mesma ideia da fila de dead-letter do sub-projeto 1) em vez de travar o workflow inteiro silenciosamente.

```sql
create table crm_sync.sync_failures (
  id bigint generated always as identity primary key,
  entity_name text not null,
  error_message text not null,
  occurred_at timestamptz not null default now()
);
alter table crm_sync.sync_failures enable row level security;
```

**Indicador de dados desatualizados no app:** o Next.js lê `max(modified_at)` das 6 tabelas e, se o mais antigo passar de 15 minutos (3x o intervalo de sync), mostra um aviso discreto no topo do painel ("dados podem estar desatualizados") em vez de fingir que está tudo em dia.

## Criação assistida de registros (reduz digitação manual)

O escritório confirmou que hoje o controle de contratos/pagamentos é informal (memória, WhatsApp, papel) — o CRM vai ser o primeiro lugar organizado pra isso, e digitar cada contrato e cada parcela do zero seria trabalho novo real. Em vez disso, um segundo workflow n8n cria **rascunhos automáticos** nos pontos em que os dados já são previsíveis a partir do que já existe no CRM; a pessoa só confirma ou completa, nunca deixa de revisar antes de algo virar "oficial".

Novo workflow **`Painel Executivo — Criação Assistida de Registros`**, `Schedule Trigger` a cada 5 minutos (mesmo ciclo do sync), duas regras independentes:

**Regra 1 — Proposta aceita → rascunho de Contrato**
- Gatilho: `CProposta.status = 'Aceita'` E ainda não existe nenhum `CContrato` com `proposal = <id da proposta>`.
- Ação: `POST /api/v1/CContrato` com `status: 'Pendente'`, `amount` = valor da proposta, `lead`/`client` copiados da proposta, `proposal` = id da proposta, `source: 'Automação — proposta aceita'`.
- O que fica manual: mudar `status` para `'Assinado'` e preencher `signedAt` quando o contrato for de fato assinado — isso é um evento jurídico/humano, não pode ser automático.

**Regra 2 — Contrato assinado → rascunhos de Pagamento (parcelas)**
- Gatilho: `CContrato.status` muda para `'Assinado'` E ainda não existe nenhum `CPagamento` com `contract = <id do contrato>`.
- Ação: lê `numeroParcelas` (N) e `diaVencimentoPrimeiraParcela` do contrato (default: 1 parcela, vencimento `signedAt + 30 dias`); cria N registros `CPagamento` com `status: 'Pendente'`, `contract` = id do contrato, `client` copiado, `installmentNumber: i`, `totalInstallments: N`, `dueDate` espaçado em +1 mês por parcela a partir da primeira, `amount` = valor total ÷ N (a última parcela absorve o resto do arredondamento de centavos, pra soma bater exatamente com o valor do contrato).
- O que fica manual: mudar `status` de cada parcela para `'Pago'` (e preencher `paidAt`) quando o pagamento realmente entrar.

**Controle de duplicidade:** ambas as regras rodam sobre uma janela de "ainda não tem registro filho vinculado" — não precisa de tabela de controle extra, a própria ausência do vínculo (`proposal`/`contract`) é a condição de idempotência. Rodar o ciclo de novo sobre uma proposta que já gerou contrato não cria um segundo.

**Por que isso não vira 100% automático:** assinatura de contrato e confirmação de recebimento de pagamento são, por natureza, eventos que só uma pessoa pode atestar — a automação cobre a parte mecânica (copiar valores, calcular parcelas), não substitui a confirmação humana do que realmente aconteceu.

## Métricas do painel Executivo (mapeamento exato)

Todas com filtro de período (`Hoje / 7 dias / 30 dias / Mês atual / Personalizado`) aplicado sobre a coluna indicada entre parênteses.

**Resumo**
- Receita contratada: `sum(contratos.amount) where status = 'Assinado'` (`signed_at`)
- Receita recebida: `sum(pagamentos.amount) where status = 'Pago'` (`paid_at`)
- Leads novos: `count(leads)` (`created_at`)
- Contratos assinados: `count(contratos) where status = 'Assinado'` (`signed_at`)
- Taxa de conversão: contratos assinados ÷ leads novos, mesmo período

**Comercial**
- Leads qualificados: `count(leads) where status not in ('New','Dead')` (`created_at`)
- Consultas marcadas: `count(meetings)` (`date_start`)
- Consultas realizadas: `count(meetings) where status = 'Held'` (`date_start`)
- Propostas enviadas: `count(propostas) where status in ('Enviada','Aceita','Recusada','Vencida')` (`sent_at`)
- Ticket médio: receita contratada ÷ contratos assinados, mesmo período

**Funil comercial** (mesmo período, cada estágio é contagem, não acumulado do anterior)
- Leads → `count(leads)`
- Qualificados → `count(leads) where status not in ('New','Dead')`
- Consultas → `count(meetings) where status = 'Held'`
- Propostas → `count(propostas) where status in ('Enviada','Aceita')`
- Contratos → `count(contratos) where status = 'Assinado'`

**Financeiro** (sem filtro de período — são posições em aberto, não fluxo do período)
- Valor a receber: `sum(pagamentos.amount) where status in ('Pendente','Atrasado')`
- Pagamentos atrasados: `sum(pagamentos.amount) where status = 'Atrasado'`
- Taxa de inadimplência: atrasados ÷ (pendente + atrasado + pago), últimos 90 dias de `due_date`
- Total vencido: `sum(pagamentos.amount) where status = 'Atrasado' and due_date < current_date`

**Jurídico e operacional** (sem filtro de período — são posições atuais)
- Clientes ativos: `count(distinct client_id)` de `casos_juridicos` com `status = 'Ativo'`
- Casos ativos: `count(casos_juridicos) where status = 'Ativo'`
- Prazos críticos: `count(casos_juridicos) where status = 'Ativo' and next_deadline_at < now() + interval '7 days'`
- Casos de alto risco: `count(casos_juridicos) where status = 'Ativo' and risk_level = 'Alto'`

**Alertas executivos** (tabela) — união de duas fontes, ordenada por data ascendente:
- Prazo: casos ativos com `next_deadline_at` vencido ou em até 7 dias → severidade "Crítica" se vencido, "Alta" se em até 7 dias
- Pagamento: pagamentos com `status = 'Atrasado'` → severidade "Alta"

## Aplicação Next.js

- **Rota única nesta fase:** `/painel-executivo`. As outras 4 abas (`Operacional`, `Financeiro`, `Marketing`, `IA`) renderizam mas ficam com `aria-disabled` e um tooltip "em breve" — não são links mortos silenciosos.
- **Busca de dados:** Server Component faz a query SQL diretamente no Supabase usando a `service_role key` (variável de ambiente só no servidor, nunca `NEXT_PUBLIC_*`) — sem API intermediária própria nesta fase, já que há um único consumidor.
- **Autenticação:** login simples de usuário único — uma senha em variável de ambiente (`PAINEL_SENHA`), middleware do Next.js que checa um cookie de sessão assinado (`iron-session` ou equivalente já usado por outro projeto, a confirmar na task de implementação) após o Dr. Santo digitar a senha uma vez. Sem Supabase Auth nesta fase — YAGNI para um único usuário; migrar para Auth completo é direto se/quando houver mais de um usuário.
- **Deploy:** mesma VPS/Coolify, novo serviço Next.js (build Docker), variáveis de ambiente via Coolify (chave de serviço do Supabase, senha do painel).

## Sistema visual (herdado do mockup aprovado)

- Paleta: `--bg:#0d1310`, `--surface:#141d18`, `--surface-2:#1a2420`, `--border:#2a352d`, `--brass:#b08a5a`, `--brass-bright:#c9ab7d`, `--ink:#e9ede7`, `--muted:#8a9a8c`; status `--good:#4f9d6e`, `--warning:#b87d1a`, `--critical:#c23b3b` (validado com `validate_palette.js` contra a superfície `#141d18` — todos os critérios passaram).
- Tipografia: Lora (display/H1), Karla (corpo/rótulos), IBM Plex Mono (números tabulares).
- Logo: PNG extraído do site, embutido como asset estático do app (não depende do site ficar no ar).
- Navegação: abas estilo divisória de fichário no topo — aba ativa clara e "levantada", com uma tira de latão no topo; abas inativas recuadas e mais escuras.
- Referência viva: mockup publicado (Artifact) usado como spec visual — o app deve reproduzir fielmente cores, tipos, espaçamento e o comportamento das abas.

## Testes

- **Sincronização:** após o primeiro sync, conferir manualmente 3-5 registros de cada entidade (Lead, Meeting, CProposta, CContrato, CPagamento, CCasoJuridico) comparando EspoCRM ↔ Supabase campo a campo.
- **Métricas:** para cada tile do painel, rodar a query SQL equivalente direto no Supabase e comparar com o número mostrado na tela.
- **Cursor incremental:** criar/editar um registro de teste no EspoCRM, esperar um ciclo de sync (5 min), confirmar que aparece no painel sem re-sincronizar tudo do zero.
- **Indicador de dados desatualizados:** pausar o workflow de sync, confirmar que o aviso aparece após 15 minutos.
- **Visual:** comparar lado a lado com o mockup aprovado (cores, tipografia, comportamento das abas, responsividade em tela estreita).
- **Login:** sessão expira/exige senha novamente após logout ou expiração do cookie.
- **Criação assistida — proposta → contrato:** marcar uma Proposta de teste como `Aceita`, esperar um ciclo (5 min), confirmar que o Contrato rascunho aparece com os valores certos e não se duplica no ciclo seguinte.
- **Criação assistida — contrato → parcelas:** marcar um Contrato de teste como `Assinado` com `numeroParcelas = 3`, confirmar que nascem exatamente 3 `CPagamento` com datas espaçadas por mês e soma dos valores igual ao total do contrato (incluindo o ajuste de centavos na última parcela); repetir com `numeroParcelas` vazio para confirmar o default de 1 parcela.

## Riscos e limitações

- **Enums em português com acentuação** (`Êxito`, `Médio`) — exigem cuidado de encoding UTF-8 consistente entre EspoCRM → n8n → Postgres → Next.js; testar explicitamente com um registro de cada valor.
- **`Alertas executivos` mistura duas fontes heterogêneas** (prazo de caso vs. atraso de pagamento) — a spec fixa as regras de severidade acima; qualquer terceira fonte futura (ex: renovação de contrato) exige revisão desta seção, não extrapolação.
- **Isolamento do sub-projeto 1:** o workflow de sync e o schema `crm_sync` são inteiramente novos e independentes dos workflows/schema `mayara` já em produção — nenhuma mudança neste sub-projeto toca a Mayara ou o fluxo Ponte→Mayara.
- **Criação assistida não substitui julgamento humano:** os rascunhos automáticos usam valores da proposta/contrato original; se o valor final assinado for diferente do proposto, a pessoa precisa corrigir o rascunho antes de confirmar — a automação economiza digitação, não decide valores.
- **Sem os dois campos novos em `CContrato`** (`numeroParcelas`, `diaVencimentoPrimeiraParcela`), a Regra 2 sempre cai no default de 1 parcela — funcional, mas não resolve o caso comum de contrato parcelado até que os campos existam.

## Fora de escopo (nesta spec)

- Os painéis Operacional, Financeiro, Marketing e IA (cada um terá seu próprio ciclo de brainstorm → spec → plano).
- Múltiplos usuários / papéis de acesso.
- Filtro "Personalizado" de período com date-picker completo (a task de implementação pode simplificar para os 4 presets fixos e adiar o custom).
- Exportação de dados, notificações por e-mail/WhatsApp de alertas.
- Portal do cliente (sub-projeto 3, pausado por decisão do usuário).
- Migração de dados históricos de contratos/pagamentos (controle anterior era informal — não há de onde importar).
- Edição de rascunhos criados pela automação diretamente no painel Executivo — isso continua sendo feito no EspoCRM (o painel é só leitura, conforme já indicado no rodapé do mockup).

## Conclusão (2026-09-08)

Implementação completa (Tasks 1-8 do plano), testada de ponta a ponta com dados reais de teste. Falta apenas o deploy final no Coolify (Task 9, Passo 5 — pendente de acesso do usuário à interface web) e um teste de ponta a ponta com um caso de negócio real (Passo 3 — pendente de a oportunidade surgir naturalmente).

**IDs de referência:**
- Workflow de sincronização: `Painel Executivo — Sync CRM→Supabase` (n8n id `PH73hjj7zIABuZ74`), ativo, ciclo de 5 min.
- Workflow de criação assistida: `Painel Executivo — Criação Assistida de Registros` (n8n id `1wDrXlOUL7sw2tYT`), ativo, ciclo de 5 min.
- App Next.js: `painel-executivo/` na raiz do repo, mesclado em `main` (commit `404c1058`).
- Projeto Supabase: `crmia-mayara` (`wuhvlvsolewslkawazlq`), schema `crm_sync`.

**Divergências da spec original, encontradas durante a implementação:**
1. **`Meeting.leads` é `linkMultiple`, não link simples** — a coluna `crm_sync.meetings.lead_id` fica sempre nula (capturar o vínculo exigiria uma chamada extra por reunião). Nenhuma métrica usa essa coluna, então não há impacto prático.
2. **Filtro de "contrato já existe" precisou usar `proposalId`, não `proposal`** — filtros do EspoCRM por atributo de link exigem o nome com sufixo `Id`, não o nome do link em si. Mesma regra provavelmente vale para qualquer filtro futuro sobre um campo `link`.
3. **`CContrato.source` é um enum fixo** (`Call, Email, Existing Customer, Partner, Public Relations, Web Site, Campaign, Other`), não texto livre — a automação usa `"Other"` e registra o motivo real em `description`.
4. **Toda criação via API precisa de `assignedUserId` explícito** (auto-atribuição ao usuário `n8n-integration`, id `6a899d5f8a2b61a29`) — sem isso, EspoCRM recusa com 403 "Assignment failure", mesmo com permissão de Create concedida. Confirmado agora também para `CProposta` e `CPagamento`, além de `CContrato`/`Lead`/`Meeting` (já resolvido no sub-projeto 1).
5. **O usuário `n8n-integration` tem Create mas não Edit em `CProposta`/`CContrato`/`CPagamento`** — intencional/aceitável, já que mudanças de status são feitas por uma pessoa pela tela do CRM, não pela automação. Isso significa que testes futuros de "o que acontece quando X muda de status" exigem alguém mudar o status manualmente — não dá pra simular via API.
6. **Achado operacional (não é bug de código):** contratos marcados `Assinado` sem preencher `signedAt` não contam em "Receita contratada" (que filtra por essa data), só em "Valor a receber". A equipe precisa ter o hábito de preencher a data de assinatura.

**Registros de teste:** todos apagados manualmente pelo usuário direto na tela do EspoCRM (a API realmente não tem permissão de Delete nesses 3 módulos — nem Edit, confirmado — mas o Admin consegue apagar pela interface normalmente). Espelho no Supabase também limpo manualmente via SQL, ver achado abaixo.

**Achado importante de arquitetura, descoberto durante a limpeza: o sync não propaga exclusões.** O workflow de sincronização (Task 3) só busca registros criados/atualizados desde o último ciclo (`modifiedAt > cursor`) — a API de listagem do EspoCRM exclui por padrão registros apagados, então uma exclusão nunca aparece como "atualização" pro sync detectar. Resultado: apagar um registro no EspoCRM **não remove a linha correspondente em `crm_sync.*`** — ela fica órfã pra sempre, a menos que alguém limpe manualmente via SQL (como fiz aqui). Como o processo de negócio real não prevê apagar contratos/pagamentos/propostas no dia a dia (só aconteceu aqui por serem dados de teste), isso não é urgente, mas é uma lacuna real que deveria virar uma task própria se algum dia for preciso confiar 100% na completude do espelho (ex: uma rotina periódica que compara IDs do EspoCRM com os do Supabase e apaga o que não existe mais do lado de origem).

**Achado colateral também descoberto na limpeza:** com a Proposta ainda "Aceita" no EspoCRM, apagar o Contrato gerado automaticamente pela Regra 1 faz a automação recriar um novo contrato no ciclo seguinte (ela só verifica "já existe contrato pra essa proposta", não se um já existiu e foi removido). Isso é esperado dado como a Regra 1 foi desenhada, mas é bom saber: **a forma correta de "desfazer" uma proposta aceita por engano é mudar o status dela** (ex: de volta pra `Rascunho` ou pra `Recusada`), não apagar o contrato gerado — só apagar o contrato sem mexer no status da proposta entra num ciclo de recriação a cada 5 minutos até a proposta deixar de estar "Aceita".
