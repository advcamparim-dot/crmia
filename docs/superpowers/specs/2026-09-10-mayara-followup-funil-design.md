# Mayara — Follow-up de Funil (Design)

**Data:** 2026-09-10
**Sub-projeto novo**, fora do escopo do spec de contexto de atendimento (`2026-09-09-mayara-contexto-atendimento-design.md`) — esse cobre o que a Mayara sabe/como raciocina dentro de uma conversa ativa; este cobre o que acontece quando a conversa **para** de acontecer.

## Contexto

Hoje não existe nenhum mecanismo de reengajamento automático. Confirmado por inspeção de todos os 36 workflows do n8n — o único candidato próximo (`WhatsApp — Retenção Operacional 30 dias`) é uma limpeza de dados (apaga mensagens/locks antigos), não uma mensagem de follow-up. Um lead que para de responder, em qualquer estágio, hoje simplesmente fica parado até alguém da equipe notar manualmente.

## Objetivo

Reengajar automaticamente dois tipos de lead silencioso:
1. **Nunca respondeu** — recebeu o primeiro contato (card de lead → primeira mensagem da Mayara) e nunca respondeu nada.
2. **Sumiu no meio** — respondeu pelo menos uma vez, avançou na conversa, mas parou de responder antes de concluir (agendar consulta, dizer "não tenho interesse", ou ser encaminhado pra humano).

Continuar tentando **até o lead responder explicitamente** que quer continuar ou que não tem mais interesse — não há um número fixo de tentativas (decisão do usuário). A cadência usa backoff crescente pra não parecer spam.

## Restrição técnica da Meta (não é escolha de design, é limite da plataforma)

WhatsApp Cloud API só permite **texto livre** dentro da janela de 24h desde a última mensagem *do cliente*. Fora dessa janela, toda mensagem iniciada pelo negócio precisa ser um **template pré-aprovado pela Meta** (pode ter variáveis, mas a estrutura da frase é fixa e revisada previamente). Isso não é negociável — é como a Cloud API funciona.

Consequência direta pro design: só o primeiro follow-up ("sumiu no meio", dentro de 24h) pode ser texto livre gerado pela Mayara. Todo o resto (que por definição já está fora da janela, já que o lead não respondeu) precisa ser um dos templates aprovados abaixo.

## Cadência

| Gatilho | Quando dispara | Tipo de mensagem |
|---|---|---|
| Sumiu no meio | 4h sem resposta do lead, dentro de 24h desde a última mensagem dele | Texto livre da Mayara (contextual) |
| 1º follow-up fora da janela | 24h sem resposta desde a última mensagem do lead (cobre também "nunca respondeu") | Template 1 |
| 2º follow-up | +3 dias sem resposta desde o follow-up anterior | Template 2 |
| Follow-ups seguintes | A cada +7 dias sem resposta | Template 2 (repetido) |

Para em qualquer ponto quando: o lead responde **qualquer coisa, por mínima que seja** (mesmo um emoji ou "kkk" já tira o lead do funil de follow-up e devolve pro fluxo normal de qualificação — não precisa ser um "sim"/"não" direto), ou a conversa já está em `S7_HANDOFF_HUMANO` (não faz sentido a automação insistir se um humano já assumiu).

**Exclusão de segurança (além de S7):** leads em `S3_PRIORIDADE_JURIDICA`, ou com qualquer fato registrado indicando situação patrimonial sensível (penhora, bloqueio, oficial de justiça, recuperação judicial/falência — ver STOP QUALIFICATION e MOVIMENTAÇÃO PATRIMONIAL no prompt principal), **nunca entram no follow-up automático**, mesmo que fiquem silenciosos. Mandar "ainda tem interesse?" pra alguém em execução judicial é tonalmente errado e pode passar a impressão errada sobre a seriedade do caso. Esses casos ficam de fora da consulta de elegibilidade e só reengajam por contato humano manual.

**Reavaliação da janela em tempo de execução, não de agendamento:** o worker roda de hora em hora, mas só em horário comercial — um silêncio que completa 4h numa sexta às 19h só vai ser avaliado na segunda de manhã. Nesse momento, a janela de 24h já pode ter fechado, então a decisão "texto livre ou template" precisa ser recalculada a cada execução com base no tempo real decorrido, nunca assumida a partir de quando o prazo teoricamente venceria.

## Templates propostos (usuário precisa submeter à Meta para aprovação antes de funcionar)

**Template 1 — check-in leve:**
> "Oi {{1}}! Vi que você não respondeu ainda sobre {{2}}. Ainda faz sentido pra você conversarmos? É só responder aqui."

**Template 2 — pergunta de encerramento:**
> "{{1}}, sem problema se não for mais o momento certo. Só preciso saber: ainda tem interesse em resolver a questão de {{2}}, ou posso encerrar esse atendimento por aqui?"

`{{1}}` = nome do lead. `{{2}}` = resumo curto do assunto. Na prática, mesmo no caso "nunca respondeu" isso geralmente já está disponível — o card de lead colado no início da conversa já traz nome e tipo de dívida na maioria dos casos (ver formato do card em USANDO DADOS JÁ CONHECIDOS no prompt principal); o fallback genérico ("Olá" / "sua situação com o banco") só é necessário no raro caso de um lead sem card, direto pelo link do WhatsApp.

**Categoria do template:** submeter como **Utility**, não Marketing — é uma mensagem de continuidade de um atendimento já iniciado pelo próprio lead (que clicou no link/preencheu o formulário), não uma oferta promocional nova. Isso tende a ter aprovação mais rápida e menos restrição de conteúdo do que a categoria Marketing.

**Decisão pendente do usuário:** os textos acima são uma proposta minha — a aprovação de conteúdo de template pela Meta pode ser exigente (não pode soar como marketing agressivo em certas categorias). Revisar e ajustar antes de submeter.

## Mudanças de schema necessárias (Supabase)

```sql
alter table mayara.session_state
  add column if not exists last_lead_message_at timestamptz,
  add column if not exists follow_up_status text not null default 'ativo',
    -- ativo | resolvido_continua | resolvido_sem_interesse | pausado_humano | excluido_seguranca
  add column if not exists follow_up_stage text not null default 'nenhum',
    -- nenhum | ia_sumiu_meio | template1 | template2
  add column if not exists follow_up_last_sent_at timestamptz,
  add column if not exists follow_up_tentativas int not null default 0;

create index if not exists idx_session_state_followup
  on mayara.session_state (follow_up_status, last_lead_message_at)
  where follow_up_status = 'ativo';
```

`follow_up_status = 'excluido_seguranca'` é setado pelo próprio Núcleo (não pelo worker) assim que detectar prioridade jurídica ou situação patrimonial sensível — junto com a transição pra `S3_PRIORIDADE_JURIDICA`/handoff, no mesmo ponto do código que já muda o estágio. Assim a exclusão de segurança nunca depende do worker "adivinhar" a partir de `fatos_json`.

**Concorrência:** o worker roda de hora em hora e pode demorar mais que isso pra processar todos os leads elegíveis, ou duas execuções podem se sobrepor num restart. Pra nunca mandar a mesma mensagem duas vezes, a consulta que busca leads elegíveis precisa "reservar" a linha atomicamente antes de enviar — um `UPDATE ... SET follow_up_stage = 'enviando' WHERE follow_up_status='ativo' AND <condição de tempo> RETURNING *` (ou equivalente), nunca um `SELECT` seguido de um `UPDATE` separado, que teria uma janela de corrida entre ler e escrever.

`last_lead_message_at` precisa ser **tocado sempre que uma mensagem do lead chegar**, independente de o AI Agent decidir chamar "Salvar Estado da Conversa" ou não (hoje esse UPDATE só acontece quando o modelo aprende um fato novo — não é confiável pra medir silêncio). Isso exige um UPDATE determinístico logo na entrada do Núcleo (nó `Buscar Estado da Sessao` ou logo depois), não dependente do LLM.

**Confirmado (era suposição, agora verificado):** `session_key` **não é** o telefone puro — é uma chave composta gerada no Gateway (`WhatsApp - Gateway Seguro`, node `Normalizar e Filtrar Evento`): `whatsapp:{phoneNumberId}:{telefone}`. Telefone e phoneNumberId (necessário pra montar a URL da Graph API) são extraídos daí. Implementado: novo node `Registrar Ultima Mensagem do Lead` (Postgres) no Núcleo, conectado em **paralelo** a `Montar Contexto` (não em série — inserir em série quebrou a "Simple Memory", que depende do `$json.sessionId` original chegando intacto no `AI Agent`; ver achado abaixo). Faz um `INSERT ... ON CONFLICT (session_key) DO UPDATE` que grava `phone`, `phone_number_id`, `last_lead_message_at`, e zera `follow_up_stage`/`follow_up_tentativas` a cada mensagem do lead — sem nunca sobrescrever `estado`/`fatos_json`, que continuam sendo escritos só pelo `AI Agent` via "Salvar Estado da Conversa". Testado: telefone/phoneNumberId parseados corretamente de um `sessionId` no formato real, e um `sessionId` de teste sem esse formato (harness) grava `phone`/`phone_number_id` como `null` sem quebrar nada.

**Achado de arquitetura durante a implementação:** um node Postgres com `operation: executeQuery` **substitui o `$json` inteiro do item** pelo resultado da query, em vez de preservar os campos de entrada. Conectá-lo em série entre `Montar Contexto` e `AI Agent` apagou o `sessionId` que a "Simple Memory" precisa, quebrando a conversa inteira ("Error in sub-node Simple Memory: No session ID found") — encontrado e corrigido ao vivo, durante os testes manuais do usuário no draft. Corrigido conectando o node como **ramo paralelo** a partir de `Montar Contexto` (n8n executa os dois ramos, o resultado do node de banco é descartado, o `AI Agent` recebe o `$json` original intacto pelo outro ramo). Vale revisar esse mesmo padrão antes de inserir qualquer novo node Postgres/execução de query no meio da cadeia principal do Núcleo.

## Arquitetura

Novo workflow n8n, `Mayara — Follow-up de Funil [Worker]`, agendado (Schedule Trigger, de hora em hora, seg-sex 9h-18h — nunca dispara fora do horário comercial mesmo que o prazo já tenha vencido):

```
Schedule Trigger (hourly, seg-sex 9h-18h)
  → Buscar e Reservar Leads Elegíveis (Postgres, UPDATE...RETURNING atômico:
       follow_up_status='ativo' — nunca S3_PRIORIDADE_JURIDICA/excluido_seguranca,
       nunca S6_AGENDADO/S7_HANDOFF_HUMANO —
       e last_lead_message_at + intervalo-do-estágio < now())
  → Code: Decidir Tipo de Follow-up (por lead: dentro ou fora da janela de 24h,
       recalculado agora, não no momento em que o prazo venceu;
       qual template/estágio já foi usado)
  → Switch (3 ramos: texto-livre-IA / template1 / template2)
      → [texto-livre-IA] Execute Workflow: Núcleo da Mayara (gera o texto,
           mesmas regras de tom/limite de caracteres do prompt principal)
      → [template1 / template2] HTTP Request: Meta Graph API,
           endpoint de template message (não o de texto livre)
  → Enviar via WhatsApp (Meta Graph API)
  → Update Postgres: follow_up_stage, follow_up_last_sent_at, follow_up_tentativas++
```

Quando o lead responder (qualquer mensagem chegando pela Ponte normal): o Núcleo, ao processar a resposta, atualiza `last_lead_message_at` — sozinho isso já tira o lead da consulta de elegibilidade do worker, sem precisar de lógica extra. O único reset explícito necessário é `follow_up_stage` e `follow_up_tentativas` voltarem a `'nenhum'`/`0`, pra não pular direto pro template2 se a pessoa sumir de novo depois.

Quando o lead responder "não tenho mais interesse" (ou variante): a Mayara (dentro da conversa normal, não no worker) precisa reconhecer essa resposta como encerramento do funil, marcar `follow_up_status = 'resolvido_sem_interesse'`, e responder de forma educada sem insistir. Isso é uma **mudança no prompt principal** (não no worker), fora do escopo deste workflow novo — precisa de uma seção nova tipo "SE O LEAD DISSER QUE NÃO TEM MAIS INTERESSE" no prompt do Núcleo, com a regra de marcar esse status.

**Sugestão minha, não decidida ainda — dormência após tentativas prolongadas sem resposta nenhuma (nem ao template):** você pediu sem número fixo de tentativas, e mantive isso — o backoff de 7 em 7 dias já é bem menos invasivo que insistir toda hora. Mas tecnicamente "pra sempre" significa reenviar template todo mês pra leads de anos atrás que nunca vão responder, consumindo cota de template da Meta sem necessidade. Proponho, como higiene operacional (não como desistência do lead): depois de ~90 dias sem NENHUMA resposta a NENHUM template, marcar `follow_up_status = 'dormente'` — para de mandar mensagem automaticamente, mas o lead continua podendo responder a qualquer momento (mesmo anos depois) e reativa o atendimento normalmente, exatamente como os outros estados. Isso não é "desistir" do lead — é só parar de gastar template nele até ele voltar a dar sinal. Se preferir manter literalmente infinito, é só não implementar este ponto.

## Fora de escopo (por ora)

- Confirmar acesso/permissão pra criar templates via Graph API diretamente (`POST /{whatsapp-business-account-id}/message_templates`) vs. o usuário criar manualmente pelo WhatsApp Manager — decidir quando for a hora de submeter.
- Dashboard/relatório de quantos leads estão em cada estágio de follow-up (poderia ser um card novo no Painel de Marketing ou Painel de Leads e Agendamentos existente — não desenhado aqui).
- Qualquer follow-up para quem já tem consulta agendada (`S6_AGENDADO`) — esse caso já tem o próprio fluxo de lembrete/confirmação de consulta (feito manualmente hoje pela equipe, visto nas conversas reais revisadas nesta sessão) — não misturar com este funil de reengajamento de qualificação.

## Implementado — "sumiu no meio" (2026-09-10)

Workflow novo `Mayara — Follow-up Sumiu no Meio [Worker]` (id `CxlC28G0S3uE8X66`, ativo). Schedule Trigger de hora em hora + IF de horário comercial (seg-sex, 9h-18h horário de Brasília) → reserva atômica no Postgres (CTE com `for update skip locked`, exclui `S6_AGENDADO`/`S7_HANDOFF_HUMANO`/`S3_PRIORIDADE_JURIDICA`, janela 4h-24h desde `last_lead_message_at`, limite de 20 por execução) → gera o texto via chamada HTTP direta à API da Anthropic (não via node LangChain — mais simples e não depende do Agent/tools) → envia via Graph API. Inclui um segundo trigger (Webhook, path `test-followup-sumiu-meio`) só pra testes manuais, sem esperar o agendamento horário.

**Testado de ponta a ponta, com envio real confirmado.** Primeira rodada (token expirado): reserva atômica funcionou, texto gerado ficou natural e dentro do limite de caracteres, `follow_up_stage`/`follow_up_tentativas` atualizados corretamente — só o envio falhou (401, token expirado). Usuário renovou o token; segunda rodada, com o número de teste autorizado (`+5514997022609`) e o `phone_number_id` real do negócio (`1365007506685934`, extraído de uma execução real do Gateway): **mensagem real enviada e confirmada pela Meta** (`wamid` retornado). Pipeline completo, do banco até a entrega real, funcionando.

**Não implementado ainda:** Template 1/2 (depende da aprovação da Meta), e a lógica de dormência aos 90 dias (ainda pendente de decisão do usuário).

## Implementado — "não tenho mais interesse" (2026-09-10)

Nova ferramenta `Marcar Sem Interesse` (Postgres tool) no Núcleo — sem parâmetros, só executa `update mayara.session_state set follow_up_status = 'resolvido_sem_interesse' where session_key = ...`. Nova seção no prompt, "SE O LEAD DISSER QUE NÃO TEM MAIS INTERESSE", instruindo a chamar essa ferramenta silenciosamente e responder breve, sem insistir, sem perguntar o motivo.

**Testado de ponta a ponta:** conversa qualificando normalmente, depois "na verdade não tenho mais interesse, pode parar de mandar mensagem" → resposta "Sem problema, obrigada pelo contato! Se mudar de ideia, é só chamar." + confirmado no banco: `follow_up_status = 'resolvido_sem_interesse'`. Esse lead agora fica permanentemente fora da consulta de elegibilidade do worker de follow-up (a query já filtra `follow_up_status = 'ativo'`).

**Limitação aceita conscientemente:** o worker marca `follow_up_stage`/`follow_up_tentativas` **antes** de confirmar que o envio realmente funcionou — se o envio falhar (como no teste, por token expirado), o lead não é re-tentado nesse mesmo estágio. Isso é intencional (evita reenvio duplicado se o envio na verdade funcionou mas a resposta demorou), mas significa que uma falha real de envio faz esse lead pular direto pra "sem retorno" do ponto de vista do funil, sem re-tentativa da mensagem de texto livre — ele ainda vai receber o Template 1 no ciclo seguinte (24h), então não fica travado, só perde a etapa de texto livre naquele caso específico.

## Revisão de código (2026-09-10) — achados e correções

Rodei `superpowers:requesting-code-review` contra o intervalo de commits desta fase. Achados reais, na ordem em que foram corrigidos:

### 🔴 Confirmado em produção: `fatos_json` virava `[object Object]` no texto gerado

O revisor suspeitou que `content: '...' + $json.fatos_json` (concatenação de string com um objeto JS, já que o node Postgres retorna `jsonb` como objeto parseado, não string) produziria `"[object Object]"` em vez dos fatos reais. **Confirmado revisitando a própria execução do teste anterior**: os fatos de teste eram "cartão PJ, Bradesco, 80 mil", mas o texto gerado falou em **"questão trabalhista"** — o modelo recebeu fatos vazios/inúteis e inventou um assunto do zero. Isso já tinha acontecido na mensagem real que confirmei como "sucesso" antes — eu só validei que o *envio* funcionou, não que o *conteúdo* estava certo. **Corrigido:** `JSON.stringify($json.fatos_json)` em vez de concatenação direta.

### 🔴 Achado operacional: o schedule automático já estava rodando sozinho

Ao investigar, descobri que o worker (ativo desde antes desta revisão) já tinha disparado 6 vezes sozinho via schedule horário. **Verifiquei todas as 6 execuções**: todas pegaram só linhas de teste minhas (nenhum lead real tinha uma janela de silêncio de 4-24h nesse intervalo de ~3h desde a criação do worker). Mas o risco era real — se alguém real tivesse ficado em silêncio nessa janela, teria recebido uma mensagem com assunto inventado. **Ação:** desativei o worker imediatamente ao suspeitar do bug, corrigi, e só reativei depois.

### 🟡 Redundância de segurança que a spec pedia mas não foi implementada

A spec original queria que o Núcleo marcasse `follow_up_status = 'excluido_seguranca'` no momento em que detecta prioridade jurídica — isso nunca foi implementado, e o worker ficou dependendo só do campo `estado`. Se o LLM registra um fato sensível (`situacaoJudicial: execução`) num turno mas só transiciona `estado` pra `S3_PRIORIDADE_JURIDICA` no turno seguinte, existe uma janela onde um lead sensível ainda seria elegível. **Corrigido com uma camada redundante mais simples**, sem exigir mudança no Núcleo: a própria query de reserva do worker agora também exclui qualquer lead cujo `fatos_json->>'situacaoJudicial'` indique execução/recuperação judicial/falência, independente do `estado`.

### 🟡 Webhook de teste exposto sem autenticação em produção

O path `test-followup-sumiu-meio` estava ativo, sem segredo, e qualquer um que descobrisse a URL podia forçar um envio real fora do agendamento. **Corrigido:** adicionado um node de checagem de segredo (header `x-test-secret`) antes de prosseguir — testado: bloqueia sem o header certo, passa com ele. O segredo real fica só no n8n; o arquivo exportado pro git tem o valor redigido.

### 🟡 Falhas silenciosas no meio do pipeline

Três problemas relacionados: (1) se a reserva no banco falhasse, os nodes seguintes rodariam com dados indefinidos mesmo assim; (2) se a geração de texto falhasse, o envio prosseguiria com uma mensagem vazia; (3) o `onError: continueRegularOutput` no envio da Graph API tornava uma falha de envio completamente invisível (o lead já tinha sido marcado como "tentado", sem ninguém saber que a mensagem nunca chegou). **Corrigido:** dois nodes de validação novos (`Reserva Valida?`, `Texto Valido?`) que interrompem o fluxo se os dados essenciais estiverem ausentes, e removido o `onError` silencioso do node de envio — uma falha real de envio agora aparece como falha de execução de verdade, visível na lista de execuções do n8n.

### Achados aceitos como limitação, não corrigidos agora

- **Concorrência do `FOR UPDATE SKIP LOCKED` não foi testada de verdade** (precisaria de duas execuções simultâneas de propósito) — o padrão SQL é o idiomático correto, mas a alegação de "testado de ponta a ponta" da rodada anterior superestimava isso. Registrando aqui pra não repetir a mesma alegação forte sem essa cobertura específica.
- **Sem caminho de "voltar a ativo"** se um lead marcado `resolvido_sem_interesse` reengajar meses depois e sumir de novo — decisão de produto pendente, não decidida ainda.
- **Duplicação de regras de tom/segurança** entre o prompt principal e o prompt inline do worker — aceito por ora, ambos cobrem o essencial (sem opinião jurídica, sem promessa, limite de caracteres), mas não se atualizam automaticamente juntos.

### Verificação pendente

A correção do `JSON.stringify` foi confirmada por leitura direta do código (é uma mudança determinística e simples), mas **não foi reverificada com uma execução real** ainda — no momento da correção estava fora do horário comercial (21h32, o `Horario Comercial?` corretamente bloqueou o teste). Rodar de novo o teste com o segredo assim que possível, e conferir que o texto gerado menciona os fatos reais (banco, valor) em vez de inventar um assunto.

## Próximos passos (atualizado após a revisão de código)

Já feito, não repetir: fundação de dados, worker "sumiu no meio" (com o bug de serialização corrigido), reconhecimento de "não tenho mais interesse", exclusão de segurança (via `estado` + camada redundante de `situacaoJudicial` na query), autenticação do webhook de teste, validações contra falha silenciosa.

O que falta de verdade:
1. **Reverificar com execução real** que o texto gerado agora usa os fatos certos (pendente — ver seção de revisão acima).
2. Usuário decide sobre a proposta de dormência aos 90 dias — aceitar, ajustar o prazo, ou recusar e manter infinito.
3. Usuário revisa/ajusta os textos dos templates e os submete pra aprovação da Meta como categoria Utility.
4. Depois de aprovado: implementar Template 1/2 no worker.
5. Decidir se um lead `resolvido_sem_interesse` pode voltar a `ativo` reengajando espontaneamente (achado da revisão, sem decisão ainda).
