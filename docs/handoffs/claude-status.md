# Handoff Claude: status

Atualizado em 2026-10-14. Projeto: Mayara / Central de Comando (Supabase, n8n, EspoCRM). Sem credenciais nem dados pessoais de clientes neste arquivo.

## Etapa: Central em linguagem livre, Fase 3, e retenção das respostas automáticas

### Objetivo
1. Permitir que o administrador escreva em português comum na Central (consultar, agir com confirmação, ensinar), atrás da chave `central_linguagem_livre`.
2. Impedir que a Mayara responda leads sozinha enquanto o escritório respondeu manualmente pelo celular (o histórico da Mayara não registra mensagens enviadas à mão).

### Arquivos alterados ou criados
- `supabase/migrations/0047_mayara_central_livre.sql`, `supabase/tests/0047_central_livre.test.sql`: `executar_livre`, `_lead_do_pedido`, ramo `livre` no `executar_central`, chave `livre` no `contexto_central`.
- `supabase/migrations/0048_mayara_respostas_retidas.sql`, `supabase/tests/0048_respostas_retidas.test.sql`: chave `respostas_retidas`, `respostas_retidas()`, ajuste de `resposta_permitida_para` e `reservar_eventos_adiados`.
- `docs/superpowers/specs/2026-10-12-central-linguagem-livre/`: `interpretar.mjs` (e testes), `frases.mjs`, `gerar-interpretar-node.mjs`, `gerar-workflows.mjs`, `gerar-central-patch.mjs`, `testar-modelo-real.mjs`, arquivos `.node.js` gerados, `central-livre-patch.json`.
- `docs/superpowers/specs/workflows/mayara-central-interpretar-livre.json` (novo) e `mayara-central-de-comando.json` (reexportação do estado vivo).
- `docs/superpowers/plans/2026-10-12-...-fase2-interpretar.md` e `2026-10-13-...-fase3-workflows.md`; `docs/superpowers/specs/2026-10-08-central-linguagem-livre-design.md` (Fase 2 concluída).

### Alterações em produção (fora do repositório)
- Supabase: migrations 0047 e 0048 aplicadas. Configuração: `respostas_retidas=true`, `followup_modo=desligado`, `central_linguagem_livre=false`. Quatro follow-ups que estavam `reservado` foram marcados `cancelado` (motivo `retencao_manual_13_10`).
- n8n: criado e publicado o sub-workflow `Central: Interpretar Livre` (sem webhook nem gatilho público). Workflow `Central de Comando` atualizado (29 para 38 nós: desvio do ramo livre atrás da chave e tratamento do marcador `@efeito` de pausar/ligar).

### Testes executados e resultado
- `node --test` nas pastas `2026-10-12-central-linguagem-livre` e `2026-10-03-central-comando`: 71 testes, 0 falhas.
- SQL em transação com rollback: `OK 0047` e `OK 0048`.
- Conferência das ligações do workflow vivo por GET (REST).
- Frases de aceitação contra o modelo real: NÃO executadas (sem `ANTHROPIC_API_KEY` no ambiente). O script `testar-modelo-real.mjs` está pronto.
- Não testado pelo WhatsApp: canal fechado.

### Pendências
1. Canal `escritorio` está `close` desde 13/10 06:18; aguardando reconexão (QR) pelo usuário.
2. Após reconectar: ler o contexto dos leads atendidos à mão, registrar no contexto da Mayara e só então desligar `respostas_retidas` e religar `followup_modo`.
3. Ligar `central_linguagem_livre` e rodar o roteiro de 9 mensagens pelo WhatsApp (ou o script com chave exportada no terminal do usuário).
4. Fase 4 (abordar um lead) e plano do `/abordar`: não executados.

### Riscos
- Com a retenção ligada, nenhum lead recebe resposta automática; mensagens ficam em `mayara.eventos_adiados`. Esquecer de desligar a chave deixa o atendimento parado.
- Follow-ups desligados: leads em régua não recebem contato até religar.
- O prompt da interpretação ainda não foi validado contra o modelo real; ações de efeito continuam exigindo "sim", o que limita o dano de uma interpretação errada.
- O sub-workflow precisa permanecer publicado, senão a Central publicada recusa o ramo.
- n8n-mcp é instável ("Connection closed" pode ter aplicado a mudança): sempre reler por GET antes de repetir.
