# Auditoria dos campos do EspoCRM para os painéis

Data: 2026-10-08
Fonte: metadados `entityDefs.<Entidade>.fields` lidos pela API do CRM (somente leitura).
Relacionados: `2026-10-08-paineis-ceo-administrador-design.md`, plano da Fase 1.

## Resumo

- Os metadados são acessíveis pela API (a integração do n8n consegue ler).
- As entidades financeiras e jurídicas **existem com campos coerentes**, mas estão **vazias** (0 registros).
- **A sincronização espelha só parte dos campos.** Faltam campos que os painéis vão precisar (listados em "Não sincronizado").

## Lead (58 campos; 10 personalizados)

Personalizados: `cLegalArea`, `cUrgencyLevel`, `cLeadScore`, `cChannel` (WhatsApp, Google Ads, Meta Ads, Indicação, Site, Outro), `cProblemSummary`, `cNextAction`, `cNextActionAt`, `cFirstResponseAt`, `cLostReason` (Não Respondeu, Sem Interesse, Valor de Honorários, Fechou com Concorrente, Fora do Escopo, Outro), `cWonAt`.

- **Próxima ação e prazo já existem** (`cNextAction`, `cNextActionAt`), assim como `cFirstResponseAt` (tempo até a primeira resposta) e `cLostReason` (motivo de perda).
- **Campo de campanha em texto não existe.** Há o vínculo padrão `campaign` (liga à entidade Campanha, que tem 0 registros). Decisão do plano: criar o campo de texto `cCampanha` no Lead.
- Valor do passivo: o campo padrão `opportunityAmount` existe, mas hoje o passivo vem como faixa em texto na descrição do cartão.

## CContrato (26 campos)

`name`, `amount` (moeda), `status` (Enviado, Assinado, Cancelado, Pendente), `signedAt`, `closedAt`, `paymentStatus` (Pendente, Parcial, Pago, Atrasado), `channel`, `legalArea`, `source`, `contractUrl`, `numeroParcelas`, `diaVencimentoPrimeiraParcela`, vínculos `lead`, `client`, `campaign`, `responsibleUser`, `proposal`.

- `amount` é **o único campo de valor**. Assumimos que representa **honorários contratados**. **A confirmar com o usuário.**
- **Não há como separar honorário fixo de honorário de êxito no contrato.** O êxito aparece na proposta (`successFeePercentage`) e no caso (`estimatedSuccessFee`).

## CProposta (20 campos)

`name`, `amount`, `paymentTerms`, `successFeePercentage`, `status` (Rascunho, Enviada, Aceita, Recusada, Ven…), `sentAt`, `acceptedAt`, `rejectedAt`, `rejectionReason` (Preço, Concorrente, Sem interesse, …), vínculos `lead`, `responsibleUser`.

## CPagamento (21 campos)

`name`, `amount`, `dueDate`, `paidAt`, `installmentNumber`, `totalInstallments`, `paymentReference`, `receiptUrl`, `status` (Pendente, Pago, Atrasado, Cancelado), `paymentMethod`, vínculos `client`, `contract`.

## CCasoJuridico (26 campos)

`name`, `title`, `caseNumber`, `court`, `currentPhase`, `legalArea`, `claimValue` (valor da causa, **não é receita**), `estimatedSuccessFee`, `probabilityOfSuccess` (campo preenchido por pessoa, não é calculado), `riskLevel`, `status` (Ativo, Suspenso, Encerrado…), `nextDeadlineAt`, `lastMovementAt`, vínculos `client`, `responsibleLawyer`.

## Meeting (28 campos; 1 personalizado)

`status` (Planned, Held, Not Held), `dateStart`, `dateEnd`, `acceptanceStatus`, `cNoShow`, `parent` (liga ao lead), `assignedUser`.

## Task (31 campos; 7 personalizados)

`status` (Not Started, Started, Completed, Canceled, Deferred), `dateStart`, `dateEnd`, `assignedUser`, `parent`, e os campos de alerta: `cAlertOrigin` (Comercial, Jurídico, Financeiro, IA, WhatsApp), `cAlertSeverity` (Baixa, Média, Alta, Crítica), `cAlertKey`, `cAlertRule`, `cDetectedAt`, `cSourceEntityType`, `cSourceRecordId`.

## Não sincronizado hoje (lacunas para as próximas fases)

| Entidade | Campos que a sincronização ignora | Para que serviriam |
|---|---|---|
| Lead | `cNextAction`, `cNextActionAt`, `cFirstResponseAt`, `cProblemSummary`, responsável | Central de Atenção (lead sem próxima ação, tempo até a primeira resposta), produtividade |
| Lead | `cCampanha` (a criar) | Funil e desempenho por campanha |
| CContrato | `client`, `numeroParcelas`, `diaVencimentoPrimeiraParcela`, `campaign` | Previsão de recebimentos, atribuição |
| CCasoJuridico | `estimatedSuccessFee`, `probabilityOfSuccess`, `title` | Êxito previsto (sempre separado), carteira |
| Task | **a entidade inteira não é sincronizada** | Tarefas vencidas, alertas de agendamento, falhas |

## Lacunas de cadastro (decisões do usuário)

1. Confirmar que `CContrato.amount` = honorários contratados (e não valor da dívida).
2. Honorário fixo x êxito no contrato: criar um campo para o êxito (ou usar a proposta) antes de os painéis financeiros mostrarem êxito.
3. Passivo do cliente: decidir se passa a ser campo numérico no Lead (`opportunityAmount`) em vez de faixa em texto.
4. Quem preenche, quando, os registros de reunião, proposta, contrato, pagamento e caso (hoje todos vazios).
