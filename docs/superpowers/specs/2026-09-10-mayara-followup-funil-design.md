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

Para em qualquer ponto quando: o lead responde de qualquer jeito (mesmo que não seja um "sim"/"não" direto — nesse caso volta pro fluxo normal de qualificação, sem tratamento especial de follow-up), ou a conversa já está em `S7_HANDOFF_HUMANO` (não faz sentido a automação insistir se um humano já assumiu).

## Templates propostos (usuário precisa submeter à Meta para aprovação antes de funcionar)

**Template 1 — check-in leve:**
> "Oi {{1}}! Vi que você não respondeu ainda sobre {{2}}. Ainda faz sentido pra você conversarmos? É só responder aqui."

**Template 2 — pergunta de encerramento:**
> "{{1}}, sem problema se não for mais o momento certo. Só preciso saber: ainda tem interesse em resolver a questão de {{2}}, ou posso encerrar esse atendimento por aqui?"

`{{1}}` = nome do lead (ou "Olá" genérico se ainda não soubermos o nome — caso do "nunca respondeu"). `{{2}}` = resumo curto do assunto (ex: "a dívida com o Bradesco", ou "sua situação com o banco" se ainda não soubermos detalhes).

**Decisão pendente do usuário:** os textos acima são uma proposta minha — a aprovação de conteúdo de template pela Meta pode ser exigente (não pode soar como marketing agressivo em certas categorias). Revisar e ajustar antes de submeter.

## Mudanças de schema necessárias (Supabase)

```sql
alter table mayara.session_state
  add column if not exists last_lead_message_at timestamptz,
  add column if not exists follow_up_status text not null default 'ativo',
    -- ativo | resolvido_continua | resolvido_sem_interesse | pausado_humano
  add column if not exists follow_up_stage text not null default 'nenhum',
    -- nenhum | ia_sumiu_meio | template1 | template2
  add column if not exists follow_up_last_sent_at timestamptz,
  add column if not exists follow_up_tentativas int not null default 0;

create index if not exists idx_session_state_followup
  on mayara.session_state (follow_up_status, last_lead_message_at)
  where follow_up_status = 'ativo';
```

`last_lead_message_at` precisa ser **tocado sempre que uma mensagem do lead chegar**, independente de o AI Agent decidir chamar "Salvar Estado da Conversa" ou não (hoje esse UPDATE só acontece quando o modelo aprende um fato novo — não é confiável pra medir silêncio). Isso exige um UPDATE determinístico logo na entrada do Núcleo (nó `Buscar Estado da Sessao` ou logo depois), não dependente do LLM.

**Suposição a verificar:** este design assume que `session_key` é o número de telefone do lead (ou que o telefone é recuperável a partir dele) — preciso confirmar isso olhando o workflow `Mayara — Ponte WhatsApp` de verdade antes de implementar, não vi essa parte diretamente nesta sessão.

## Arquitetura

Novo workflow n8n, `Mayara — Follow-up de Funil [Worker]`, agendado (Schedule Trigger, de hora em hora, seg-sex 9h-18h — nunca dispara fora do horário comercial mesmo que o prazo já tenha vencido):

```
Schedule Trigger (hourly, seg-sex 9h-18h)
  → Buscar Leads Elegíveis (Postgres: session_state onde follow_up_status='ativo'
       e last_lead_message_at + intervalo-do-estágio < now())
  → Code: Decidir Tipo de Follow-up (por lead: dentro ou fora da janela de 24h,
       qual template/estágio já foi usado)
  → Switch (3 ramos: texto-livre-IA / template1 / template2)
      → [texto-livre-IA] Execute Workflow: Núcleo da Mayara (gera o texto,
           mesmas regras de tom/limite de caracteres do prompt principal)
      → [template1 / template2] HTTP Request: Meta Graph API,
           endpoint de template message (não o de texto livre)
  → Enviar via WhatsApp (Meta Graph API)
  → Update Postgres: follow_up_stage, follow_up_last_sent_at, follow_up_tentativas++
```

Quando o lead responder (qualquer mensagem chegando pela Ponte normal): o Núcleo, ao processar a resposta, precisa resetar `follow_up_status` pra `'ativo'`... não, na verdade deve ser mais específico: uma resposta real deve **sair completamente do fluxo de follow-up** (não é mais "silencioso"). O jeito mais simples: zerar `follow_up_stage` e `follow_up_tentativas` sempre que uma mensagem do lead for processada normalmente pelo Núcleo (ele já vai atualizar `last_lead_message_at`, então o worker de follow-up simplesmente não vai mais achar esse lead como elegível na próxima consulta, sem precisar de lógica extra — os únicos campos que precisam de reset explícito são `follow_up_stage`/`follow_up_tentativas`, pra não pular direto pro template2 se a pessoa sumir de novo depois).

Quando o lead responder "não tenho mais interesse" (ou variante): a Mayara (dentro da conversa normal, não no worker) precisa reconhecer essa resposta como encerramento do funil, marcar `follow_up_status = 'resolvido_sem_interesse'`, e responder de forma educada sem insistir. Isso é uma **mudança no prompt principal** (não no worker), fora do escopo deste workflow novo — precisa de uma seção nova tipo "SE O LEAD DISSER QUE NÃO TEM MAIS INTERESSE" no prompt do Núcleo, com a regra de marcar esse status.

## Fora de escopo (por ora)

- Confirmar acesso/permissão pra criar templates via Graph API diretamente (`POST /{whatsapp-business-account-id}/message_templates`) vs. o usuário criar manualmente pelo WhatsApp Manager — decidir quando for a hora de submeter.
- Dashboard/relatório de quantos leads estão em cada estágio de follow-up (poderia ser um card novo no Painel de Marketing ou Painel de Leads e Agendamentos existente — não desenhado aqui).
- Qualquer follow-up para quem já tem consulta agendada (`S6_AGENDADO`) — esse caso já tem o próprio fluxo de lembrete/confirmação de consulta (feito manualmente hoje pela equipe, visto nas conversas reais revisadas nesta sessão) — não misturar com este funil de reengajamento de qualificação.

## Próximos passos

1. Usuário revisa/ajusta os textos dos templates e os submete pra aprovação da Meta (fora do meu alcance — precisa ser feito pelo WhatsApp Manager da conta).
2. Confirmar a suposição sobre `session_key` = telefone, inspecionando `Mayara — Ponte WhatsApp` de verdade.
3. Enquanto os templates não são aprovados, dá pra implementar e testar só a parte "sumiu no meio" (texto livre, dentro da janela de 24h) — funciona independente da aprovação da Meta.
4. Depois de aprovado: implementar o resto (worker agendado, templates 1/2, reset de estado ao responder).
5. Nova seção no prompt do Núcleo pra reconhecer "não tenho mais interesse" e marcar o status.
