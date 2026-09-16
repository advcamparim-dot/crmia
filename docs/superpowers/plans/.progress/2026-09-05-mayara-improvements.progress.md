# Progress ledger — plan: docs/superpowers/plans/2026-09-05-mayara-improvements.md

Execution mode: inline (this session), no git/worktree — live n8n instance, no isolation possible.
Adaptation ruling: subagent-driven-development's git/worktree mechanics don't apply (no git repo, shared production instance, several steps require the human's own hands on Coolify/Meta/n8n UI). Executing directly in-session instead, per user confirmation. — Cost if wrong: none, this is a process choice, not a system change.

## Track 1 — Security

- Task 1.1: complete — user set META_APP_SECRET in Coolify and restarted n8n.
  Ruling: verified via a disposable [TEST] webhook+Code workflow, deleted after use — found Code nodes on this instance throw "access to env vars denied" ($env blocked). This invalidated Task 1.3's original Code+$env design. — Cost if wrong: none, this was a real verified finding, not a guess.
  Ruling: switched Task 1.3 to the native Crypto node (action: hmac) + a real `crypto`-type n8n Credential (field `hmacSecret`), since Code has no credentials slot either (`get_node` confirms `"credentials": []`). Plan file updated in place. — Cost if wrong: none if the Crypto node's HMAC output matches Meta's spec (sha256=<hex digest>), which is standard; would surface immediately in Task 1.3 Step 6/7 tests.
- Task 1.2: complete — rawBody enabled on "Meta - Receber Eventos" (FV0PEtEcTFbuoRaO). Verified empirically via disposable [TEST] workflow (deleted after use): rawBody:true keeps $json.body parsed as before (no breakage) AND exposes raw bytes at $binary.data — Crypto node's native binaryData option reads it directly, no Code node needed.
- Task 1.3: complete — added "Calcular HMAC Meta" (Crypto, action hmac, reads $binary.data) + "Assinatura Válida?" (IF) between Meta - Receber Eventos and Normalizar e Filtrar Evento; false branch routes to existing "Ignorar Evento com Seguranca". Credential "Meta App Secret" (crypto type, id 6xadXa83zqtBoDSA) created via n8n_manage_credentials after the "New Credential" picker in the n8n UI didn't surface the crypto type — user provided the secret directly for API-based credential creation (goes into n8n's encrypted vault, not a node parameter).
  Ruling: n8n refuses to save an ACTIVE workflow with a node missing a required credential (auto-rollback observed) — credential must exist before the node references it. — Cost if wrong: none, this is just an ordering constraint we now know.
  Verified: negative test (forged signature) → rejected, routed to Ignorar Evento com Seguranca, never reached Normalizar e Filtrar Evento (execution 7597). Positive test (real WhatsApp message) → signature matched, event accepted, Ponte WhatsApp ran normally (execution 7604).
  validate_workflow: 0 errors, 0 warnings.
- Task 1.4: complete — re-audited (credentials + hardcoded_secrets). Triaged all 14 PII findings: calendar-email hits are the firm's own operational account (not third-party PII); credit_card hits on Teste Controlado v2 are false positives (phone_number_id 1365007506685934 matching a 16-digit regex); the Gateway's hardcoded test phone is a deliberate, temporary allow-list.
  Ruling: deferred the Gateway phone allow-list to the real-number connection work instead of moving it to a Data Table now — it will be edited again imminently for that, and restructuring the Gateway's Code-node input twice risks re-introducing a fan-out bug like the one fixed 2026-09-05 (Data Table "get" nodes return one item per row). — Cost if wrong: none security-wise (unchanged from before); worst case is doing the Data Table move once instead of twice.
- Task 1.5: complete — created "Alertas — Erros de Workflow (Mayara)" (id CQyjBKLX0UheNh1q: Error Trigger → WhatsApp send to +5514997022609 via existing Bearer Auth credential). Wired settings.errorWorkflow on all 5 production workflows (Ponte, Gateway, My workflow, Teste Controlado v2, Logging Fail-Open) — verified via n8n_get_workflow(mode:"full") on Ponte.
  First forced-error test (disposable [TEST] workflow, deleted after use) found the Bearer Auth token expired again in <24h (temporary token, not permanent) — WhatsApp send failed 401/code 190. Flagged to user, who regenerated the token as a permanent one.
  Re-tested after token swap (second disposable [TEST] workflow, deleted after use): Error Trigger fired, WhatsApp alert sent successfully (real wamid returned). Track 1 (Security) is now fully complete.
  Residual, accepted risk: WhatsApp remains the only alert channel — if WhatsApp auth breaks again, this alert path goes silent too. Not fixed (would need a second channel, e.g. email); noted as a known trade-off, not a bug.

## Track 1 status: COMPLETE (Tasks 1.1–1.5)

## Track 2 — Cleanup

- Task 2.1: complete — renamed GWvEz64JQfI2Nij4 from "My workflow" to "Mayara — Núcleo do Agente". Done while user was actively testing through it via WhatsApp (Ponte references by ID, not name — no functional impact, confirmed safe to do concurrently).
- Task 2.2: complete — Teste Controlado v2 reduced from 18 to 7 nodes: Webhook → Get row(s) → If (kill-switch check) → [true: Chamar Núcleo da Mayara (Execute Workflow → GWvEz64JQfI2Nij4) → HTTP Request1] [false: HTTP Request2 + HTTP Request4]. Removed AI Agent, Anthropic Chat Model, Simple Memory, both Google Calendar tools, 4 CRM/lead HTTP tools, both local logging calls (redundant — the core workflow logs both sides internally), and the dormant disabled HTTP Request3.
  Finding (noted, not fixed): this workflow's "Get row(s)" → "If" is the ONLY place in the whole system that actually checks the "Mayara Control" pause/resume switch — the production path (Gateway → Ponte → Núcleo) does not check it at all. Pausing Mayara via the executive panel would not stop real WhatsApp traffic today. Flagged to user as a gap worth fixing (likely as its own small task: add the same Get row(s)+If gate into the Gateway or Ponte), not fixed in this pass — out of Track 2's scope as written.
  Verified: validate_workflow 0 errors; live test via webhook (synthetic sessionKey, real phone) — core agent responded correctly, WhatsApp send succeeded (real wamid).
- Task 2.3: complete (provisional archive) — n8n_manage_folders returned NOT_FOUND: this instance (2.10.2) predates n8n 2.19's Folders feature. Ruling: used a "[ARQUIVADO]" name prefix instead (all 7 candidates were already inactive) as a reversible stand-in until Task 3.1's upgrade unlocks real folders — user confirmed this approach. Archived: MkMlLniEhdFLpl33, 3bOApI2OCmN3fkcA, iF0ijaoQDBLvImcu, TIc744QlktegSMhl, 2fUgwsL6E3FKRTjl, qlXLml3lIA7GJGQp, and 0rAHDJdVKvUrzWRS (this last one had a pre-existing disconnected node from before this session — added a connection to it, per n8n-mcp's own suggested fix, so the archive-rename could save; purely cosmetic since the workflow is inactive and superseded).
  Follow-up once Track 3.1 lands: revisit and move these into a real "Arquivo" folder.
- Task 2.4: complete — renamed FV0PEtEcTFbuoRaO from "WhatsApp - Gateway Seguro (Rascunho)" to "WhatsApp - Gateway Seguro", now that Track 1's signature verification is live and tested.

## Track 2 follow-up (user-requested, not in original plan)

- Kill-switch gap fix: added "Verificar Status da Mayara" (Get row(s), Mayara Control) + "Mayara Ativa?" (IF) to the production Ponte (B1xdt1WotCQE3NOb), between "Obter Lock de Sessão" and "Chamar Mayara". False branch → new "Enviar Pausa via Graph API" (fixed pause-notice message) → existing "Transferência Humana" → existing "Liberar Lock de Sessão", reusing the existing human-handoff nodes rather than duplicating bookkeeping.
  Known minor gap (not fixed): when paused, the message's row in "WhatsApp Mensagens Processadas" stays at status "recebido" (never marked resolved) — low stakes, the CRM Task is the actionable trail humans actually use.
  Verified live: validate_workflow 0 errors. Temporarily set Mayara Control to "paused" (user consented), sent a real WhatsApp test message — AI was never invoked (Chamar Mayara did not execute), pause notice delivered via WhatsApp (real wamid), CRM handoff task created. Reactivated immediately after ("aiMode": "active" confirmed via getRows).

## Track 2 status: COMPLETE (Tasks 2.1–2.4 + kill-switch follow-up)

## Track 3 — Modernization

- Task 3.1: not started (needs user action: Coolify n8n upgrade)
- Task 3.2: not started (needs user action: n8n UI + n8n-mcp dashboard)
- Task 3.3: not started

## Track 4 — New capabilities

- Task 4.1: not started (needs a scope decision with user first)
- Task 4.2: not started
