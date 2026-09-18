# Mayara V3 — Motor de Raciocínio do Núcleo (Fase 1)

**Data:** 2026-09-18
**Status:** design aprovado pelo usuário, aguardando plano de implementação
**Workflow afetado:** `Mayara — Núcleo do Agente [DRAFT V2]` (n8n id `KLdDHFsr1gJhnHkF`)
**Prompt fonte da verdade:** `docs/superpowers/specs/2026-09-09-mayara-prompt-revisado.txt`

## Motivação

Os testes feitos pelo usuário direto no CRM (leads sintéticos: Robson, André, Ruan,
Wander, Janaína, Valdo, Cristian, Gilberto, Adriana, Jonison — nenhum é lead real
de produção) mostraram que a Mayara segue um roteiro fixo de qualificação em vez
de reagir à situação específica de cada lead. O sintoma concreto: ela pergunta
itens do roteiro mesmo quando a resposta não mudaria a próxima ação, e às vezes
oferece a consulta antes de entender o suficiente pra dar contexto útil ao
Dr. Santo (caso André: adimplente prevendo atraso — merece entender a causa
econômica antes de agendar). O objetivo desta fase é fazer a Mayara raciocinar
por "o que falta saber pra decidir o próximo passo" em vez de "qual a próxima
pergunta do formulário".

## Decomposição do projeto

O pedido original ("Mayara V3") embutia dois subprojetos independentes:

1. **Motor de raciocínio do Núcleo** (este documento) — como ela qualifica,
   quando para, quando propõe consulta. Roda hoje em produção, dor comprovada.
2. **Motor de follow-up pós-agendamento** (no-show, remarcação, objeção
   comercial, comparação com outros escritórios, nutrição de silêncio) — não
   existe como workflow hoje; só existe o `Mayara — Lembretes de Consulta
   [Worker]`, que lembra de uma consulta já marcada. Precisa de gatilho,
   schema e workflow próprios. **Fica para um spec separado, depois que esta
   fase 1 estiver validada em produção.**

Este documento cobre **só o item 1**.

## Princípio central (substitui o objetivo implícito atual)

> A Mayara não tenta completar um questionário. Ela toma a melhor próxima
> decisão com o que já sabe.

Regra de ouro a incluir literalmente no prompt: **se a resposta a uma pergunta
não mudaria a próxima ação da Mayara, não faça essa pergunta.**

## Estados — sem mudança de vocabulário

Mantém exatamente `S0_NOVO` … `S7_HANDOFF_HUMANO` como estão hoje em
`mayara.session_state.estado`. Não introduz os estados de follow-up
(`NO_SHOW`, `RESCHEDULING`, `COMMERCIAL_OBJECTION`, `COMPARING_PROVIDERS`,
`NURTURE`, etc.) — esses pertencem à fase 2. Sem isso, zero risco de quebrar
Painel Executivo, dashboards ou histórico já persistido.

## Novos campos em `fatosJson`

Mínimo necessário para o motor de lacunas funcionar (YAGNI — não adiciona
campo que não tenha um uso concreto identificado nos casos reais):

| Campo | Tipo | Uso |
|---|---|---|
| `causaEconomica` | texto curto | por que a dívida/atraso aconteceu ou vai acontecer (ex: "queda de faturamento", "perda de cliente grande", "doença na família") |
| `tentativaRenegociacao` | true/false | se o lead já tentou negociar com o banco |
| `outrosContratosOuDividas` | true/false | se há mais operações/bancos além do já mencionado |
| `notificacaoOrigem` | banco / judicial / desconhecida | só relevante quando o lead menciona "notificação" sem deixar claro a natureza (caso Wander) |

Chaves já existentes (`tipoDivida`, `bancos`, `valorAproximado`, `documento`,
`situacaoJudicial`, `urgencia`, `nomeCompleto`, `nomeEmpresa`, `telefone`,
`email`, `clienteAtual`) não mudam.

## Motor de lacunas — node de código determinístico

Novo node `Calcular Lacunas` (n8n Code node), inserido entre
`Buscar Estado da Sessao` e `Montar Contexto` no workflow do Núcleo. Mesmo
padrão já validado nesta sessão para a correção da alucinação de datas:
**código calcula o que é fato, o LLM só lê — nunca é o LLM que precisa
lembrar ou contar sozinho o que já sabe.**

Entrada: `fatosJson` (já carregado por `Buscar Estado da Sessao`).
Saída: um bloco de texto injetado no prompt via `Montar Contexto`, formato:

```
FATOS JÁ CONHECIDOS: tipo=Capital de Giro; banco=Sicredi; valor=~300mil; documento=CNPJ
LACUNA PRIORITÁRIA EM ABERTO: situação judicial vs. cobrança informal
OUTRAS LACUNAS (só considerar se a prioritária já foi resolvida): causa econômica; tentativa de renegociação
NUNCA PERGUNTE O QUE JÁ ESTÁ EM "FATOS JÁ CONHECIDOS"
```

Prioridade fixa em código (não decidida pelo LLM):
1. `situacaoJudicial` / `urgencia` (indefinidos) — sempre primeiro, porque é o
   que decide STOP QUALIFICATION.
2. `notificacaoOrigem` — só se o lead mencionou "notificação" e o campo ainda
   está vazio.
3. `causaEconomica`
4. `outrosContratosOuDividas`
5. `tentativaRenegociacao`

Campos que já têm valor no `fatosJson` somem da lista de lacunas
automaticamente. Chaves fora dessa lista fixa (qualquer coisa que o LLM grave
por conta própria) continuam sendo persistidas normalmente, só não entram no
cálculo de lacuna — evita que uma chave inesperada quebre o node.

## Reescrita do prompt (dentro da mesma chamada única de LLM)

Sem separar "decidir" de "escrever" em duas chamadas (ver seção Abordagens
Consideradas) — tudo continua numa única chamada do `AI Agent`, igual hoje.
Mudanças de conteúdo no prompt:

- **Substituir o ROTEIRO DE QUALIFICAÇÃO fixo** por: pergunte pela lacuna
  prioritária que o bloco `Calcular Lacunas` apontou, só se ela realmente for
  mudar a próxima ação — deixa de ser checklist obrigatório em ordem fixa.
- **Regra FATO ≠ INFERÊNCIA**, explícita: "recebi notificação" não vira
  "existe processo judicial"; "sumiu" não vira "perdeu interesse". Só grava
  como fato o que a pessoa disse literalmente (isso já existe parcialmente na
  seção atual de "Salvar Estado da Conversa" — vou reforçar com exemplos).
- **STOP QUALIFICATION reforçado**: ao detectar patrimônio/judicial concreto,
  para imediatamente qualquer pergunta comercial (faturamento, renegociação,
  outros contratos) e vai direto para reconhecimento breve + encaminhamento.
- **"Não agende cedo demais"**: em casos não urgentes, produto+banco+atraso
  sozinhos não bastam pra propor consulta. Pergunta interna antes de propor:
  "o Dr. Santo vai entender, a partir do que já foi dito, por que esse
  empresário procurou ajuda agora?" Se não, uma pergunta de alto valor antes
  de oferecer a consulta. **Precedência explícita**: isso só se aplica
  quando STOP QUALIFICATION não disparou. Se STOP QUALIFICATION disparar,
  ele sempre vence — vai direto para reconhecimento breve + encaminhamento,
  sem aplicar o gate de "contexto suficiente".
- **Extração de respostas ricas**: tornar explícito (já implícito hoje) que
  uma mensagem longa do lead pode preencher várias lacunas de uma vez.
- **Persuasão via compreensão, não pressão**: reforça o que já existe em
  EMPATIA SEM TEATRALIDADE — demonstrar que entendeu certo pesa mais que
  insistir.

## O que NÃO muda

PROIBIÇÕES ABSOLUTAS (segurança jurídica), ESTILO DE ESCRITA (limite de
caracteres, sem repetir fatos, sem dois-pontos etc.), fluxo de AGENDAMENTO e
a ferramenta `Agendar Consulta`, `Persistir Consulta no CRM`, `Marcar Sem
Interesse` — nada disso é tocado. Só as regras de quando perguntar o quê e
quando parar de qualificar.

## Abordagens consideradas (para registro)

- **A — só prompt, uma chamada de LLM:** escolhida.
- **B — duas chamadas de LLM (planejar → escrever):** rejeitada por ora.
  Dobra custo e latência por mensagem de WhatsApp, e adiciona uma camada nova
  de integração no n8n. Nesta sessão, toda vez que adicionamos uma camada
  "esperta" a mais no fluxo (ex: a primeira tentativa de corrigir o CRM
  vazio) ela quebrou de um jeito novo, e a correção que funcionou de verdade
  foi a mais simples. Fica como evolução futura só se A+C não bastarem na
  prática.
- **C — A + cálculo determinístico das lacunas:** escolhida, combinada com A
  (é o node `Calcular Lacunas` descrito acima).

## Plano de teste

**Cenários novos (fase 1)** — 13 dos 20 cenários originalmente propostos pelo
usuário (os 7 restantes são de follow-up, fase 2):
1. Capital de giro + banco único + atraso.
2. Capital de giro + vários produtos/bancos.
3. Adimplente prevendo atraso por queda de faturamento (baseado no caso André).
4. Notificação ambígua, banco vs. judicial (baseado no caso Wander).
5. Execução judicial confirmada.
6. Bloqueio de conta + apreensão + aceite de consulta (baseado no caso Jonison).
7. Imóvel em garantia + leilão (baseado no caso Robson).
8. Doença familiar como causa do atraso (empatia sem virar formulário).
9. Cliente que já passou por outro advogado.
10. Lead aceita consulta no meio da qualificação (pula pra S5 imediatamente).
11. Resposta longa preenchendo 5+ campos de uma vez.
12. Informação já conhecida no CRM sendo mencionada de novo (não repete pergunta).
13. Lead fornece dia e horário exatos espontaneamente.

**Transcripts reais como base** (o usuário vai exportar do WhatsApp quando
possível, não bloqueia o design): André, Robson, Wander, Jonison — usar a
conversa real, não só a descrição, pra calibrar os cenários 3, 4, 6 e 7
acima com mais fidelidade.

**Regressão obrigatória**: re-rodar a bateria de 30 cenários já existente
(`docs/superpowers/plans/2026-09-06-mayara-v2-testes-pendentes.md`) pra
garantir que nenhum bug já corrigido volte (alucinação de data, S6_AGENDADO
prematuro, CRM persistindo vazio, nome errado no CRM).

## Implantação e rollback

Implementar num clone de teste do workflow do Núcleo (mesmo padrão usado na
transição V1→V2): validar com o número de testes antes de qualquer troca em
produção. A Ponte só aponta pro V3 depois de bateria + regressão passarem e,
idealmente, mais uma rodada de monitoramento em tempo real como a que já foi
feita para o V2. O V2 atual continua disponível como rollback imediato
(trocar `workflowId` de volta na `Chamar Mayara`) se algo passar despercebido.

## Riscos conhecidos

- O node `Calcular Lacunas` depende da lista fixa de campos ficar sincronizada
  com o que o prompt pede pra gravar — se um campo novo for adicionado só no
  prompt e não no código (ou vice-versa), a lacuna correspondente nunca
  aparece ou aparece errado. Mitigação: manter os dois lado a lado neste
  mesmo commit sempre que um for alterado.
- Reforçar tanto o "não agende cedo demais" quanto o STOP QUALIFICATION ao
  mesmo tempo pode, na prática, fazer a Mayara hesitar demais em casos
  ambíguos (perguntar uma lacuna a mais do que o necessário). A bateria de
  13 cenários acima existe justamente pra pegar isso antes de produção.

## Fora de escopo agora / pendências futuras

- **Motor de follow-up pós-agendamento** (fase 2, spec próprio): estados
  NO_SHOW, REMARCAÇÃO, OBJEÇÃO_FINANCEIRA, COMPARANDO_ADVOGADOS, NURTURE,
  FOLLOWUP_NO_RESPONSE. Baseado nos casos Janaína, Valdo, Ruan, Cristian,
  Gilberto, Adriana.
- **Ritmo de entrega mais humano**: dividir respostas longas em 2 balões de
  WhatsApp com pequena pausa entre eles, em vez de uma mensagem única
  instantânea. Mudança na `Mayara — Ponte WhatsApp`, não no prompt do
  Núcleo — fora do escopo desta fase.
- **Mensagens de áudio**: verificar se a Ponte já transcreve áudio recebido
  do lead; se não, é um buraco real de humanização a resolver depois.
