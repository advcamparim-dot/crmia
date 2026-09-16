# Mayara (Camparim Advogados) — Improvement Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden, clean up, and modernize the Mayara WhatsApp AI-intake system (n8n instance at `n8n.camparimadvogados.com.br`) before and after connecting the office's real WhatsApp number.

**Architecture:** n8n-hosted workflow system (no local codebase, no git repo — this project lives entirely on the remote n8n instance). "Files" below mean n8n **workflows and nodes**, addressed by their real IDs. "Tests" mean `validate_workflow` + `n8n_get_workflow` structural verification, plus live executions via `n8n_test_workflow` / real WhatsApp messages where noted. "Commit" means confirming the change landed via `n8n_get_workflow` (there is no git history for workflows — `n8n_workflow_versions` is the closest analog and is noted where useful).

**Tech Stack:** n8n (self-hosted, currently v2.10.2), n8n-mcp MCP server, `@n8n/n8n-nodes-langchain` (AI Agent + Anthropic), Google Calendar API, WhatsApp Cloud API (Meta Graph API), n8n Data Tables.

**Spec:** No separate spec file exists. This plan's requirements come from a live audit of the running system conducted 2026-09-05 (security audit, execution tracing, and 5 production bugs found and fixed in that session — expired WhatsApp token, expired Google OAuth, a tool wired into the main chain instead of `ai_tool`, an unconfigured Data Table write, and two competing terminal branches causing non-deterministic sub-workflow return values). That session's findings are the basis for every task below.

## Global Constraints

- Never apply a workflow-changing operation without `validateOnly: true` first when the change touches more than a single field.
- After every `n8n_update_partial_workflow` call that is meant to persist, immediately verify with `n8n_get_workflow(mode: "structure")` — validation passing is not proof the wiring is correct.
- Never call `n8n_delete_workflow` without explicit user confirmation naming the specific workflow ID.
- Secrets (API keys, app secrets) go through n8n's credential system or `$env` — never inline into a node parameter as literal text.
- Every fix must be verified against a **real execution** (either `n8n_test_workflow` once the instance-level MCP server is enabled — Task 3.2 — or a real WhatsApp message from the authorized test number `+5514997022609`) before being considered done. A workflow that only "validates" is not proven correct — the 2026-09-05 session validated clean multiple times while the system was still silently broken.
- The webhook signature check (Task 1.3) is the **one deliberate exception** to this system's fail-open philosophy: everywhere else, `onError: continueRegularOutput` degrades gracefully to a human handoff; the signature check must fail **closed** (`stopWorkflow`), because a forged request must never reach the AI agent or the CRM.

---

## Track 1 — Security (pre-launch, blocking before the real number goes live)

### Task 1.1: Provision `META_APP_SECRET` as an environment variable

**Workflows/Nodes:** None (n8n instance-level configuration, done in Coolify — outside n8n-mcp's reach).

- [ ] **Step 1: Get the App Secret**
  User retrieves it from the Meta App Dashboard → Settings → Basic → App Secret (click "Show").
- [ ] **Step 2: Set the env var and restart n8n**
  User adds `META_APP_SECRET=<value>` to the n8n service's environment in Coolify and redeploys/restarts the container.
- [ ] **Step 3: Verify env access is not blocked**
  Run `n8n_health_check({mode: "diagnostic"})`. Confirm the instance responds (new uptime) and that nothing in the diagnostic output indicates `N8N_BLOCK_ENV_ACCESS_IN_NODE=true` (that flag would prevent `$env` from working inside Code nodes in Task 1.3).

### Task 1.2: Expose the raw request body on the events webhook

**Workflows/Nodes:**
- Modify: Workflow `FV0PEtEcTFbuoRaO` ("WhatsApp - Gateway Seguro"), node `Meta - Receber Eventos` (id `1dacca52-36f8-4c7f-8faf-8251bcb1830f`)

- [ ] **Step 1: Confirm the current option name for raw body access**
  Run `get_node({nodeType: "nodes-base.webhook", mode: "docs"})`. This n8n instance is 27 versions behind current (Task 3.1) — confirm the exact parameter (historically `options.rawBody: true`) against this instance's actual version rather than assuming.
- [ ] **Step 2: Enable it**
  ```javascript
  n8n_update_partial_workflow({
    id: "FV0PEtEcTFbuoRaO",
    intent: "Enable raw body capture on the Meta events webhook so its signature can be verified",
    validateOnly: true,
    operations: [{type: "updateNode", nodeId: "1dacca52-36f8-4c7f-8faf-8251bcb1830f", updates: {"parameters.options.rawBody": true}}]
  })
  ```
  If valid, re-run without `validateOnly`.
- [ ] **Step 3: Verify**
  `n8n_get_workflow({id: "FV0PEtEcTFbuoRaO", mode: "filtered", nodeNames: ["Meta - Receber Eventos"]})` — confirm the option is set.

### Task 1.3: Add HMAC signature verification before the event is trusted

**Superseded design (2026-09-05):** the original Code-node + `$env.META_APP_SECRET` approach does not work on this instance — verified live: Code nodes here throw `"access to env vars denied"` (this instance has environment-variable access blocked in Code nodes), and the Code node itself has no `credentials` slot (`get_node` shows `"credentials": []`). Use the **native Crypto node** instead (`n8n-nodes-base.crypto`, `action: "hmac"`), which takes a real n8n **Credential** of type `crypto` (`getSchema` confirms field `hmacSecret`) — the secret never touches a node parameter or an env var read from Code.

**Workflows/Nodes:**
- Credential: `crypto` type, named "Meta App Secret" — **created by the user directly in the n8n UI** (Settings → Credentials → New → Crypto → `hmacSecret` = the same App Secret used in Coolify's `META_APP_SECRET`), never pasted into chat.
- Create: node `Calcular HMAC Meta` (`n8n-nodes-base.crypto`, action `hmac`, type `SHA256`, `value` = the raw body, `dataPropertyName: "computedHmac"`, credential = "Meta App Secret"), inserted between `Meta - Receber Eventos` (`1dacca52-...`) and `Normalizar e Filtrar Evento` (`266cec51-...`)
- Create: node `Assinatura Válida?` (`n8n-nodes-base.if`), comparing the computed signature to the header, wired between `Calcular HMAC Meta` and `Normalizar e Filtrar Evento`; the false branch goes to a new `NoOp` "Assinatura Rejeitada" dead-end (or reuses `Ignorar Evento com Seguranca`) instead of falling through.

- [ ] **Step 1: List credentials to get the new credential's ID**
  `n8n_manage_credentials({action: "list"})` — find "Meta App Secret", note its `id`.
- [ ] **Step 2: Confirm the raw-body accessor**
  `get_node({nodeType: "nodes-base.webhook", mode: "docs"})` — confirm what property/shape Task 1.2's `options.rawBody: true` exposes on this instance's version (needed for the Crypto node's `value` expression).
- [ ] **Step 3: Add the two nodes, `validateOnly: true` first**
  ```javascript
  n8n_update_partial_workflow({
    id: "FV0PEtEcTFbuoRaO",
    intent: "Add HMAC-SHA256 signature verification (native Crypto node + credential) before events are trusted, failing closed on mismatch",
    validateOnly: true,
    operations: [
      {type: "addNode", node: {
        name: "Calcular HMAC Meta",
        type: "n8n-nodes-base.crypto",
        typeVersion: 2,
        position: [552, 460],
        parameters: {
          action: "hmac",
          type: "SHA256",
          value: "={{ /* raw body expression from Step 2 */ }}",
          dataPropertyName: "computedHmac",
          encoding: "hex"
        },
        credentials: {crypto: {id: "<id from Step 1>", name: "Meta App Secret"}}
      }},
      {type: "addNode", node: {
        name: "Assinatura Válida?",
        type: "n8n-nodes-base.if",
        typeVersion: 2.2,
        position: [780, 460],
        parameters: {conditions: {combinator: "and", conditions: [{
          leftValue: "={{ 'sha256=' + $json.computedHmac }}",
          rightValue: "={{ $('Meta - Receber Eventos').item.json.headers['x-hub-signature-256'] }}",
          operator: {type: "string", operation: "equals"}
        }]}}
      }},
      {type: "removeConnection", source: "1dacca52-36f8-4c7f-8faf-8251bcb1830f", target: "266cec51-f7f4-4349-8b02-a344930094d2"},
      {type: "addConnection", source: "1dacca52-36f8-4c7f-8faf-8251bcb1830f", target: "Calcular HMAC Meta"},
      {type: "addConnection", source: "Calcular HMAC Meta", target: "Assinatura Válida?"},
      {type: "addConnection", source: "Assinatura Válida?", target: "266cec51-f7f4-4349-8b02-a344930094d2", branch: "true"},
      {type: "addConnection", source: "Assinatura Válida?", target: "c5b72426-b3fd-4481-ac03-2fe68f037135", branch: "false"}
    ]
  })
  ```
  Note: a plain string-equals IF comparison (not a constant-time `timingSafeEqual`) is an accepted, deliberate trade-off here to stay entirely on native nodes and avoid the blocked Code-node path — reasonable given the threat model (network-jitter timing attacks on a webhook are not the realistic risk; a forged/missing signature is).
- [ ] **Step 4: Apply for real** (drop `validateOnly`), then `n8n_validate_workflow({id: "FV0PEtEcTFbuoRaO"})` — expect no new errors.
- [ ] **Step 5: Verify wiring**
  `n8n_get_workflow({id: "FV0PEtEcTFbuoRaO", mode: "structure"})` — confirm `Calcular HMAC Meta` → `Assinatura Válida?` sits between `Meta - Receber Eventos` and `Normalizar e Filtrar Evento`, with the false branch routed to the reject/no-op path.
- [ ] **Step 6: Test the negative case**
  Send a POST to the events webhook URL with a wrong/missing `x-hub-signature-256` header (via `curl` or Postman) and confirm via `n8n_executions` that it lands on the false/reject branch, never reaching `Normalizar e Filtrar Evento`.
- [ ] **Step 7: Test the positive case**
  Send one real WhatsApp test message and confirm via `n8n_executions` that it passes `Assinatura Válida?` on the true branch and reaches `Normalizar e Filtrar Evento` as before.

### Task 1.4: Triage and remove genuine hardcoded PII

**Workflows/Nodes:** Whatever `n8n_audit_instance` flags under `CRED-00x` at execution time (drifts — re-run fresh).

- [ ] **Step 1: Re-run the audit**
  `n8n_audit_instance({categories: ["credentials"], customChecks: ["hardcoded_secrets"]})`.
- [ ] **Step 2: Triage each finding**
  For each hit, decide: is this the firm's own operational address (e.g. `advcamparim@gmail.com` as the Calendar ID) — acceptable, document as reviewed — or a third party's data typed in literally? Only the latter needs fixing.
- [ ] **Step 3: Fix genuine findings**
  Move the value into a Data Table row (e.g. a `config` table) and reference it via a `Get row(s)` lookup or expression, instead of a literal string in the node.
- [ ] **Step 4: Re-audit**
  `n8n_audit_instance` again — confirm the count of genuine (non-accepted) PII findings is zero, and record which findings were consciously accepted.

### Task 1.5: Wire a global Error Workflow

**Workflows/Nodes:**
- Modify settings on: `B1xdt1WotCQE3NOb` (Ponte WhatsApp), `FV0PEtEcTFbuoRaO` (Gateway), `GWvEz64JQfI2Nij4` (core agent), `UUj57cKUtrDXPrZZ` (Teste Controlado v2), `iOxLSjMpbQ4Ox88K` (Logging Fail-Open)
- Error handler: `jeDTXA5lBqT6VucW` ("Alertas — Jurídico e Operacional")

- [ ] **Step 1: Confirm the alert workflow can receive error payloads**
  `n8n_get_workflow({id: "jeDTXA5lBqT6VucW", mode: "structure"})` — confirm it starts with an Error Trigger node (`n8n-nodes-base.errorTrigger`). If not, add one as its entry point (a separate small task; the trigger receives `{execution, workflow}` and can format/relay to wherever the existing Alertas nodes send notifications).
- [ ] **Step 2: Point each production workflow at it**
  For each workflow ID above:
  ```javascript
  n8n_update_partial_workflow({
    id: "<workflow id>",
    intent: "Wire global Error Workflow so silent failures page the team",
    operations: [{type: "updateSettings", settings: {errorWorkflow: "jeDTXA5lBqT6VucW"}}]
  })
  ```
- [ ] **Step 3: Verify**
  `n8n_get_workflow({id: "<workflow id>", mode: "full"})` for each — confirm `settings.errorWorkflow === "jeDTXA5lBqT6VucW"`.
- [ ] **Step 4: Test**
  Temporarily misconfigure a disposable/non-critical node (or use a workflow copy) to force a real error, confirm the alert fires, then revert the misconfiguration.

---

## Track 2 — Cleanup and consolidation

### Task 2.1: Rename the core agent workflow

**Workflows/Nodes:** `GWvEz64JQfI2Nij4` ("My workflow")

- [ ] **Step 1:** `n8n_update_partial_workflow({id: "GWvEz64JQfI2Nij4", operations: [{type: "updateName", name: "Mayara — Núcleo do Agente"}]})`
- [ ] **Step 2: Verify** `n8n_get_workflow({id: "GWvEz64JQfI2Nij4", mode: "minimal"})`. Note: this does not break the Execute Workflow references from Ponte or Teste Controlado v2 — those bind by ID (`__rl.value`), not by name; `cachedResultName` is cosmetic and will just look stale in the n8n UI until next edit.

### Task 2.2: Turn "Mayara - WhatsApp Teste Controlado v2" into a thin shell over the core agent

Today it duplicates the entire agent (its own AI Agent, tools, memory) — meaning every bug found in the core agent (this session found several) has to be fixed twice. Make it call the core workflow instead.

**Workflows/Nodes:** `UUj57cKUtrDXPrZZ`

- [ ] **Step 1: Map the target chain**
  Current: `Webhook → Call Logging1 → Get row(s) → If → [AI Agent chain | HTTP Request2+4 fallback]`.
  Target: `Webhook → Call Logging1 → Get row(s) → If → [Chamar Núcleo da Mayara (Execute Workflow) | HTTP Request2+4 fallback] → HTTP Request1 (send reply)`.
- [ ] **Step 2: Add the Execute Workflow call**
  ```javascript
  n8n_update_partial_workflow({
    id: "UUj57cKUtrDXPrZZ",
    intent: "Replace the duplicated AI Agent chain with a call to the core agent workflow",
    validateOnly: true,
    operations: [
      {type: "addNode", node: {
        name: "Chamar Núcleo da Mayara",
        type: "n8n-nodes-base.executeWorkflow",
        typeVersion: 1.3,
        position: [560, 400],
        onError: "continueRegularOutput",
        parameters: {
          workflowId: {"__rl": true, "value": "GWvEz64JQfI2Nij4", "mode": "list"},
          workflowInputs: {
            mappingMode: "defineBelow",
            value: {
              "sessionId": "={{ $('Webhook').item.json.body.phone }}",
              "chatInput": "={{ $('Webhook').item.json.body.message }}"
            }
          },
          options: {waitForSubWorkflow: true}
        }
      }},
      {type: "rewireConnection", source: "9e501d60-8d16-471d-b2f6-2afaf08c35c3", from: "84c88046-8882-4cba-a008-e6e0b8cb5ed9", to: "Chamar Núcleo da Mayara", branch: "true"},
      {type: "addConnection", source: "Chamar Núcleo da Mayara", target: "249240e1-cde5-410b-b0b7-848623d8c86b"}
    ]
  })
  ```
  (Confirm the actual field names in the incoming `Webhook` body — `phone`/`message` — against a real logged execution before finalizing; this workflow's webhook payload shape may differ from the Gateway's normalized `Entrada` shape.)
- [ ] **Step 3: Remove the now-redundant duplicated nodes**
  `removeNode` for: `AI Agent` (`84c88046-...`), `Anthropic Chat Model` (`38adf8ad-...`), `Simple Memory` (`f9cce432-...`), `Create an event in Google Calendar` (`00955da4-...`), `Verificar Disponibilidade na Agenda` (`0cc61a21-...`), `HTTP Request`/`Buscar Lead por Telefone`/`Atualizar Status do Lead`/`Criar Consulta no CRM` (the four `ai_tool` HTTP tools), `Call 'Logging IA - Mayara (Fail-Open)'2` (`3ff43892-...`), `HTTP Request3` (`7a6e95fd-...`).
- [ ] **Step 4:** `cleanStaleConnections`, then apply for real (drop `validateOnly`).
- [ ] **Step 5: Verify** `n8n_validate_workflow` (expect 0 errors) and `n8n_get_workflow(mode: "structure")` (confirm a single clean chain, no orphans).
- [ ] **Step 6: Test** — trigger this workflow's webhook with a sample payload (or via whatever number is bound to it) and confirm the reply matches what the core agent would produce directly.

### Task 2.3: Archive dead workflows

**Workflows/Nodes (candidates — confirm with user before any delete):**
`MkMlLniEhdFLpl33`, `3bOApI2OCmN3fkcA`, `iF0ijaoQDBLvImcu` (BACKUPs), `0rAHDJdVKvUrzWRS` (superseded by v2), `TIc744QlktegSMhl` + `2fUgwsL6E3FKRTjl` (duplicate inactive Painel de Performance), `qlXLml3lIA7GJGQp` (duplicate TEMP, not yet archived)

- [ ] **Step 1:** `n8n_manage_folders({action: "create", name: "Arquivo"})` (or confirm one already exists).
- [ ] **Step 2:** For each candidate, confirm with the user it's not the authoritative copy, then either `moveToFolder` into "Arquivo" (safe, reversible) or `n8n_delete_workflow` only on explicit confirmation naming that ID.
- [ ] **Step 3: Verify** `n8n_list_workflows` — confirm the active/visible list only shows current, non-duplicate workflows.

### Task 2.4: Drop "(Rascunho)" from the Gateway's name

**Workflows/Nodes:** `FV0PEtEcTFbuoRaO`

- [ ] **Step 1:** Only after Track 1 is fully done and verified with a real signature-checked message: `n8n_update_partial_workflow({id: "FV0PEtEcTFbuoRaO", operations: [{type: "updateName", name: "WhatsApp - Gateway Seguro"}]})`.
- [ ] **Step 2: Verify** `n8n_get_workflow(mode: "minimal")`.

---

## Track 3 — Stack modernization

### Task 3.1: Upgrade n8n

**Workflows/Nodes:** None directly (instance-level); re-validate all production workflows after.

- [ ] **Step 1: Baseline** `n8n_health_check({mode: "diagnostic"})` and `n8n_list_workflows({active: true})` — save the current active list to compare after.
- [ ] **Step 2: User action (Coolify)** — re-check `n8n_audit_instance`'s "Available versions" list at execution time (it drifts), pick the current latest stable, update the n8n Docker image tag, redeploy.
- [ ] **Step 3: Verify version** `n8n_health_check` — confirm the new version string.
- [ ] **Step 4: Verify nothing deactivated** `n8n_list_workflows({active: true})` — diff against the Step 1 baseline; n8n major upgrades occasionally deactivate workflows touching changed node types.
- [ ] **Step 5: Re-validate** `n8n_validate_workflow` on `B1xdt1WotCQE3NOb`, `FV0PEtEcTFbuoRaO`, `GWvEz64JQfI2Nij4`, `UUj57cKUtrDXPrZZ` — confirm no new errors from the version bump.
- [ ] **Step 6: Test end-to-end** with one real WhatsApp message from the test number.

### Task 3.2: Enable the instance-level MCP server

**Workflows/Nodes:** None directly.

- [ ] **Step 1: User action (n8n UI)** — Settings → Instance-level MCP → Enable, generate the access token.
- [ ] **Step 2: User action (n8n-mcp dashboard)** — paste the token into the instance's settings at `dashboard.n8n-mcp.com`.
- [ ] **Step 3: Verify** `n8n_health_check` — confirm `officialMcp.configured: true` and `reachable: true`.
- [ ] **Step 4: Use it going forward** — from here, `n8n_test_workflow` with `method: "direct"`/`"pinned"` can test `Mayara — Núcleo do Agente` without a real WhatsApp message or spending a real Anthropic call cycle through the Gateway — prefer it over the chat-trigger workaround used in the 2026-09-05 session (which proved unreliable for reading back results).

### Task 3.3: Build an evaluation dataset and wire Evaluations

**Workflows/Nodes:** `GWvEz64JQfI2Nij4` (target), new dataset (n8n Evaluations feature, unlocked by Task 3.1's version ≥ 2.30)

- [ ] **Step 1: Write the dataset** — 8-12 representative conversations covering: different debt types (empréstimo, cheque especial, cartão PJ), different urgency levels (penhora/bloqueio vs. informal collection pressure), one objection ("não confio em resolver isso por WhatsApp"), one full scheduling flow, and one out-of-scope legal question that should route to a human.
- [ ] **Step 2: Set up the evaluation** — consult `tools_documentation` or n8n's own current Evaluations UI at execution time (this is a newer, still-evolving n8n surface) and attach the dataset to `Mayara — Núcleo do Agente`.
- [ ] **Step 3: Run it** `n8n_evaluations({action: "run", workflowId: "GWvEz64JQfI2Nij4"})` — review per-case results.
- [ ] **Step 4: Adopt as habit** — re-run the evaluation after every system-prompt edit, before considering a prompt change "shipped."

---

## Track 4 — New agent capabilities

### Task 4.1: Human-in-the-loop review on calendar booking (decide scope with the user first)

This changes the product's automation promise — confirm with the user before implementing.

**Workflows/Nodes:** `GWvEz64JQfI2Nij4`, tool `Create an event in Google Calendar` (id `3fc46ff2-8e6a-4da3-8356-102163613774`)

- [ ] **Step 1: Decide the approval channel with the user** — WhatsApp to the lawyer's own number, Slack, or email; which HITL tool node fits depends on this.
- [ ] **Step 2: Wrap the tool** — insert the chosen HITL node between `Create an event in Google Calendar` and `AI Agent` on the `ai_tool` connection, per the n8n-agents skill's human-review pattern. The approval message must use literal `{{ $tool.parameters.<name> }}` values (date, attendee email, summary) — never a `$fromAI` paraphrase, so the approver sees the real call about to fire.
- [ ] **Step 3: Verify** `n8n_validate_workflow` + `n8n_get_workflow(mode: "structure")` — confirm the HITL node sits between the tool and the agent.
- [ ] **Step 4: Test** with a controlled scheduling conversation — confirm the calendar event is NOT created until the approval is granted, and IS created after approval.

### Task 4.2: Structured lead classification for the dashboards

**Workflows/Nodes:** `GWvEz64JQfI2Nij4` (add a post-response step), new Data Table (e.g. `lead_classification`), consumed by `xQcS5tCVwf7yTOtN` ("Painel - Leads e Agendamentos") and `d4zFZapUwlfFdHbx` ("Painel de Marketing")

- [ ] **Step 1: Create the Data Table**
  `n8n_manage_datatable({action: "createTable", name: "lead_classification", columns: [{name: "sessionKey", type: "string"}, {name: "tipoDivida", type: "string"}, {name: "urgencia", type: "string"}, {name: "banco", type: "string"}, {name: "valorAproximado", type: "string"}]})`
- [ ] **Step 2: Add an Information Extractor node** — reads the conversation content (from `Logging IA - Mayara (Fail-Open)`'s stored history for the session), extracting `tipoDivida`, `urgencia` (baixa/média/alta), `banco`, `valorAproximado`. Wire it after the CRM lead-creation tool call fires, not inside the agent's own tool loop (keeps the agent's tool budget for conversation, not analytics).
- [ ] **Step 3: Write the result** via a Data Table `Insert`/`Upsert` node into `lead_classification`, mapping columns directly (per Data Table gotchas: map fields in the node's own column slots, don't stage with a separate Set node first).
- [ ] **Step 4: Verify** `validate_workflow`, then test with a sample conversation and confirm the row lands correctly via `n8n_manage_datatable({action: "getRows", tableId: "<new id>"})`.
- [ ] **Step 5: Wire dashboards** — update `xQcS5tCVwf7yTOtN` and `d4zFZapUwlfFdHbx` to read from `lead_classification` where relevant (separate, smaller sub-task per dashboard; scope with the user once the classification data exists and looks right).

---

## Suggested order

1. **Track 1** end-to-end (security is the actual blocker for the real number).
2. **Track 2** Task 2.1–2.2 (consolidate before the real number multiplies traffic through the duplicated path); Task 2.3–2.4 can happen anytime.
3. **Track 3** Task 3.1 (upgrade) before Task 3.2/3.3 (both depend on a current-enough n8n version).
4. **Track 4** whenever — both tasks are additive and don't block the real-number launch.
