# Régua de follow-up da Mayara e expediente de atendimento

Data: 2026-10-10
Status: rascunho para revisão do usuário
Relacionados: `2026-09-10-mayara-followup-funil-design.md` (desenho antigo, para a API da Meta; substituído por este), `2026-10-09-abordagem-assistida-design.md`, `2026-09-15-mayara-lembretes-consulta.md`

## Objetivo

1. **Régua de follow-up automática**: a Mayara retoma, sozinha e no tempo certo, os leads que pararam de responder, com mensagens geradas a partir do contexto da conversa.
2. **Expediente de atendimento**: domingos e feriados nacionais a Mayara não responde lead nem faz follow-up; o atendimento começa ou continua no primeiro dia útil seguinte. No sábado, o atendimento vai até as 18h.

Sucesso:
- Nenhuma mensagem de follow-up sai fora da janela de envio, nem sem a conferência do estado do lead imediatamente antes do envio.
- Qualquer resposta do lead cancela tudo o que estava pendente.
- Nenhum lead recebe mais que o **teto** de follow-ups (padrão 14). Ao atingir, a régua para e você é avisado.
- Mensagem de lead recebida em dia fechado não se perde: é guardada e respondida na abertura seguinte.

## Decisões do usuário (10/10/2026)

- Opção **(a)**: régua completa com **teto configurável por lead**, padrão 14 mensagens; ao atingir o teto o lead vira `revisao_humana` e o administrador é avisado.
- Automática, **inclusive para as conversas que já estão em andamento** (os leads atuais que não responderam).
- Mensagem **gerada pela Mayara com o contexto da conversa**, com validação por código e texto fixo de reserva.
- Sábado: atendimento até as 18h. Domingo e feriados nacionais: nada de resposta nem follow-up; retoma no primeiro dia útil.

## Expediente

Horário de Brasília. Tabela editável `mayara.expediente` (um registro por dia da semana) e tabela `mayara.feriados_nacionais` (data, nome).

| Dia | Resposta ao lead | Follow-up |
|---|---|---|
| Segunda a sexta | 06:00 às 21:00 | 08:00 às 19:00 |
| Sábado | 06:00 às 18:00 | 08:00 às 18:00 |
| Domingo | fechado | fechado |
| Feriado nacional | fechado | fechado |

Feriados nacionais carregados para 2026 a 2030: 1º de janeiro, Sexta-feira Santa, 21 de abril, 1º de maio, 7 de setembro, 12 de outubro, 2 de novembro, 15 de novembro, 20 de novembro e 25 de dezembro. Carnaval e Corpus Christi são ponto facultativo e ficam de fora; feriados estaduais e municipais podem ser acrescentados na tabela.

**Decisão do usuário (10/10):** dias úteis, resposta das 6h às 21h. Fora dessa janela (noite, madrugada, sábado depois das 18h, domingo e feriados) a mensagem do lead é guardada e respondida na abertura seguinte. **Premissa minha:** o sábado abre às 6h como os dias úteis, e a janela de follow-up (8h às 19h; sábado até 18h) é mais estreita que a de resposta, para não acordar o lead com mensagem automática de madrugada. Tudo fica em `mayara.expediente` e muda sem código.

**Não são afetados:** comandos do administrador na Central; as notificações de proposta ao administrador; os lembretes de consulta já agendada (são operacionais e a consulta pode ser na segunda).

### Mensagem de lead em dia fechado

No `Canal: Processar Evento`, depois de `Comando?` (comandos do administrador passam sempre) e antes de `Consultar Autorização`, um novo portão `Resposta Permitida?` chama `mayara.resposta_permitida(agora)`. Se fechado, o evento inteiro é gravado em `mayara.eventos_adiados` (com a data de liberação) e o fluxo termina sem resposta. Um workflow `Retomar Eventos Adiados` roda a cada 5 minutos, só com o expediente aberto, e reenvia os eventos guardados, do mais antigo para o mais novo, até 10 por execução, ao mesmo `Processar Evento`. Como as mensagens do mesmo lead chegam juntas, o debounce da Ponte as combina em uma única resposta.

## Régua de follow-up

### Quando o relógio conta

O relógio conta a partir da **última mensagem da Mayara** (`ultima_saida_em`, vinda de `mayara.envios_log`, só das origens que são conversa com o lead), se o lead não respondeu depois dela. Nunca a partir da última mensagem do lead.

### Sequências

Os "dias" são dias de atendimento (domingos e feriados não contam). Os horários são de envio e respeitam a janela de follow-up; se o horário devido cair fora dela, sai na próxima abertura.

**A: conversa interrompida** (o lead já respondeu pelo menos uma vez)

| Etapa | Quando | Objetivo |
|---|---|---|
| 1 | 30 min após a pergunta sem resposta | refazer a pergunta com outras palavras |
| 2 | 1h30 após o follow-up 1 | retomar de forma mais simples |
| 3 | 4h após o follow-up 2 | reabrir a conversa com contexto |
| 4 a 9 | 3 dias úteis seguintes, 10h e 16h | variar, sem repetir a pergunta |
| 10 a 14 | dias úteis alternados por 10 dias, 10h | variar |

**B: nunca respondeu** (o lead nunca escreveu; por exemplo, abordagem por proposta)

| Etapa | Quando |
|---|---|
| 1 a 3 | dia 0: 30 min, +1h30, +4h após a primeira abordagem |
| 4 e 5 | dia 1: 10h e 16h |
| 6 | dia 2: 14h |
| 7 a 13 | dias 3 a 9: 1 por dia, 10h |
| 14 em diante | 1 a cada 2 dias úteis, 10h, até o teto |

Em A, a cada nova pergunta da Mayara que fica sem resposta, a sequência **recomeça** da etapa 1. O teto vale para a soma de follow-ups do lead desde que a régua começou (padrão 14).

**Nunca recuperar atraso:** o calendário de cada ciclo é uma função só do horário da última mensagem da Mayara (`agenda(sequência, ciclo)`). Quando o sistema estiver parado ou o lead entrar atrasado, envia-se **uma única** mensagem: a da etapa **mais recente já devida**; as etapas intermediárias são puladas (não contam no teto). Isso evita uma rajada ao ligar a régua pela primeira vez.

### Quem não entra / quando para

Imediatamente, e conferido de novo antes de cada envio:

| Situação | Efeito |
|---|---|
| lead respondeu | cancela os pendentes; reinicia A na próxima pergunta |
| pediu para parar / sem interesse / resolveu / fora da área | encerra (`encerrado`) |
| consulta aceita ou agendada (`S6_AGENDADO`, `consulta_agendada_em`) | encerra a régua comercial |
| equipe assumiu (`S7_HANDOFF_HUMANO`, lead `bloqueado`) | suspende |
| prioridade jurídica (`S3_PRIORIDADE_JURIDICA`) ou fato sensível | nunca entra |
| prometeu retornar em data (`fatos_json.retornoPrometidoEm`) | pausa até depois da data |
| teto atingido | `revisao_humana` e aviso ao administrador |
| fora da janela de follow-up ou dia fechado | adia para a próxima abertura |

Frequência: no máximo 1 follow-up por lead por 25 minutos e no máximo **15 follow-ups por hora no total** (configurável), para proteger o número do escritório.

### Modos de operação

Chave `followup_modo` em `mayara.config`: `desligado` (padrão), `simulacao` (gera o texto, valida e grava no log como "simulado", sem enviar) e `ligado`. A régua entra primeiro em `simulacao`, e o resumo diário mostra o que teria sido enviado; depois você autoriza `ligado`.

### Geração da mensagem

Entrada para o modelo (só o necessário): últimas 8 mensagens da conversa, os fatos conhecidos, a pergunta pendente (ou a próxima ação), a etapa e os textos dos follow-ups anteriores. Saída: só o texto. Validação por código antes do envio:

- até 400 caracteres e no máximo uma pergunta; sem link; sem `{{ }}`;
- sem promessa de resultado, prazo, desconto ou garantia; sem urgência ou risco inventados; sem frases de pressão ("último aviso", "você pode perder");
- sem opinião jurídica e sem pedido de documentos;
- não pode ser igual nem muito parecido (mesma abertura e mesma pergunta) a um follow-up anterior do mesmo lead.

Se o modelo falhar ou o texto for inválido, usa-se o **texto fixo de reserva** da etapa, que você aprova uma vez (proposta no fim deste documento). Toda mensagem é registrada em `mayara.followups_log` (lead, sequência, etapa, texto, fonte `ia` ou `fixo`, resultado, motivo de cancelamento).

### Teto e revisão humana

Ao atingir o teto: `follow_up_status = 'revisao_humana'`, aviso único ao administrador pelo WhatsApp ("O lead X recebeu 14 follow-ups sem resposta; a régua parou. Responda /followup retomar X para mais N ou deixe encerrado"), e nenhum novo envio automático.

### Resumo diário

Todo dia útil às 18h30 (sábado às 17h30), uma mensagem ao administrador: enviados, simulados, respostas recebidas depois de follow-up, leads parados no teto, falhas.

## Leads que já estão em atendimento

Na ativação, os leads com a Mayara falando por último e sem resposta entram na régua pelo **estado real**, com a regra "nunca recuperar atraso". Só entram conversas cujo último contato foi nos **últimos 7 dias**. Pelos dados de 10/10, os que não responderam mais são a **Cristina** e o **Gilberto** (sequência B, pois não há mensagem deles na memória); a conversa em prioridade jurídica fica de fora por segurança. A lista final é conferida com você na fase de aceite.

## Identidade do lead

O mesmo lead pode ter duas sessões (telefone com e sem o 9º dígito). A régua trabalha por **telefone normalizado** (`mayara.chave_telefone`): o horário da última mensagem da Mayara vem de `mayara.envios_log` (origens `ponte`, `abordagem_assistida` e `reativacao`; os follow-ups não contam como "pergunta"), a última mensagem do lead vem da memória da conversa (`public.n8n_chat_histories`, tipo `human`, somando as duas sessões), e a sequência é B quando o lead nunca escreveu.

## Arquitetura

| Unidade | Faz |
|---|---|
| `mayara.expediente`, `mayara.feriados_nacionais`, funções `resposta_permitida`, `janela_followup`, `proxima_abertura` | calendário e expediente |
| `mayara.eventos_adiados` + workflow `Retomar Eventos Adiados` | guarda e reenvia mensagens de lead recebidas em dia fechado |
| `mayara.regua_followup` (dados) + `mayara.followups_elegiveis(agora)` + `mayara.reservar_followups(agora, limite)` | decide quem recebe o quê, de forma atômica |
| biblioteca `followup.mjs` (testada) | prompt, validação, textos fixos e escolha da etapa |
| workflow `Followup: Worker` (a cada 5 min) | reserva, gera, confere de novo, envia pelo `Canal: Enviar` (origem `followup`), grava log e contadores |
| workflow `Followup: Resumo e Avisos` | resumo diário e aviso de teto |
| comando da Central `/followup` | `/followup status`, `/followup modo simulacao|ligado|desligado`, `/followup retomar <lead>` |
| `mayara.followups_log` | auditoria e métricas |

## Testes

- **Banco:** expediente (dia útil, sábado antes e depois das 18h, domingo, cada feriado, véspera, virada de mês); elegibilidade por etapa (cada marco de tempo e janela); nunca recuperar atraso; cada condição de parada; teto; limite por hora; reserva atômica (duas execuções não pegam o mesmo lead).
- **Biblioteca:** validação (promessa, pressão, link, duas perguntas, repetição), texto fixo, geração do prompt com contexto, nome ausente.
- **Workflows:** estrutura (como nos geradores anteriores) e simulação ponta a ponta com leads de teste, sem envio real.
- **Aceite:** modo `simulacao` por um dia útil; conferência do resumo; depois `ligado` com você acompanhando a primeira rodada.

## Fases

0. **Expediente de atendimento** (calendário, adiamento e retomada das mensagens de lead): plano próprio, vem primeiro porque o domingo e os feriados já valem.
1. **Banco da régua:** estado por lead, calendário `agenda`, elegibilidade, reserva, log, chaves.
2. **Biblioteca `followup.mjs`** (prompt, validação, textos fixos), com testes.
3. **Workflows:** portão de expediente e retomada, worker de follow-up, resumo e avisos, comando `/followup`.
4. **Aceite em simulação**, conferência dos leads atuais e liberação para `ligado`.

A parte do **encaminhamento ao advogado após o agendamento** (verificar agenda, registrar no CRM, encaminhar resumo, avisar o cliente) é um subsistema independente e terá especificação própria; esta régua já encerra os follow-ups quando há consulta.

## Textos fixos de reserva (proposta, para você aprovar uma vez)

- Etapas 1 a 3: "Oi, {nome}. Só para eu conseguir seguir com o seu atendimento: {pergunta}" (com a pergunta pendente, em outras palavras) ou, sem pergunta: "Oi, {nome}. Quando puder, me responde por aqui para eu continuar o seu atendimento?"
- Etapas 4 a 9: "{nome}, sua solicitação sobre as dívidas bancárias continua em aberto por aqui. Se ainda fizer sentido conversar, é só me responder."
- Etapas 10 em diante: "{nome}, passando para saber se ainda precisa de ajuda com a dívida bancária. Se não for mais o momento, é só me avisar que eu encerro por aqui."

## Fora do escopo e riscos

- **Risco no número do escritório:** a régua é intensa. Mitigações: teto, limite por hora, janela, modo simulação, parada imediata e resumo diário.
- **Feriados locais:** só os nacionais estão carregados; acrescentar os estaduais e municipais na tabela quando quiser.
- **Retorno prometido pelo lead:** exige que a Mayara grave `retornoPrometidoEm` nos fatos (uma linha no prompt do Núcleo); entra na Fase 3.
- **Opt-out por texto livre** continua dependendo do Núcleo marcar "sem interesse"; a régua só respeita o que está marcado.

## Perguntas em aberto

1. ~~Dias úteis~~: respondido, 6h às 21h.
2. Os textos fixos de reserva servem?
3. Teto de 14, limite de 15 follow-ups por hora e janela de 8h às 19h servem?

## Estado de implementação (11/10/2026)

- **Expediente** (migrations 0038 e 0039; workflows `Processar Evento` com o portão e `Retomar Eventos Adiados`): no ar. Resposta 6h-21h em dias úteis, sábado até 18h, domingo e feriados fechados.
- **Régua** (migrations 0040 a 0043; biblioteca `2026-10-10-followup-regua/followup.mjs`; workflows `Follow-up: Worker` e `Follow-up: Resumo Diário`): no ar com `followup_modo = ligado`.
- **Decisões do usuário:** retomar tudo na terça (13/10) às 6h; a janela de follow-up abre às 06:00; o texto da Cristina é o próximo follow-up dela (campo `texto_proximo`), depois ela segue a régua padrão.
- **Mudança na regra "nunca recuperar atraso":** vale a etapa mais recente já devida e as intermediárias são puladas.
- **Ensaio de 11/10 (modo simulação, relógio em terça 06:00):** Gilberto etapa 6, Cristina etapa 3 (texto aprovado), Claudemiro etapa 3. O texto da IA foi recusado quando tinha duas perguntas, e uma regra nova recusa frases que fingem ação humana ("estava pensando em você").
- **Pendente:** comando `/followup` na Central; ramo de envio do worker ainda não exercitado em produção (a reserva única por lead impede duplicidade se algo falhar depois do envio).
