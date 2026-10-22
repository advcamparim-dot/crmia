# Painel Camparim, Etapa 3B (Contratos e parcelas): Plano de Execução

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Registrar contratos e parcelas por frase livre no WhatsApp de administrador (com resumo, conferência da soma e gravação só no "sim"), mostrar contratos fechados, receita contratada e receita recebida no painel, controlar o status das parcelas ("Marcar como paga" / "Desfazer"), levar a parcela atrasada para a fila "Precisa de você" e marcar o lead como Convertido no CRM.

**Architecture:** O interpretador da Central (formulário fechado preenchido pelo modelo, validado em código) ganha a ação `registrar_contrato`. Um módulo puro `contrato.mjs` (testado) resolve dinheiro (centavos inteiros), datas e vencimentos; o SQL (`executar_livre`) revalida a soma e o lead, cria a ação pendente com o resumo e, no "sim", chama `painel.contrato_registrar`. Contratos e parcelas vivem no Supabase (schema `painel`); o painel lê por funções e escreve só por duas funções (marcar e desfazer pagamento) que gravam auditoria. O sincronizador do funil do CRM e os eventos do painel passam a enxergar o contrato.

**Tech Stack:** Supabase Postgres, n8n (Central), Node (`contrato.mjs`), Next.js 14, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-18-painel-camparim-design.md` (seções "Contratos por frase livre", "Parcelas" e "Escrita pelo painel"); base: `docs/superpowers/specs/2026-10-08-central-linguagem-livre-design.md` e `docs/superpowers/plans/2026-10-22-painel-camparim-etapa3a.md`.

## Global Constraints

- Nenhum contrato é gravado sem o "sim" do administrador. Nenhuma ação tem efeito antes disso. A IA só preenche o formulário; **dinheiro, datas e soma são calculados e conferidos em código e no banco**, nunca pelo modelo.
- A soma da entrada com as parcelas tem que bater com o valor total, em centavos. Se não bate: nada é gravado, a Central informa a diferença e pede a frase corrigida.
- O comando fica atrás da chave `contrato_comando` (padrão `desligado`) e só liga depois da prova com o modelo real. Não alterar o comportamento da Mayara com leads, a régua, a reativação, a abordagem automática nem o sincronizador do funil (exceto acrescentar o contrato como sinal de "Converted").
- Escritas do painel: exatamente `marcar pagamento` e `desfazer pagamento` (a de metas é a 3C); ambas exigem sessão, validam a entrada e gravam auditoria (`painel.parcelas_log`).
- Funções com `set search_path = ''`, sem `execute` para `public/anon/authenticated`, `execute` para `painel_leitura`. Migrations a partir de `0076`; testes SQL em transação desfeita terminando em `select 'OK NNNN'`, com dados sintéticos (`+5511999986xxx`).
- Fuso `America/Sao_Paulo` em "hoje" e vencimentos. Dinheiro em `numeric(12,2)`; no código, em centavos inteiros.
- Sem nomes, telefones nem valores reais de clientes em arquivos versionados; commits terminam com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Definições (decisões minhas, para o Dr. Santo conferir)

- **Formulário novo:** `acao: "registrar_contrato"`, `alvo: {nome, telefone}` e `contrato: {total, entrada: {valor, paga_em}, parcelas: {quantidade, valor, primeiro_vencimento, dia}}`. Valores em reais (número), datas como o administrador falou (`dd/mm`, `dd/mm/aaaa` ou ISO). Tudo opcional no formulário; o código rejeita o que faltar.
- **Datas:** `paga_em` sem ano = ano corrente (e nunca no futuro; se cair no futuro, o código recua um ano ou recusa). `primeiro_vencimento` sem ano = próxima ocorrência a partir de hoje. As demais parcelas vencem todo mês no `dia` informado (padrão: o dia do primeiro vencimento); dia 29 a 31 vai para o último dia do mês quando ele não existe. A data de assinatura é a de hoje.
- **Entrada:** com `paga_em` nasce **paga** nessa data; sem `paga_em`, nasce a receber com vencimento em `entrada.vence_em` se dito, ou hoje.
- **Lead:** resolvido por nome ou telefone com `mayara._lead_do_pedido`. Zero ou vários candidatos: a Central lista (nome e final do telefone) e pede o telefone. Se o telefone não pertence a nenhum lead, o resumo diz "cliente fora da lista de leads" e o "sim" cria o contrato assim mesmo, ligado só ao telefone.
- **Status da parcela (automático):** paga (tem `pago_em`), atrasada (`vencimento < hoje` e sem `pago_em`), a receber (demais). Parcela que vence hoje **não** está atrasada.
- **Limites de sanidade:** total até R$ 5.000.000; no máximo 120 parcelas; valores positivos; vencimentos até 10 anos à frente.
- **Receita contratada** = soma dos totais dos contratos assinados no período; **recebida** = soma das parcelas pagas com `pago_em` no período (inclui a entrada paga).
- **Cancelamento/edição de contrato:** fora desta entrega (corrige-se por SQL pelo construtor se necessário). Não se registra valor pago diferente do combinado.

## Review Focus

1. **Soma que não bate:** o exemplo do Dr. Santo (R$ 5.000 de entrada + 12 × R$ 1.600 = R$ 24.200 contra R$ 24.000) nunca grava e informa a diferença de R$ 200.
2. **Dinheiro e centavos:** `24 mil`, `1.600,50`, `R$ 1600`, `1600 reais`; soma em centavos, sem erro de ponto flutuante (12 × 1.600,10).
3. **Calendário:** dia 31 em mês curto, fevereiro, virada de ano (parcelas de 20/11/2026 a 20/10/2027), primeiro vencimento hoje, e parcela que vence hoje não é atrasada.
4. **Lead e duplicidade:** nome com vários candidatos, nome sem candidato, e a mesma frase confirmada duas vezes (idempotência por lead, total e dia).
5. **Pagamento:** marcar paga com data futura é recusado; desfazer devolve ao automático; marcar duas vezes não duplica; auditoria sempre gravada.

## File Structure

- Create: `supabase/migrations/0076_painel_contratos.sql`, `0077_central_contrato.sql`, `0078_painel_contratos_leitura.sql`, `0079_contrato_funil_crm.sql` e os testes `supabase/tests/0076_*..0079_*.test.sql`
- Create: `docs/superpowers/specs/2026-10-22-contratos-whatsapp/contrato.mjs` (+ `.test.mjs`), `frases.mjs` (+ teste), `gerar-patch.mjs` (+ teste), nó Code gerado
- Modify: workflow vivo da Central (livre) e `Central: Interpretar Livre` e seus exports em `docs/superpowers/specs/workflows/`
- Modify (painel): `lib/widgets.ts`, `lib/layout.ts`, `lib/painel-dados.ts`, `app/painel/page.tsx`; Create: `app/painel/widgets/Kpi*` reaproveitado, `ParcelasLista.tsx`, `app/painel/actions.ts` (+ ações de pagamento), testes

---

### Task 1: Contratos, parcelas e pagamento (0076)

**Interfaces:** Produces `painel.contratos(id, lead_chave, lead_nome, crm_lead_id, valor_total numeric(12,2), assinado_em date, criado_em, origem text)`, `painel.parcelas(id, contrato_id, numero int, valor numeric(12,2), vencimento date, pago_em date)` (`numero = 0` é a entrada), `painel.parcelas_log(id, parcela_id, acao, de_pago_em, para_pago_em, quem, quando)`; `painel.contrato_registrar(p_telefone text, p_nome text, p_crm_lead_id text, p_total numeric, p_assinado_em date, p_parcelas jsonb, p_origem text) returns bigint` (valida soma, limites e idempotência; `p_parcelas` = `[{numero, valor, vencimento, pago_em}]`); `painel.parcela_marcar_paga(p_id bigint, p_data date, p_quem text) returns void`; `painel.parcela_desfazer(p_id bigint, p_quem text) returns void`; `painel.parcela_status(p_pago_em date, p_vencimento date, p_hoje date default hoje_sp) returns text` (`paga|atrasada|a_receber`).

- [ ] **Step 1: Teste SQL** (`0076_painel_contratos.test.sql`): registra o exemplo corrigido (total 24.200: entrada 5.000 paga em 20/10 mais 12 × 1.600 de 20/11/2026 a 20/10/2027); recusa soma diferente em 1 centavo; recusa total ≤ 0, parcela ≤ 0, mais de 120 parcelas e vencimento a mais de 10 anos; idempotente (mesma frase em 10 min devolve o mesmo id); `parcela_status` para pago, atrasada, a receber e vencendo hoje; `marcar_paga` com data futura recusa; marcar e desfazer gravam `parcelas_log`; marcar duas vezes não duplica; privilégios (`anon` sem `execute`). Rodar: Expected erro.
- [ ] **Step 2: Migration**, aplicar, `OK 0076`.
- [ ] **Step 3: Commit** `feat(painel): contratos, parcelas e pagamento (migration 0076)`.

### Task 2: Biblioteca `contrato.mjs` (dinheiro, datas, vencimentos, resumo)

**Interfaces:** Produces `parseReais(valor: number|string): number|null` (centavos inteiros), `resolverData(texto: string, hoje: Date, modo: 'passada'|'futura'): string|null` (ISO), `montarContrato(form, hoje): { ok: true; contrato: { total_centavos; parcelas: {numero; valor_centavos; vencimento; pago_em|null}[]; assinado_em } } | { ok: false; motivo; diferenca_centavos?; mensagem }`, `resumoContrato(contrato, rotuloLead): string` (texto da confirmação em português com valores em R$ e datas dd/mm/aaaa), `vencimentos(primeiro: string, dia: number, quantidade: number): string[]`.

- [ ] **Step 1: Escrever `contrato.test.mjs`:** `parseReais aceita "24 mil", 24000, "1.600,50", "R$ 1600" e rejeita lixo`; `vencimentos de 20/11/2026 x12 vai até 20/10/2027`; `dia 31 vai para o último dia do mês`; `fevereiro 2028 tem 29`; `o exemplo do Dr. Santo devolve soma 24.200 e diferença de 20.000 centavos`; `contrato com soma exata monta entrada paga e 12 parcelas`; `entrada sem data nasce a receber`; `paga_em no futuro é recusada`; `total acima do limite é recusado`; `12 × 1.600,10 soma em centavos sem erro`; `resumoContrato mostra total, entrada, parcelas, primeiro e último vencimento`. Rodar: FAIL.
- [ ] **Step 2: Implementar** `contrato.mjs` (puro, sem dependências, `Date` injetado). Rodar: PASS. **Commit.**

### Task 3: Ação `registrar_contrato` na Central (banco, 0077)

**Interfaces:** Consumes Task 1 e `mayara._lead_do_pedido`. Produces `acoes_pendentes.acao` aceitando `registrar_contrato`; `criar_acao_pendente` aceita `registrar_contrato` com `p_argumentos = {telefone, nome, crm_lead_id, total, parcelas[], fora_da_lista}`; `confirmar_acao_pendente` executa `painel.contrato_registrar` e responde "Contrato registrado: ..."; `executar_livre` ganha o ramo `registrar_contrato` (valida soma e formato, resolve o lead, devolve a lista de candidatos quando ambíguo, ou cria a ação pendente com o resumo). Config `contrato_comando` (padrão `desligado`; desligado devolve "Essa ação ainda não está habilitada.").

- [ ] **Step 1: Teste SQL** (`0077_central_contrato.test.sql`): chave desligada recusa; ligada com soma errada não cria pendência e informa a diferença; lead ambíguo lista candidatos sem pendência; lead inexistente com telefone cria pendência marcada "fora da lista"; "sim" grava contrato e parcelas e responde o resumo; "não" cancela sem gravar; expiração em 10 minutos; segunda ação bloqueada enquanto há pendente; "sim" repetido não duplica. Rodar: erro.
- [ ] **Step 2: Migration** (alterar a constraint, as três funções), aplicar, `OK 0077`. Regressão: rodar os testes SQL da Central existentes (`0030` a `0032`) e confirmar verdes. **Commit.**

### Task 4: Interpretador e workflow vivo da Central

**Interfaces:** Consumes Tasks 2 e 3 e o padrão de `docs/superpowers/specs/2026-10-12-central-linguagem-livre/`. Produces `interpretar.mjs` aceitando `registrar_contrato` (formulário fechado estendido), prompt do modelo com o formulário novo, 6 a 8 frases de aceitação de contrato (inclui o exemplo do Dr. Santo e frases perigosas: "contrato de 1 milhão para todos os leads", valor sem lead, soma errada) e o patch ao vivo do sub-workflow `Central: Interpretar Livre` (`5rSebg3RppYg1FVI`) com export.

- [ ] **Step 1: Testes** (`interpretar.test.mjs`, `frases.mjs`): `registrar_contrato` válido vira pedido `livre_registrar_contrato` com `contrato` resolvido por `montarContrato`; campos extras, total negativo, sem alvo, parcelas faltando e texto longo são recusados; as frases perigosas nunca viram ação. Rodar: FAIL.
- [ ] **Step 2: Implementar**, regenerar o Code node (padrão `gerar-interpretar-node.mjs`), rodar os testes do módulo. **Commit.**
- [ ] **Step 3: Aplicar ao vivo** (GET, patch gerado e testado, PUT, GET para conferir, exportar). Provar com workflow temporário e **modelo real**: a frase do exemplo e as frases perigosas, com lead de teste sintético; `contrato_comando` ainda `desligado` neste passo (o teste só confere a interpretação). Apagar o workflow temporário.

### Task 5: Leitura para o painel e fila (0078)

**Interfaces:** Produces `painel.contratos_numeros(p_de timestamptz, p_ate timestamptz) returns table(fechados int, receita_contratada numeric, receita_recebida numeric, a_receber numeric, atrasado numeric)`; `painel.parcelas_abertas(p_limite int default 30) returns table(id, contrato_id, lead_nome, telefone_fim, numero, valor, vencimento, status, dias_atraso)` (só não pagas, atrasadas primeiro); `painel.fila_atencao()` ganha o tipo `parcela_atrasada` (urgência 5, `detalhe` com valor e dias de atraso, some quando paga).

- [ ] **Step 1: Teste SQL** (`0078_painel_contratos_leitura.test.sql`): soma por período (assinatura vs pagamento), fronteira `>= de` e `< ate`, entrada paga conta como recebida, atrasada x a receber, `parcelas_abertas` ordenada, `fila_atencao` com e sem parcela atrasada (some ao marcar paga), nenhuma coluna de texto de conversa. Rodar: erro.
- [ ] **Step 2: Migration**, aplicar, `OK 0078`; regressão `0068`. **Commit.**

### Task 6: Quadros e ações de pagamento no painel

**Interfaces:** Consumes Task 5. Produces widgets `kpi-contratos` (contratos fechados), `kpi-receita-contratada`, `kpi-receita-recebida`, `parcelas` (lista com menu "Marcar como paga" e "Desfazer") em `CATALOGO`/`ARRANJO_PADRAO`; seções `contratos: Carregado<ContratosNumeros>` e `parcelas: Carregado<ParcelaAberta[]>` em `carregarPainel`; ações de servidor `marcarParcelaPaga(id: number, data: string): Promise<{ok: boolean}>` e `desfazerParcelaPaga(id: number): Promise<{ok: boolean}>` (exigem sessão, validam id inteiro e data `aaaa-mm-dd` não futura).

- [ ] **Step 1: Testes** (`painel-dados.test.ts`, `page.test.ts`, `actions.test.ts`): quadros mostram valores formatados em R$; falha vira "indisponível"; ações recusam sem sessão, id inválido e data futura; não há texto de conversa. Rodar: FAIL.
- [ ] **Step 2: Implementar**; `vitest`, `tsc`, `next build`. **Commit.**

### Task 7: Contrato vira "Convertido" no CRM e evento do funil (0079)

**Interfaces:** Produces `mayara.crm_status_pendentes` contemplando "tem contrato → `Converted`" (só avança, uma vez por lead) e `painel.eventos_atualizar` registrando `contrato_fechado` (data de assinatura) a partir de `painel.contratos`.

- [ ] **Step 1: Teste SQL** (`0079_contrato_funil_crm.test.sql`): lead com contrato e CRM em `Consulta Realizada` vira `Converted`; lead `Dead` com contrato não é tocado; evento `contrato_fechado` criado uma vez; `funil_periodo` mostra a etapa Contrato; regressão `0073`, `0074`, `0075`. Rodar: erro.
- [ ] **Step 2: Migration**, aplicar, verdes. **Commit.**

### Task 8: Prova ponta a ponta, publicação e registro

- [ ] **Step 1:** ligar `contrato_comando` só depois do teste com o modelo real; roteiro pelo WhatsApp do administrador **com um lead de teste combinado com o Dr. Santo** (ou sintético): a frase do exemplo → resumo com diferença de R$ 200 e nada gravado; a frase corrigida → resumo → "não"; de novo → "sim" → contrato, entrada paga e 12 parcelas com vencimentos 20/11/2026 a 20/10/2027 (critério 5 do design).
- [ ] **Step 2:** parcela vencida de teste aparece "atrasada" e na fila; "Marcar como paga" muda; "Desfazer" volta (critério 6); totais batem com as tabelas (critério 7).
- [ ] **Step 3:** publicar o painel (GitHub, deploy automático do Coolify), conferir `/api/saude`; limpar os dados de teste combinados; registrar neste plano e no handoff.

## Self-review

- **Cobertura do design (Etapa 3, contratos e parcelas):** comando livre com resumo e soma (Tasks 2 a 4), tabelas e status das parcelas (1), menu "Marcar como paga" e "Desfazer" (6), receita contratada e recebida e contratos fechados (5 e 6), parcela atrasada na fila (5), escrita restrita com auditoria (1 e 6), aceite 5 a 7 (8). Metas ficam na 3C.
- **Consistência de nomes:** `contrato_registrar`, `parcela_marcar_paga`, `parcela_desfazer`, `parcela_status`, `contratos_numeros`, `parcelas_abertas`, `registrar_contrato`, `contrato_comando`, `montarContrato`, `resumoContrato`, `marcarParcelaPaga` e `desfazerParcelaPaga` aparecem iguais em todas as tasks.
- **Riscos declarados:** o modelo pode errar a leitura de valores e datas (mitigado: resumo completo mostra tudo, soma conferida em código e no banco, e nada grava sem "sim"); a mudança em `executar_livre`, `criar_acao_pendente` e `confirmar_acao_pendente` afeta as ações atuais da Central (mitigado por regressão dos testes `0030` a `0032` e pela chave desligada); contrato não tem edição nem cancelamento nesta entrega.
- **Decisões minhas a conferir:** entrada sem data nasce a receber; cliente fora da lista cria o contrato só com o telefone; total máximo de R$ 5 milhões e 120 parcelas; fim de mês cai no último dia do mês; sem edição de contrato.

## Registro de execução

