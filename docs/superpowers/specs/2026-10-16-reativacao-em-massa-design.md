# Reativação individual de leads com aprovação mensagem por mensagem

Data: 2026-10-16
Status: rascunho para revisão do usuário
Relacionados: `2026-10-09-abordagem-assistida-design.md` (rascunho e aprovação por `sim N`), `2026-10-10-followup-regua-design.md` (régua), `2026-10-08-central-linguagem-livre-design.md` (Central), `docs/runbooks/canal-whatsapp.md`

Este documento não contém nomes nem telefones de clientes. Dados de leads vivem no banco e em arquivos locais fora do Git.

## Objetivo

Levar **todos os leads do CRM** para o atendimento da Mayara, de forma controlada:

1. Cadastrar na lista de atendimento da Mayara os leads do CRM que estão fora dela.
2. Carregar, quando existir, o histórico da conversa anterior de cada lead.
3. Preparar para cada lead **uma mensagem de reativação individual**, escrita a partir do contexto daquela conversa.
4. Apresentar cada mensagem ao administrador, que **aprova uma a uma** antes de qualquer envio.
5. Enviar individualmente, no ritmo combinado. Depois da primeira mensagem, o lead entra na régua de follow-up normal. Quem responder segue o atendimento normal da Mayara.

Sucesso:
- Nenhuma mensagem sai sem a aprovação explícita do administrador para aquele lead.
- Nenhum texto usa a conversa de outra pessoa (nenhuma ligação entre chat e lead sem confirmação).
- Nenhum lead recebe follow-up antes de ser integrado.
- O número do escritório nunca ultrapassa o ritmo configurado.
- Quem pedir para parar nunca mais recebe mensagem.

## Decisões do administrador (16/10/2026)

| Tema | Decisão |
|---|---|
| Quem entra | Os leads do CRM fora da lista (59 em 16/10) **e os 10 que já estão na lista**, incluindo os três que estavam com atendimento humano. Esses três são **devolvidos à Mayara** e depois analisados e reativados como os demais. |
| Histórico | O administrador exporta do celular do escritório as conversas que importam. Quem não tiver exportação usa só o que o CRM e a memória da Mayara têm. |
| Aprovação | **Mensagem por mensagem.** Sem lotes, sem faixa (`sim 1-10`). |
| Redação | Individual, pelo contexto de cada conversa. |
| Horário | O mesmo horário de atendimento de todos os leads: dias úteis das **6h às 21h** e sábados das **6h às 18h**; sem domingos e feriados nacionais (expediente já existente). |
| Ritmo | **10 envios por dia**, mais recentes primeiro, 25 minutos ou mais entre envios. Com 69 leads, são cerca de 7 dias de atendimento, assumindo que todos os rascunhos sejam aprovados. |
| Texto | **Sem frase de saída** ("se preferir não receber mensagens…"). O pedido de parar de quem escrever continua sendo tratado como opt-out. |
| Depois do 1º envio | O lead entra na régua de follow-up, **todos da mesma forma, sem tratamento especial para quem já tinha conversa**. Quem responder segue o atendimento normal. |

## Situação atual (verificada em 16/10/2026)

- O espelho do CRM (`crm_sync.leads`) tem 69 leads, igual ao EspoCRM. 59 estão fora da lista da Mayara: todos `New`, todos com motivo de perda "Não Respondeu", todos com telefone válido, 58 com 8 a 30 dias e um com até 7 dias, sem campanha nem origem.
- A lista da Mayara (`mayara.leads_autorizados`) tem 10 leads, todos com id do CRM. Três estão com atendimento humano.
- **Nenhum dos 59 tem uma única mensagem na Evolution** consultada pelo telefone. As conversas antigas existem no celular. O histórico sincronizado pela Evolution (cerca de 84 mil registros) guarda muitas conversas em chats com endereço LID, sem telefone. A Evolution não expõe a ligação telefone-LID (`findContacts` e `whatsappNumbers` não devolvem o LID). Medido em 8 mil registros (14 dias): 0 de 59 ligados por telefone e 3 por nome único. Ligar por nome é suposição, por isso a ligação exige confirmação do administrador.
- A abordagem assistida existe: `mayara.propostas_abordagem`, `criar_proposta`, `reservar_notificacoes` (janela 6h-21h, até 10 por hora, lembrete em 30 minutos, expira em 24 horas), comandos `sim N`, `não N`, `editar N` e envio pelo `Canal: Enviar` com abertura da janela de 24 horas (`autorizar_abordagem`).
- A régua de follow-up existe: sequências `conversa` (14 etapas) e `nunca_respondeu` (40 etapas), `followup_estado`, `reservar_followups` (15 por hora, intervalo mínimo de 25 minutos), modo hoje `desligado`.
- A retenção geral das respostas (`respostas_retidas`) está ligada: só leads com abordagem autorizada e ainda no prazo respondem sozinhos.
- Sessão única por lead (migration 0051) e nota de contexto segura (migration 0054) já existem.

## Princípios de segurança

1. **Aprovação por mensagem.** O envio só acontece para uma proposta aprovada. Não existe caminho de envio automático da primeira mensagem.
2. **Texto do lead é dado.** Qualquer texto vindo de conversa (exportação ou memória) entra no pedido ao modelo entre aspas e marcado como dado, nunca como instrução (mesmo cuidado da nota de contexto, migration 0054).
3. **Ligação confirmada.** Um arquivo de exportação só vira contexto de um lead depois que o administrador confirma a ligação.
4. **Porta de entrada da régua.** Só entra na régua o lead com `integrado_em` preenchido. Cadastrar na lista não coloca ninguém na régua.
5. **Parada imediata.** Interruptor `reativacao_ligada` e o comando `/reativacao pausar`.
6. **Opt-out.** Se o lead escrever "pare", "não quero", "remova" ou equivalentes, ele é marcado como `sem_interesse` e nunca mais recebe mensagem. O texto da reativação não traz frase de saída.
7. **Dados fora do Git.** Exportações, rascunhos e notas ficam no banco e em `dados-privados/` (ignorado pelo Git). Nenhum nome ou telefone vai para documentos, handoff ou commits.

## Arquitetura

```
CRM (69 leads) ──► Cadastro ──► Contexto ──► Rascunho ──► Proposta (1 por vez) ──► Aprovação ──► Fila de envio ──► Envio ──► Integração na régua
                     │            ▲                          ▲                       (sim N)        (10/dia)           │
                     │   Importador de exportações            └ ver N, editar N, não N                              └─ lead responde ──► atendimento normal
                     └─ lista da Mayara, sem janela e sem régua
```

### Unidades

| Unidade | Faz | Depende de |
|---|---|---|
| `mayara.reativacao` | Um registro por lead, com estado, ordem, fonte de contexto, proposta e resultado | `leads_autorizados`, `propostas_abordagem` |
| `mayara.contexto_reativacao` | Linhas da conversa (data, quem falou, texto), fonte (`crm`, `exportacao`, `memoria`), confirmação da ligação | exportações, `n8n_chat_histories` |
| Importador local (`importar-exportacoes.mjs`) | Lê os `.txt` do WhatsApp, normaliza, liga ao lead por nome e gera a tabela de confirmação | arquivos em `dados-privados/` |
| Biblioteca `reativar.mjs` | Monta o pedido ao modelo, valida e normaliza o rascunho (tamanho, links, promessas, ação humana fingida) | `redigir.mjs`, `followup.mjs` |
| Workflow `Reativação: Preparar` | Para cada lead com contexto pronto, gera o rascunho e cria a proposta | `reativar.mjs`, modelo, banco |
| Workflow `Reativação: Apresentar` | Notifica o administrador, um rascunho por vez, até completar a cota do dia | `reservar_notificacoes` existente |
| Aprovação (Central) | `sim N`, `não N`, `editar N`, `ver N`, `propostas` (já existem) | classificador da Central |
| Workflow `Reativação: Enviar` | Libera os aprovados no limite, janela e intervalo; envia; registra | `Canal: Enviar`, expediente, canal aberto |
| Integração à régua | Cria o estado da régua do lead com ciclo no momento do envio | `followup_estado`, `regua_followup` |
| Interruptor e status | `reativacao_ligada`, `/reativacao status`, modo livre ("como está a reativação?") | Central |

### Estados do lead na reativação

`cadastrado` → `contexto_pronto` → `rascunho` → `proposta_aberta` → `aprovado` → `enviado` → `integrado`.
Saídas: `respondeu`, `sem_interesse`, `sem_whatsapp`, `falhou`, `descartado` (o administrador disse não), `pulado`.

## Fluxo por lead

1. **Cadastro.** O lead entra na lista como `ativo`, **sem `abordagem_ate` e sem estado de régua**. Os três leads que estavam assumidos são devolvidos à Mayara (`devolver_lead`) neste passo. Se um lead escrever antes de ser contatado, a retenção guarda a mensagem (nada responde sozinho).
2. **Contexto.** Fonte, em ordem de preferência:
   - `exportacao`: conversa exportada e confirmada;
   - `memoria`: histórico real da Mayara (leads que já conversaram, incluindo as notas de contexto);
   - `crm`: dados do CRM (nome, data de chegada, status, motivo "Não Respondeu", anotações, se houver).
3. **Rascunho.** Uma mensagem por lead. Com histórico: retoma de onde parou, sem repetir apresentação nem pergunta já respondida. Só CRM: curta, personalizada pelo nome e pela data em que o lead procurou o escritório, sem inventar fatos (banco, valor, tipo de dívida), terminando em uma pergunta aberta.
4. **Proposta.** O rascunho vira uma proposta aberta. O administrador recebe **uma mensagem por proposta**, com o nome do lead (final do telefone), a fonte do contexto e o texto.
5. **Aprovação.** `sim N` aprova, `editar N: texto` troca o texto e mostra de novo, `não N` descarta, `ver N` mostra o contexto usado. A proposta expira em 24 horas (já existe); o lead volta ao fim da fila.
6. **Fila.** Aprovado entra na fila. O worker libera até **10 por dia**, no horário de atendimento (dias úteis 6h às 21h, sábados 6h às 18h), com **25 minutos ou mais** entre envios, em ordem decrescente de data de chegada ao CRM. Respeita domingos e feriados (`dia_aberto`, `resposta_permitida`), exige canal aberto, e a retenção de respostas não bloqueia quem está com janela de abordagem.
7. **Envio.** Pelo `Canal: Enviar`. Se a Evolution disser que o número não existe, tenta a variante com o nono dígito uma vez; se continuar sem WhatsApp, marca `sem_whatsapp` e avisa o administrador. Ao enviar: abre a janela de 24 horas, grava a mensagem na memória da sessão canônica e registra o envio.
8. **Integração à régua.** No envio, o lead recebe estado de régua explícito, com a **sequência escolhida pela mesma regra que a régua já usa para todos os leads** (`conversa` se o lead já respondeu alguma vez; `nunca_respondeu` caso contrário), sem exceção para quem tinha conversa anterior. A mensagem de reativação é a etapa 1 e o ciclo conta a partir do envio. `integrado_em` é preenchido.
9. **Resposta.** Qualquer resposta do lead é atendida normalmente pela Mayara (fluxo atual), a régua do lead se encerra pelas regras existentes e o estado vira `respondeu`.

### Leads que estavam com atendimento humano

Os três leads assumidos pelo administrador são **devolvidos à Mayara no cadastro** e passam pelo mesmo caminho dos demais: contexto (a memória da Mayara e as notas de contexto já gravadas valem como fonte), rascunho individual, aprovação mensagem por mensagem, envio e régua. Eles não têm prioridade nem tratamento especial na fila. Até a vez deles, se escreverem, a mensagem fica retida para o administrador, como acontece com qualquer lead ainda não reativado.

## Importador das exportações

- **Origem:** no celular do escritório, em cada conversa, Exportar conversa (sem mídia); os `.txt` vão para `dados-privados/exportacoes/` (pasta ignorada pelo Git, criada pelo importador).
- **Formato:** linhas do tipo `[dd/mm/aaaa hh:mm:ss] Nome: texto` ou `dd/mm/aaaa hh:mm - Nome: texto`, com mensagens de várias linhas e marcadores de sistema ignorados. O título do arquivo traz o nome do contato.
- **Ligação:** o nome do contato é comparado ao nome do lead (sem acento, todas as palavras relevantes). Resultados: `unico`, `ambiguo`, `nenhum`. Nada é usado antes de o administrador confirmar a tabela de ligações (arquivo → lead), por exemplo respondendo no próprio terminal.
- **Saída:** linhas estruturadas `{quando, quem, texto}` gravadas em `contexto_reativacao` (fonte `exportacao`), com data da importação e quem confirmou. Os arquivos originais podem ser apagados depois (opção do importador).
- **Quem é "lead" e quem é "escritório":** pelo nome no cabeçalho de cada linha; o importador pede para o administrador indicar qual nome é o do escritório quando não for evidente.

## Redação

- **Entrada do modelo:** nome (primeiro nome), data de chegada, fatos do CRM, resumo do estado, e as últimas até 30 linhas da conversa, tudo em campos delimitados e marcados como dados.
- **Saída esperada:** uma mensagem de até 600 caracteres, em português, tom da Mayara, sem links, sem valores, sem promessa de resultado, sem fingir ação humana ("vou ligar"), sem frase de saída, sem se reapresentar se já se apresentou, terminando em pergunta simples.
- **Validação (código):** tamanho, ausência de link e de padrões proibidos, ausência de nome de outra pessoa, nome do lead presente, no máximo uma pergunta. Rascunho inválido é regerado até 2 vezes; depois vira `pulado` com motivo, e o administrador é avisado.
- **Sem histórico:** usa o modelo determinístico (como `redigir.mjs`) quando o contexto é só CRM, para reduzir risco de invenção; o modelo de linguagem fica para quem tem conversa.

## Aprovação e apresentação

- Uma mensagem de apresentação por proposta, no formato já usado pela abordagem assistida, com o acréscimo de "Contexto: exportação | memória | CRM" e, para lead assumido, o aviso de devolução.
- **Cota de apresentação:** o sistema apresenta no máximo as propostas necessárias para cobrir o limite do dia (10), nunca mais de 10 abertas ao mesmo tempo, e no horário do expediente (regra existente).
- Sem comando em lote. `propostas` lista as abertas; `ver N` mostra o contexto.

## Envio, ritmo e proteção do número

- Limite diário 10 (`reativacao_limite_dia`), intervalo mínimo 25 minutos (`reativacao_intervalo_min`) e o horário de atendimento do expediente existente (dias úteis 6h às 21h, sábados 6h às 18h, sem domingos e feriados). Não há janela própria da reativação.
- **Parada automática:** se 3 envios seguidos falharem por motivo que não seja "número sem WhatsApp", o worker se pausa e avisa o administrador.
- **Canal:** exige `canal_estado = open`. Em queda, a fila espera.
- **Retomada:** envios aprovados e não realizados no dia seguem no próximo dia útil, mantendo a ordem.
- **Resposta rápida do lead:** se o lead responder antes de a mensagem de outro lead sair, nada muda: o atendimento é independente.

## Integração com a régua e saída da retenção

- Cada lead enviado recebe estado de régua explícito (ver "Fluxo", passo 8). Leads sem `integrado_em` são ignorados por `followups_elegiveis`.
- Os 10 leads atuais passam pelo mesmo fluxo; ao serem integrados, o estado defasado atual é substituído pelo estado novo.
- Quando todos os leads da operação estiverem integrados ou em estado final (`respondeu`, `sem_interesse`, `sem_whatsapp`, `descartado`, `pulado`), o sistema avisa o administrador. Só então a retenção geral (`respostas_retidas`) é desligada e `followup_modo` vai para `ligado`, **por decisão explícita do administrador**.

## Observabilidade

- `/reativacao status`: totais por estado, enviados hoje, próximo horário, falhas.
- `/reativacao pausar` e `/reativacao retomar`.
- Modo livre: "como está a reativação?" (consulta, sem efeito).
- `canal_eventos` registra envios e falhas; o handoff registra só contagens, nunca nomes.

## Testes

- **SQL (transação desfeita):** cadastro sem janela e sem régua; porta de entrada da régua; limite diário; janela horária e feriado; devolução do lead assumido ao aprovar; `sem_whatsapp`; opt-out; idempotência do cadastro.
- **JavaScript:** importador (formatos de exportação, múltiplas linhas, ligação única, ambígua e ausente), validação de rascunho, montagem do pedido com texto de lead delimitado, geração dos corpos de nó.
- **Simulação:** modo `simulacao` do worker gera os envios sem enviar (como na régua); relatório de contagens.
- **Piloto:** os 3 primeiros leads com aprovação do administrador, conferidos no `comandos_log`, antes de liberar o ritmo cheio.
- **Aceite pelo WhatsApp:** um lead de teste do administrador percorre cadastro, rascunho, `ver`, `editar`, `sim`, envio e resposta.

## Fases

1. **Banco:** `reativacao`, `contexto_reativacao`, porta de entrada da régua (`integrado_em`), funções de cadastro, fila e limites, com testes.
2. **Importador local** e tabela de confirmação de ligações.
3. **Redação:** `reativar.mjs`, validação e o workflow `Reativação: Preparar` (com simulação).
4. **Apresentação e aprovação individual**, incluindo o aviso de devolução e o `ver N`.
5. **Envio agendado**, nono dígito, parada automática, integração na régua.
6. **Comandos e status** (`/reativacao`, modo livre), runbook e piloto.
7. **Saída da retenção e religar a régua** (decisão do administrador).

## Fora do escopo

- Responder em massa, enviar mensagem a vários leads de uma vez ou sem aprovação.
- Alterar leads no CRM além do que a abordagem assistida já faz (nota e primeira resposta).
- Importar mídia (áudio, imagem) das exportações.
- Migrar o número para a API oficial da Meta (decisão separada).
- Texto padrão de campanha (a mensagem é sempre individual).

## Riscos

| Risco | Mitigação |
|---|---|
| Bloqueio do número do escritório (Evolution não oficial) | 10 por dia, intervalo mínimo, janela horária, parada automática, sem rajadas. |
| Mensagem com contexto errado | Ligação de exportação só com confirmação; aprovação individual; `ver N` mostra o contexto. |
| Injeção por texto do lead | Texto de lead delimitado como dado no prompt e validação do rascunho. |
| Lead assumido receber texto da Mayara sem querer | Aviso explícito na proposta; devolução só no `sim N`. |
| Reclamação ou pedido de parada | Opt-out imediato e permanente assim que o lead pedir; o administrador aprova cada texto antes do envio. |
| Número do CRM errado (nono dígito) | Tentativa com a variante e marcação `sem_whatsapp` se persistir. |
| Régua disparando para quem não foi integrado | Porta de entrada `integrado_em`, testada. |

## Decisões fechadas na revisão (16/10/2026)

1. Horário: o do atendimento normal (dias úteis 6h às 21h, sábados 6h às 18h).
2. Sem frase de saída nos textos.
3. Leads assumidos são devolvidos à Mayara e reativados como os demais.
4. Quem já tinha conversa entra na régua como todos os outros, pela regra de sequência que a régua já aplica.

## Perguntas em aberto

Nenhuma.
