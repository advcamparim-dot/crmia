# Mayara — Vínculo Automático aos Leads da Campanha (Landing Page) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No momento em que o formulário da campanha PJ é preenchido (landing page própria, confirmado pelo usuário), a Mayara deve iniciar o atendimento automaticamente — sem passar pelo grupo de WhatsApp da agência nem por um humano do escritório colando o telefone em algum lugar.

**Architecture:** Um novo workflow n8n recebe via webhook o evento que a agência vai configurar na landing page, cria (ou encontra) o Lead no EspoCRM, grava a sessão em `mayara.session_state` de forma idempotente, e envia a primeira mensagem via um template aprovado pela Meta (mensagem iniciada pela empresa, fora de qualquer janela de 24h — não pode ser texto livre). Isso expõe uma lacuna real no Gateway atual: hoje ele só autoriza mensagens **recebidas** que carreguem um `referral.source_id` aprovado ou venham do número de teste — uma resposta de um lead de landing page (sem referral) seria descartada silenciosamente. Este plano corrige isso adicionando uma terceira via de autorização: já existir uma sessão conhecida da Mayara para aquele telefone.

**Tech Stack:** n8n (remoto), n8n-mcp, Supabase Postgres (projeto `crmia-mayara`), EspoCRM (API REST), Meta WhatsApp Cloud API (Graph API).

**Spec:** `docs/superpowers/specs/2026-09-10-mayara-followup-funil-design.md` (seção "Vínculo automático da Mayara aos leads da campanha PJ").

## Global Constraints

- Nunca usar `localhost`. Nunca colar segredos em arquivo versionado ou texto de resposta.
- Node Postgres nesta instância n8n: **sempre `typeVersion: 2.6`**.
- Credencial Postgres: `Postgres account`, id `nNpCUIhnDuVvTApU`.
- Credencial EspoCRM: `EspoCRM Integração n8n — Mayara`, id `3CNvCGWMMDOyGD2n`, `httpHeaderAuth`. Base URL: `https://crm.camparimadvogados.com.br/api/v1/`.
- Credencial WhatsApp Graph API: `Bearer Auth account`, id `SChAKcHay4ghJVwe`, `httpBearerAuth`. Base URL: `https://graph.facebook.com/v25.0/{{phoneNumberId}}/messages`.
- `phoneNumberId` real do negócio: `1365007506685934`.
- `session_key` tem o formato `whatsapp:{phoneNumberId}:{telefone}`, `telefone` no formato `+55DDDNNNNNNNNN` (confirmado ao vivo no node `Normalizar e Filtrar Evento` do Gateway).
- **Decisão confirmada pelo usuário nesta sessão:** a ferramenta que capta o formulário é uma **landing page/formulário próprio** — a agência vai configurar um webhook apontando pro n8n (não é Meta Lead Ads nativo). O payload exato ainda não foi confirmado — este plano constrói o receptor de forma genérica e inclui um passo explícito de inspecionar o payload real assim que a agência mandar o primeiro teste, ajustando o parsing then (mesmo padrão já usado neste projeto para o formato de `intermediateSteps` do LangChain).
- **Bloqueio externo real, não contornável por este plano:** a primeira mensagem (mensagem iniciada pela empresa, fora de qualquer janela de 24h) precisa do template `primeiro_contato_campanha` aprovado pela Meta. Este plano constrói e testa o pipeline inteiro até a chamada da Graph API; o envio em si vai falhar até a aprovação — isso é esperado.
- Chaves padronizadas de `fatos_json` (já em uso no prompt principal, ver `docs/superpowers/specs/2026-09-09-mayara-contexto-atendimento-design.md`): `nomeCompleto`, `nomeEmpresa`, `telefone`, `email`, `tipoDivida`, `bancos`, `valorAproximado`, `documento`, `situacaoJudicial`, `urgencia`, `clienteAtual`. Usar as mesmas chaves ao popular `fatos_json` a partir do payload da landing page, não inventar nomes novos.
- Antes de qualquer ação n8n, invocar `n8n-mcp-skills:using-n8n-mcp-skills` se ainda não tiver sido invocada nesta sessão.
- Validar (`n8n_validate_workflow`) e inspecionar `connections` via `n8n_get_workflow` depois de toda edição de workflow.

---

### Task 1: Combinar com a agência a URL do webhook e o segredo compartilhado

**Files:** nenhum arquivo de repositório — ação manual do usuário.

**Interfaces:**
- Produces: URL do webhook + token secreto — usados pela Task 2 (validação) e repassados à agência fora deste repositório.

- [ ] **Passo 1: Gerar o token secreto**
Rodar localmente: `openssl rand -hex 24`. Guardar só na configuração do node (Task 2) — nunca em arquivo versionado ou nesta conversa.

- [ ] **Passo 2: Definir a URL final**
Depois de criado o workflow na Task 2 e ativado, a URL de produção do webhook n8n será `https://n8n.camparimadvogados.com.br/webhook/lead-campanha-pj?token=<token do Passo 1>`. Repassar essa URL completa (com o token já embutido) para a agência — a maioria de plataformas de landing page só suporta configurar uma "URL de callback" simples, sem cabeçalho customizado, por isso o segredo vai na query string, não num header.

- [ ] **Passo 3: Perguntar à agência o formato exato do payload**
Perguntar especificamente: quais campos o formulário envia (nome, telefone, email, empresa, tipo de dívida/mensagem livre?), em que formato (JSON no corpo? form-urlencoded?), e se há algum campo de identificação da campanha/UTM que valha registrar. A resposta define o parsing exato da Task 2, Passo 3 — até lá, o node de parsing é escrito de forma defensiva (aceita variações comuns) e ajustado contra o payload real assim que a agência mandar o primeiro teste de verdade (Task 2, Passo 8).

---

### Task 2: Criar o workflow `Mayara — Receber Lead da Campanha [Webhook]`

**Files:** novo workflow n8n (via `n8n_create_workflow`).

**Interfaces:**
- Consumes: token da Task 1, credencial `EspoCRM Integração n8n — Mayara`, credencial `Postgres account`, credencial `Bearer Auth account`.
- Produces: workflow que recebe o lead, cria/atualiza o registro no CRM e no Supabase, e envia o primeiro contato — consumido pela Task 3 (que corrige a autorização do Gateway pra essa conversa poder continuar).

- [ ] **Passo 1: Criar o workflow com o Webhook**
```javascript
n8n_create_workflow({
  name: "Mayara — Receber Lead da Campanha [Webhook]",
  nodes: [{
    name: "Receber Lead",
    type: "n8n-nodes-base.webhook",
    typeVersion: 2.1,
    position: [0, 0],
    parameters: {
      httpMethod: "POST",
      path: "lead-campanha-pj",
      responseMode: "responseNode",
      options: {}
    }
  }],
  connections: {}
})
```

- [ ] **Passo 2: Adicionar a checagem do token**
```javascript
{
  name: "Token Valido?",
  type: "n8n-nodes-base.if",
  typeVersion: 2.2,
  position: [220, 0],
  parameters: {
    conditions: {
      options: { version: 2, leftValue: "", caseSensitive: true, typeValidation: "strict" },
      combinator: "and",
      conditions: [{
        leftValue: "={{ $json.query.token }}",
        rightValue: "<token gerado na Task 1>",
        operator: { type: "string", operation: "equals" },
        id: "tk1"
      }]
    },
    options: {}
  }
}
```

- [ ] **Passo 3: Adicionar o parsing defensivo do payload (Code)**
```javascript
{
  name: "Normalizar Payload da Landing Page",
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position: [440, 0],
  parameters: {
    jsCode: `const body = $input.first().json.body || {};\n\nconst pick = (...chaves) => {\n  for (const c of chaves) {\n    if (body[c] !== undefined && body[c] !== null && String(body[c]).trim() !== '') return String(body[c]).trim();\n  }\n  return '';\n};\n\nconst nome = pick('nome', 'name', 'full_name', 'fullName');\nconst telefoneRaw = pick('telefone', 'phone', 'whatsapp', 'celular');\nconst email = pick('email', 'e-mail');\nconst empresa = pick('empresa', 'company', 'nome_empresa', 'razao_social');\nconst mensagem = pick('mensagem', 'message', 'observacoes', 'assunto');\n\nlet digitos = telefoneRaw.replace(/\\D/g, '');\nif (digitos.length > 11 && digitos.startsWith('55')) digitos = digitos.slice(2);\nconst telefone = digitos ? '+55' + digitos : '';\n\nreturn [{\n  json: {\n    payloadValido: Boolean(nome && telefone),\n    nome, telefone, email, empresa, mensagem,\n    phoneNumberId: '1365007506685934',\n    sessionKey: telefone ? \\`whatsapp:1365007506685934:\\${telefone}\\` : ''\n  }\n}];`
  }
}
```

**Nota:** este parsing é uma primeira aproximação (nomes de campo comuns em formulários de captação). O Passo 8 deste Task exige confirmar contra um envio real da agência e ajustar `pick(...)` com os nomes de campo reais antes de considerar isso pronto para produção.

- [ ] **Passo 4: Adicionar `Payload Valido?` (IF)**
```javascript
{
  name: "Payload Valido?",
  type: "n8n-nodes-base.if",
  typeVersion: 2.2,
  position: [660, 0],
  parameters: {
    conditions: {
      options: { version: 2, leftValue: "", caseSensitive: true, typeValidation: "loose" },
      combinator: "and",
      conditions: [{ leftValue: "={{ $json.payloadValido }}", rightValue: true, operator: { type: "boolean", operation: "true", singleValue: true }, id: "p1" }]
    },
    options: {}
  }
}
```

- [ ] **Passo 5: Portar a busca/criação de Lead no EspoCRM (mesmo padrão do sub-workflow de CRM)**

Copiar a configuração real (confirmada ao vivo nesta sessão no workflow `Mayara — Persistir Consulta no CRM [Sub-workflow]`, id `vf3iq6V7ztgsQS8G`):

```javascript
{
  name: "Buscar Lead por Telefone",
  type: "n8n-nodes-base.httpRequest",
  typeVersion: 4.4,
  onError: "continueErrorOutput",
  position: [880, 0],
  parameters: {
    url: "https://crm.camparimadvogados.com.br/api/v1/Lead",
    authentication: "genericCredentialType",
    genericAuthType: "httpHeaderAuth",
    sendQuery: true,
    queryParameters: { parameters: [
      { name: "where[0][type]", value: "equals" },
      { name: "where[0][attribute]", value: "phoneNumber" },
      { name: "where[0][value]", value: "={{ $json.telefone }}" }
    ]},
    sendHeaders: true, headerParameters: { parameters: [{}] }, options: {}
  },
  credentials: { httpHeaderAuth: { id: "3CNvCGWMMDOyGD2n", name: "EspoCRM Integração n8n — Mayara" } }
}
```
```javascript
{
  name: "Lead Encontrado?",
  type: "n8n-nodes-base.if",
  typeVersion: 2.3,
  position: [1100, 0],
  parameters: {
    conditions: {
      options: { version: 2, leftValue: "", caseSensitive: true, typeValidation: "loose" },
      combinator: "and",
      conditions: [{ leftValue: "={{ $json.total }}", rightValue: 0, operator: { type: "number", operation: "gt" }, id: "le1" }]
    },
    options: {}
  }
}
```
```javascript
// branch verdadeiro (lead já existe)
{
  name: "Lead Existente",
  type: "n8n-nodes-base.set",
  typeVersion: 3.4,
  position: [1320, -100],
  parameters: { assignments: { assignments: [{ id: "l1", name: "leadId", type: "string", value: "={{ $json.list[0].id }}" }] } }
}
```
```javascript
// branch falso (criar)
{
  name: "Criar Lead no CRM",
  type: "n8n-nodes-base.httpRequest",
  typeVersion: 4.4,
  onError: "continueErrorOutput",
  position: [1320, 100],
  parameters: {
    method: "POST",
    url: "https://crm.camparimadvogados.com.br/api/v1/Lead",
    authentication: "genericCredentialType",
    genericAuthType: "httpHeaderAuth",
    sendHeaders: true, headerParameters: { parameters: [{}] },
    sendBody: true,
    bodyParameters: { parameters: [
      { name: "firstName", value: "={{ $('Normalizar Payload da Landing Page').item.json.nome.split(' ')[0] }}" },
      { name: "lastName", value: "={{ $('Normalizar Payload da Landing Page').item.json.nome.split(' ').slice(1).join(' ') || '' }}" },
      { name: "accountName", value: "={{ $('Normalizar Payload da Landing Page').item.json.empresa || '' }}" },
      { name: "phoneNumber", value: "={{ $('Normalizar Payload da Landing Page').item.json.telefone }}" },
      { name: "emailAddress", value: "={{ $('Normalizar Payload da Landing Page').item.json.email }}" },
      { name: "description", value: "={{ $('Normalizar Payload da Landing Page').item.json.mensagem || 'Lead da campanha PJ — formulário da landing page' }}" },
      { name: "assignedUserId", value: "6a899d5f8a2b61a29" }
    ]},
    options: {}
  },
  credentials: { httpHeaderAuth: { id: "3CNvCGWMMDOyGD2n", name: "EspoCRM Integração n8n — Mayara" } }
}
```
```javascript
{
  name: "Lead Criado",
  type: "n8n-nodes-base.set",
  typeVersion: 3.4,
  position: [1540, 100],
  parameters: { assignments: { assignments: [{ id: "l2", name: "leadId", type: "string", value: "={{ $json.id }}" }] } }
}
```

- [ ] **Passo 5b: Adicionar o tratamento de falha do CRM (nunca bloquear o primeiro contato por causa do EspoCRM)**

`Buscar Lead por Telefone` e `Criar Lead no CRM` têm `onError: continueErrorOutput` — a saída de erro (índice 1) de ambos precisa de destino, senão o item simplesmente desaparece da execução (o webhook nunca responde, o lead nunca recebe a primeira mensagem, e a falha fica invisível). Mesma filosofia já usada em toda a automação: falha de CRM nunca bloqueia a ação real que já vale pro lead — aqui, a ação real é o primeiro contato via WhatsApp, não o registro no CRM.

```javascript
{
  name: "Registrar Falha de CRM (Campanha)",
  type: "n8n-nodes-base.postgres",
  typeVersion: 2.6,
  position: [1320, 300],
  onError: "continueRegularOutput",
  parameters: {
    operation: "executeQuery",
    query: "insert into mayara.crm_retry_failed (payload, motivo_falha, tentativas) values ($1::jsonb, 'falha ao buscar/criar lead da campanha (webhook landing page)', 0);",
    options: {
      queryReplacement: "={{ [JSON.stringify($('Normalizar Payload da Landing Page').item.json)] }}"
    }
  },
  credentials: { postgres: { id: "nNpCUIhnDuVvTApU", name: "Postgres account" } }
}
```

Esse node não tem `leadId` pra oferecer — os nodes seguintes (`Registrar Sessao (Idempotente)`, `Enviar Primeiro Contato via Graph API`) não dependem de `leadId`, só de campos de `Normalizar Payload da Landing Page` (já referenciados por lookup nomeado), então o fluxo segue normalmente mesmo sem o Lead ter sido criado no CRM. Alguém revisa `mayara.crm_retry_failed` manualmente depois (mesma tabela/rotina já usada pro retry de CRM da fundação de dados) e cria o Lead à mão se necessário.

- [ ] **Passo 6: Adicionar a gravação idempotente em `mayara.session_state`**

Usa `INSERT ... ON CONFLICT DO NOTHING RETURNING *` — se a linha já existia (webhook chamado 2x pra o mesmo lead, ou lead que já tinha escrito antes por algum motivo), a query não retorna nada, e o próximo IF evita mandar a primeira mensagem de novo.

```javascript
{
  name: "Registrar Sessao (Idempotente)",
  type: "n8n-nodes-base.postgres",
  typeVersion: 2.6,
  position: [1760, 0],
  onError: "continueRegularOutput",
  parameters: {
    operation: "executeQuery",
    query: "insert into mayara.session_state (session_key, phone, phone_number_id, fatos_json, follow_up_stage, follow_up_last_sent_at, follow_up_tentativas)\nvalues ($1, $2, $3, $4::jsonb, 'template1', now(), 1)\non conflict (session_key) do nothing\nreturning session_key;",
    options: {
      queryReplacement: "={{ [$json.sessionKey, $json.telefone, $json.phoneNumberId, JSON.stringify({ nomeCompleto: $json.nome, telefone: $json.telefone, email: $json.email, nomeEmpresa: $json.empresa, tipoDivida: $json.mensagem || '' })] }}"
    }
  },
  credentials: { postgres: { id: "nNpCUIhnDuVvTApU", name: "Postgres account" } }
}
```

**Por que `follow_up_stage = 'template1'` e não `'nenhum'`:** isso marca essa sessão como "primeiro contato já feito", pra que o worker de follow-up "sumiu no meio" (que só age quando `last_lead_message_at` está preenchido) nunca mande uma mensagem de **texto livre** pra esse número antes de ele ter respondido pela primeira vez — mandar texto livre pra quem nunca abriu a janela de 24h violaria a regra da Meta. `last_lead_message_at` fica `NULL` de propósito até a resposta real do lead chegar pelo Gateway (o node `Registrar Ultima Mensagem do Lead`, já existente no Núcleo, zera `follow_up_stage`/`follow_up_tentativas` na primeira resposta de qualquer lead — o fluxo normal de conversa assume dali em diante, sem mudança nenhuma).

- [ ] **Passo 7: Adicionar `Sessao Nova?` (IF) + montagem do template + envio**
```javascript
{
  name: "Sessao Nova?",
  type: "n8n-nodes-base.if",
  typeVersion: 2.2,
  position: [1980, 0],
  parameters: {
    conditions: {
      options: { version: 2, leftValue: "", caseSensitive: true, typeValidation: "loose" },
      combinator: "and",
      conditions: [{ leftValue: "={{ $json.session_key }}", rightValue: "", operator: { type: "string", operation: "notEmpty" }, id: "s1" }]
    },
    options: {}
  }
}
```
```javascript
{
  name: "Enviar Primeiro Contato via Graph API",
  type: "n8n-nodes-base.httpRequest",
  typeVersion: 4.4,
  position: [2200, -100],
  onError: "continueRegularOutput",
  parameters: {
    method: "POST",
    url: "=https://graph.facebook.com/v25.0/{{ $('Normalizar Payload da Landing Page').item.json.phoneNumberId }}/messages",
    authentication: "genericCredentialType",
    genericAuthType: "httpBearerAuth",
    sendBody: true,
    specifyBody: "json",
    jsonBody: "={{ JSON.stringify({ messaging_product: 'whatsapp', to: $('Normalizar Payload da Landing Page').item.json.telefone.replace(/\\D/g, ''), type: 'template', template: { name: 'primeiro_contato_campanha', language: { code: 'pt_BR' }, components: [{ type: 'body', parameters: [{ type: 'text', text: $('Normalizar Payload da Landing Page').item.json.nome.split(' ')[0] }, { type: 'text', text: $('Normalizar Payload da Landing Page').item.json.mensagem || 'gestão de passivo bancário' }] }] } }) }}",
    options: { timeout: 25000 }
  },
  credentials: { httpBearerAuth: { id: "SChAKcHay4ghJVwe", name: "Bearer Auth account" } }
}
```
```javascript
{
  name: "Responder Webhook",
  type: "n8n-nodes-base.respondToWebhook",
  typeVersion: 1.4,
  position: [2420, 0],
  parameters: { respondWith: "json", responseBody: "={{ { received: true } }}" }
}
```

- [ ] **Passo 8: Conectar tudo**
```javascript
n8n_update_partial_workflow({
  id: "<id do workflow>",
  operations: [
    { type: "addConnection", source: "Receber Lead", target: "Token Valido?", sourceOutput: "main" },
    { type: "addConnection", source: "Token Valido?", target: "Normalizar Payload da Landing Page", sourceOutput: "main", sourceIndex: 0 },
    { type: "addConnection", source: "Normalizar Payload da Landing Page", target: "Payload Valido?", sourceOutput: "main" },
    { type: "addConnection", source: "Payload Valido?", target: "Buscar Lead por Telefone", sourceOutput: "main", sourceIndex: 0 },
    { type: "addConnection", source: "Buscar Lead por Telefone", target: "Lead Encontrado?", sourceOutput: "main", sourceIndex: 0 },
    { type: "addConnection", source: "Lead Encontrado?", target: "Lead Existente", sourceOutput: "main", sourceIndex: 0 },
    { type: "addConnection", source: "Lead Encontrado?", target: "Criar Lead no CRM", sourceOutput: "main", sourceIndex: 1 },
    { type: "addConnection", source: "Criar Lead no CRM", target: "Lead Criado", sourceOutput: "main", sourceIndex: 0 },
    { type: "addConnection", source: "Buscar Lead por Telefone", target: "Registrar Falha de CRM (Campanha)", sourceOutput: "main", sourceIndex: 1 },
    { type: "addConnection", source: "Criar Lead no CRM", target: "Registrar Falha de CRM (Campanha)", sourceOutput: "main", sourceIndex: 1 },
    { type: "addConnection", source: "Registrar Falha de CRM (Campanha)", target: "Registrar Sessao (Idempotente)", sourceOutput: "main" },
    { type: "addConnection", source: "Lead Existente", target: "Registrar Sessao (Idempotente)", sourceOutput: "main" },
    { type: "addConnection", source: "Lead Criado", target: "Registrar Sessao (Idempotente)", sourceOutput: "main" },
    { type: "addConnection", source: "Registrar Sessao (Idempotente)", target: "Sessao Nova?", sourceOutput: "main" },
    { type: "addConnection", source: "Sessao Nova?", target: "Enviar Primeiro Contato via Graph API", sourceOutput: "main", sourceIndex: 0 },
    { type: "addConnection", source: "Sessao Nova?", target: "Responder Webhook", sourceOutput: "main", sourceIndex: 1 },
    { type: "addConnection", source: "Enviar Primeiro Contato via Graph API", target: "Responder Webhook", sourceOutput: "main" },
    { type: "addConnection", source: "Token Valido?", target: "Responder Webhook", sourceOutput: "main", sourceIndex: 1 },
    { type: "addConnection", source: "Payload Valido?", target: "Responder Webhook", sourceOutput: "main", sourceIndex: 1 }
  ]
})
```
Os branches "falso" de `Token Valido?` e `Payload Valido?` vão direto pra `Responder Webhook` (rejeição silenciosa, sem vazar detalhe do motivo pra fora, e sem deixar o webhook pendurado até o timeout).

- [ ] **Passo 9: Validar**
```javascript
n8n_validate_workflow({ id: "<id do workflow>" })
```
Esperado: 0 erros.

- [ ] **Passo 10: Testar com um payload sintético**
```javascript
n8n_test_workflow({
  workflowId: "<id do workflow>",
  method: "trigger", triggerType: "webhook", httpMethod: "POST",
  data: { nome: "Fernanda Teste Campanha", telefone: "11988887777", email: "fernanda.campanha.mayara@teste.invalid", empresa: "Teste Campanha LTDA", mensagem: "dívida de capital de giro" }
})
```
(Passar `?token=<token>` na URL de teste, conforme o modo de trigger disponível no `n8n_test_workflow` permitir — se não suportar query string diretamente, testar via `curl` contra a URL de teste do n8n.)

Verificar:
```sql
select session_key, phone, follow_up_stage, fatos_json from mayara.session_state where phone = '+5511988887777';
```
Esperado: linha criada, `follow_up_stage = 'template1'`, `fatos_json` com os campos certos, **independente de o Lead ter sido criado no EspoCRM ou não**. O erro 403 do EspoCRM (achado original da auditoria V2, ainda não corrigido — `mayara.crm_retry_failed` já tem milhares de linhas de outras rotinas) provavelmente vai fazer este teste cair no branch `Registrar Falha de CRM (Campanha)` em vez de `Lead Criado`; isso é esperado e não invalida o teste — confirmar via `n8n_executions` que, mesmo assim, `Registrar Sessao (Idempotente)` e a tentativa de envio rodaram normalmente depois. Se o 403 já tiver sido corrigido nesse meio-tempo, o caminho esperado é `Lead Criado` de verdade — nesse caso, confirmar também no EspoCRM (via `Time Chaves — Consulta CRM` ou GET direto) que o Lead foi criado com telefone/nome corretos. Em ambos os casos, o envio via Graph API deve **falhar** (template não aprovado ainda) — confirmar que essa falha aconteceu no node certo, não antes.

- [ ] **Passo 11: Testar a idempotência**
Rodar o mesmo teste do Passo 10 de novo (mesmo telefone).
```sql
select count(*) from mayara.session_state where phone = '+5511988887777';
```
Esperado: ainda 1 linha (não duplicou), e confirmar via `n8n_executions` que a segunda execução não tentou mandar mensagem de novo (branch falso de `Sessao Nova?`).

- [ ] **Passo 12: Limpeza dos dados de teste**
```sql
delete from mayara.session_state where phone = '+5511988887777';
```
Anotar o Lead de teste criado no EspoCRM (`fernanda.campanha.mayara@teste.invalid`) para remoção manual.

- [ ] **Passo 13: Ativar o workflow**
```javascript
n8n_update_partial_workflow({ id: "<id do workflow>", operations: [{ type: "activateWorkflow" }] })
```

---

### Task 3: Corrigir a autorização do Gateway para respostas de leads da campanha

**Files:** workflow `WhatsApp - Gateway Seguro` (id `FV0PEtEcTFbuoRaO`).

**Interfaces:**
- Consumes: `mayara.session_state` (existência de uma sessão pro telefone que está respondendo).
- Produces: node `Evento Autorizado?` passa a aceitar também replies de leads que a Mayara já contatou (via Task 2), não só referral de anúncio ou o número de teste hardcoded.

**Achado real desta sessão, crítico para o objetivo deste plano:** o node `Normalizar e Filtrar Evento` hoje só marca `accepted: true` quando `referral.source_id` bate com `approvedReferralSourceIds` (mecanismo de clique em anúncio, nunca configurado de verdade — o valor ainda é o placeholder `'CONFIGURAR_ID_CAMPANHA'`) ou quando o telefone é o número de teste hardcoded. Uma resposta normal de um lead que a Mayara contatou via Task 2 **não carrega `referral`** — sem esta correção, a resposta desse lead seria descartada silenciosamente pelo Gateway, e a Task 2 nunca teria continuidade de conversa.

- [ ] **Passo 1: Adicionar um node Postgres de checagem antes do IF de autorização**
```javascript
n8n_update_partial_workflow({
  id: "FV0PEtEcTFbuoRaO",
  operations: [{
    type: "addNode",
    node: {
      name: "Sessao Ja Existe?",
      type: "n8n-nodes-base.postgres",
      typeVersion: 2.6,
      position: [800, 560],
      onError: "continueRegularOutput",
      parameters: {
        operation: "executeQuery",
        query: "select session_key from mayara.session_state where session_key = $1 and follow_up_status <> 'excluido_seguranca';",
        options: { queryReplacement: "={{ [$json.sessionKey] }}" }
      },
      credentials: { postgres: { id: "nNpCUIhnDuVvTApU", name: "Postgres account" } }
    }
  }]
})
```

**Por que excluir `follow_up_status = 'excluido_seguranca'` aqui também:** mesma camada redundante de segurança já aplicada no worker de follow-up (achado da revisão de código de 2026-09-10) — um lead marcado como situação patrimonial sensível não deve reabrir conversa automática nem por essa via.

- [ ] **Passo 2: Este node Postgres, em modo `executeQuery`, substitui o `$json` do item pelo resultado da query — preservar os campos originais antes de seguir**

Adicionar um node `Set` logo depois, mesclando de volta:
```javascript
{
  name: "Combinar Resultado da Sessao",
  type: "n8n-nodes-base.set",
  typeVersion: 3.4,
  position: [900, 560],
  parameters: {
    assignments: {
      assignments: [
        { id: "c1", name: "sessaoExistente", type: "boolean", value: "={{ $json.session_key ? true : false }}" }
      ]
    },
    options: { includeOtherFields: true }
  }
}
```
(`includeOtherFields: true` preserva os campos originais do `Normalizar e Filtrar Evento` que vieram por referência posicional — conferir na UI/`n8n_get_workflow` depois de aplicar que `accepted`, `phone`, `sessionKey`, etc. realmente sobreviveram; se não sobreviverem, usar `$('Normalizar e Filtrar Evento').item.json` explicitamente nas expressões do node seguinte em vez de depender de `includeOtherFields`.)

- [ ] **Passo 3: Atualizar a condição de `Evento Autorizado?`**
```javascript
n8n_update_partial_workflow({
  id: "FV0PEtEcTFbuoRaO",
  operations: [{
    type: "updateNode",
    nodeName: "Evento Autorizado?",
    changes: {
      "parameters.conditions.conditions": [
        {
          id: "whatsapp-evento-aceito",
          leftValue: "={{ $json.accepted || $json.sessaoExistente }}",
          rightValue: true,
          operator: { type: "boolean", operation: "true", singleValue: true }
        }
      ]
    }
  }]
})
```

- [ ] **Passo 4: Reconectar a cadeia**
```javascript
n8n_update_partial_workflow({
  id: "FV0PEtEcTFbuoRaO",
  operations: [
    { type: "removeConnection", source: "Normalizar e Filtrar Evento", target: "Evento Autorizado?" },
    { type: "addConnection", source: "Normalizar e Filtrar Evento", target: "Sessao Ja Existe?", sourceOutput: "main" },
    { type: "addConnection", source: "Sessao Ja Existe?", target: "Combinar Resultado da Sessao", sourceOutput: "main" },
    { type: "addConnection", source: "Combinar Resultado da Sessao", target: "Evento Autorizado?", sourceOutput: "main" }
  ]
})
```

- [ ] **Passo 5: Validar**
```javascript
n8n_validate_workflow({ id: "FV0PEtEcTFbuoRaO" })
```
Esperado: 0 erros.

- [ ] **Passo 6: Verificar conexões**
```javascript
n8n_get_workflow({ id: "FV0PEtEcTFbuoRaO", mode: "structure" })
```
Confirmar: `Normalizar e Filtrar Evento → Sessao Ja Existe? → Combinar Resultado da Sessao → Evento Autorizado?`.

- [ ] **Passo 7: Testar os 3 caminhos de autorização**

Criar uma sessão de teste primeiro:
```sql
insert into mayara.session_state (session_key, phone, phone_number_id)
values ('whatsapp:1365007506685934:+5511977776666', '+5511977776666', '1365007506685934')
on conflict (session_key) do nothing;
```

Simular um evento de webhook do Gateway (via `n8n_test_workflow` no modo apropriado ou reconstrução do payload real da Meta) para 3 números:
1. Número de teste hardcoded (`+5514997022609`) → esperado `accepted=true` (via `authorizedForTest`, caminho já existente, não deve regredir).
2. Número `+5511977776666` (sessão criada acima, sem referral) → esperado autorizado agora via `sessaoExistente=true` (o novo caminho).
3. Um número aleatório sem sessão nenhuma e sem referral (ex. `+5511900000000`) → esperado **continuar rejeitado** (`Ignorar Evento com Seguranca`) — este é o teste mais importante: confirma que a correção não abriu a porta pra qualquer número.

- [ ] **Passo 8: Limpeza**
```sql
delete from mayara.session_state where session_key = 'whatsapp:1365007506685934:+5511977776666';
```

---

### Task 4: Regressão e documentação

**Files:** `docs/superpowers/specs/2026-09-10-mayara-followup-funil-design.md` (append).

**Interfaces:**
- Consumes: todas as tasks anteriores.

- [ ] **Passo 1: Confirmar que o caminho de referral de anúncio (Ads) não regrediu**
Simular um evento com `referral.source_id` igual a um valor fictício **fora** de `approvedReferralSourceIds` → esperado continuar rejeitado (nada mudou nesse caminho).

- [ ] **Passo 2: Confirmar que uma conversa normal iniciada pelo fluxo antigo (Núcleo/Ponte) continua funcionando ponta a ponta**
Rodar um teste completo via `[TEST HARNESS] Mayara V2` (não passa pelo Gateway, mas confirma que nada no Núcleo foi afetado por este plano).

- [ ] **Passo 3: Atualizar a spec**
Adicionar seção "Implementado — Vínculo Automático de Leads da Campanha (2026-09-15)": workflow novo (id), correção de autorização do Gateway (achado + fix), resultado dos testes, e as duas pendências externas em aberto: (a) payload real da landing page ainda não confirmado com a agência — parsing da Task 2 Passo 3 pode precisar de ajuste no primeiro envio real; (b) template `primeiro_contato_campanha` ainda não aprovado pela Meta.

- [ ] **Passo 4: Commit**
```bash
git add docs/superpowers/specs/2026-09-10-mayara-followup-funil-design.md
git commit -m "docs: registra implementação do vínculo automático de leads da campanha PJ

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Riscos / suposições abertas

- O payload real da landing page não foi confirmado campo a campo com a agência — o parsing da Task 2 é uma primeira aproximação, testada só com dados sintéticos. Primeira submissão real precisa ser inspecionada via `n8n_executions` antes de confiar no pipeline em produção.
- O texto e as variáveis do template `primeiro_contato_campanha` são um rascunho (mesmo da spec) — conferir contra a aprovação real da Meta antes de considerar o envio validado.
- A correção de autorização do Gateway (Task 3) é testada com payloads simulados nesta sessão — vale um teste com um número real controlado (mesmo padrão do número de teste autorizado já usado no debounce) antes do primeiro lead real de verdade passar por esse caminho.
