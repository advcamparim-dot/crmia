# Central de comando da Mayara: comandos e ensino pelo WhatsApp

Data: 2026-10-03
Status: rascunho para revisão do usuário
Relacionados: `2026-10-02-mayara-numero-escritorio-coexistencia-design.md` (cita o canal de comando como "parte B"), `2026-09-21-mayara-banco-leads-autorizados-design.md` (portão do Gateway)

## Objetivo

O número do usuário (`+5514997022609`) passa a ser a **central de comando** da Mayara. Por ele o usuário:

1. **Controla**: liga e desliga a Mayara, consulta o status, tira um lead da Mayara para a equipe atender e devolve depois.
2. **Ensina**: dá instruções de comportamento em linguagem natural, como a uma pessoa nova na equipe, e a Mayara passa a segui-las depois de uma confirmação. Qualquer instrução pode ser listada e desfeita.

Sucesso: o usuário muda o jeito de atender sem editar workflow nem prompt, vê exatamente o que mudou, e desfaz com um comando.

## Decisões já tomadas com o usuário

1. O número `+5514997022609` é hoje o lead de teste e depois vira só central de comando. Na virada, o teste de lead passa para outro número.
2. **Ensino com confirmação e desfazer** (opção B): a Central reescreve a instrução, o usuário responde *sim*, e só então ela vale. Há `/regras` e `/desfazer`.
3. **Camada de instruções no banco** (abordagem 1): cada ensinamento é uma linha em tabela, injetada no prompt do Núcleo V3. O prompt não é reescrito pela API.
4. Comandos `/` são interpretados por **regra fixa, sem IA**.
5. As regras jurídicas e de segurança do prompt **nunca** podem ser contrariadas por instrução.

## Fora do escopo

- Base de conhecimento com busca (RAG) para fatos do escritório.
- Transcrição de áudio de administrador.
- Papéis diferentes por administrador (todos os administradores têm as mesmas permissões nesta fase).
- Avisos proativos da Mayara ao administrador fora da janela de 24 h (exigem template da Meta).
- Correção da criação de Task a cada mensagem durante a pausa (ver "Riscos").

## Estado atual (fatos verificados em 03/10/2026)

- O Gateway (`FV0PEtEcTFbuoRaO`) tem o portão de leads: `Normalizar e Filtrar Evento` → `Tem Mensagem?` → `Consultar Autorização` → `Liberado?` → `Restaurar Evento` → `Evento Autorizado?` → Ponte. O webhook responde 200 de imediato (modo padrão).
- O liga/desliga é a linha `controlKey = global` da **Data Table do n8n** `Mayara Control` (id `8zkrH8xVko73LXAd`), campo `aiMode` (`active` ou `paused`). A Ponte a lê em toda mensagem (`Verificar Status da Mayara` → `Mayara Ativa?`). O workflow `Mayara — Controle Operacional` altera essa linha por webhook.
- Quando `aiMode` não é `active`, a Ponte envia ao lead: "No momento, o atendimento automático está temporariamente pausado. Nossa equipe vai continuar o seu atendimento por este WhatsApp." e **cria uma Task de prioridade alta no EspoCRM por mensagem recebida**.
- O Núcleo V3 (`aULd8QZQ3OVFhoRg`) monta o prompt como expressão no node `AI Agent`. A memória é a tabela `public.n8n_chat_histories`.
- O portão de leads (`mayara.motivo_bloqueio`) já bloqueia em silêncio lead com status `bloqueado`. Isso é reaproveitado para `/assumir`.
- A ferramenta de edição do n8n é instável em workflows grandes e nunca aplicou chamadas com SQL de escrita (`insert`/`update`) em nodes. Por isso: workflows novos pequenos, e uma única edição pequena no Núcleo e no Gateway, só com `select`.

## Arquitetura

```
Meta -> Gateway (assinatura HMAC) -> Normalizar
          |-> É Administrador? (consulta ao banco)
                |-> sim e (modo exclusivo ou texto começa com "/") -> Central de Comando (workflow novo)
                |-> não -> Tem Mensagem? -> portão de leads -> Ponte -> Núcleo V3 (lê instruções ativas)
```

### Componentes

| Componente | Função |
|---|---|
| `mayara.administradores` | Quem pode dar ordens. |
| `mayara.instrucoes` | Livro de instruções com estados. |
| `mayara.comandos_log` | Auditoria e idempotência (por `message_id`). |
| `mayara.config` (chaves novas) | `canal_comando_exclusivo`, `instrucoes_max_ativas`. |
| Ramo novo no Gateway | Separa mensagem de administrador antes de qualquer outra coisa. |
| Workflow `Mayara — Central de Comando` | Interpreta, executa e responde. |
| Bloco no prompt do Núcleo V3 | Injeta as instruções ativas. |

## Modelo de dados (migration `0011`)

```sql
create table mayara.administradores (
  telefone text primary key check (telefone ~ '^\+55[0-9]{10,11}$'),
  telefone_chave text generated always as (mayara.chave_telefone(telefone)) stored not null unique,
  nome text,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

create table mayara.instrucoes (
  id bigserial primary key,
  texto text not null check (char_length(texto) <= 400),
  texto_original text,
  estado text not null default 'pendente'
    check (estado in ('pendente','ativa','recusada','expirada','desfeita')),
  autor_chave text not null,
  criado_em timestamptz not null default now(),
  confirmar_ate timestamptz not null default now() + interval '30 minutes',
  ativada_em timestamptz,
  encerrada_em timestamptz
);
create unique index instrucoes_uma_pendente on mayara.instrucoes ((true)) where estado = 'pendente';

create table mayara.comandos_log (
  id bigserial primary key,
  message_id text unique,
  admin_chave text not null,
  entrada text not null,
  acao text,
  resultado text,
  criado_em timestamptz not null default now()
);
```

Todas com RLS ligada, sem policies e sem acesso para `anon` e `authenticated`, como as demais. Funções (`search_path = ''`):

- `mayara.eh_administrador(p_telefone text) returns boolean`.
- `mayara.instrucoes_ativas_texto() returns text`: lista numerada das instruções ativas, da mais recente para a mais antiga, ou texto vazio.
- `mayara.expirar_pendentes() returns int`: marca como `expirada` as pendentes vencidas (chamada pela Central antes de cada decisão).

Retenção do `comandos_log`: 90 dias, limpeza no mesmo workflow que fará a limpeza da memória.

## Gateway: ramo de administrador

Novo node `Rota da Mensagem` (Postgres, só `select`) logo depois de `Normalizar e Filtrar Evento` e antes de `Tem Mensagem?`:

```sql
select case
  when mayara.eh_administrador($1)
   and (coalesce((select valor from mayara.config where chave = 'canal_comando_exclusivo'), 'false') = 'true'
        or left(ltrim($2), 1) = '/')
  then 'comando' else 'lead' end as rota
```

- Parâmetros: telefone e texto. Eventos sem mensagem (`EVENTO_SEM_MENSAGEM`) pulam a consulta e seguem o caminho de hoje.
- `rota = 'comando'`: `Executar Central` (Execute Workflow, sem esperar) com telefone, texto, `messageId` e `phoneNumberId`; fim do fluxo. **Nunca** segue para o portão de leads nem para a Ponte.
- `rota = 'lead'`: caminho atual.
- Falha na consulta: fecha o portão (`Stop and Error`), como no portão de leads. Mensagem de administrador não pode cair no fluxo de lead.

## Central de Comando

Workflow novo, entrada por `Execute Workflow Trigger` (`phone`, `message`, `messageId`, `phoneNumberId`).

1. **Idempotência**: `insert into mayara.comandos_log (message_id, admin_chave, entrada) ... on conflict (message_id) do nothing returning id`. Sem retorno: a Meta reenviou, fim.
2. `mayara.expirar_pendentes()`.
3. **Classificar** (node Code, sem IA):
   - começa com `/`: comando fixo;
   - `sim` ou `não` (com variações simples) **e** existe instrução pendente não vencida: confirmação;
   - senão, só no modo exclusivo: texto livre (ensino ou pergunta);
   - senão: resposta de ajuda.
4. **Executar** o ramo e **responder** pela Graph API com a mesma credencial `Bearer Auth account`, usando o `phoneNumberId` recebido. A resposta cabe na janela de 24 h porque o administrador escreveu primeiro.
5. Gravar `acao` e `resultado` no log.

### Comandos fixos

| Comando | Efeito |
|---|---|
| `/status` | `aiMode`, conversas ativas nas últimas 24 h, consultas de hoje, instruções ativas, falhas pendentes do CRM. |
| `/ligar`, `/desligar` | Atualiza a linha `global` da Data Table `Mayara Control`. Valem na hora (desligar é a direção segura). |
| `/assumir <tel>` | `leads_autorizados.status = 'bloqueado'` para o número e `session_state.estado = 'S7_HANDOFF_HUMANO'`. A Mayara fica em silêncio com esse lead. |
| `/devolver <tel>` | `status = 'ativo'`; a sessão volta a `S2_QUALIFICACAO` se estava em `S7_HANDOFF_HUMANO`. |
| `/regras` | Lista as instruções ativas com o id. |
| `/desfazer <id>` | Passa para `desfeita` e responde com o texto desfeito. |
| `/reativar <id>` | Volta uma instrução `desfeita` para `ativa` (respeita o limite). |
| `/ajuda` | Lista os comandos. |

O número em `/assumir` e `/devolver` é normalizado pela mesma regra do banco (`chave_telefone`); formato inválido é recusado com o formato esperado.

### Ensino (modo exclusivo)

1. Texto livre entra no node de IA (Anthropic, mesma credencial do Núcleo) com saída em JSON: `{ "tipo": "instrucao" | "pergunta" | "duvida", "regra": "...", "pergunta": "..." }`.
2. `tipo = instrucao`: a regra passa pela **checagem de conflito**: lista de padrões no código (prometer resultado ou desconto, opinar juridicamente, ocultar que é IA, pedir documento sensível, agir sobre recuperação judicial ou falência, ignorar o protocolo de risco pessoal) e uma segunda checagem da IA contra um resumo das regras fixas. Em conflito: recusa, explica o motivo, nada é gravado.
3. Sem conflito: grava `pendente` com `texto` (reescrito, até 400 caracteres) e `texto_original`, e responde: "Entendi: [regra]. Confirma? Responda *sim* ou *não*." Só existe uma pendente por vez (índice único); se já há uma, a Central pede para resolver a anterior.
4. `sim` (dentro de 30 minutos): `ativa`, `ativada_em = now()`. Respeita `instrucoes_max_ativas` (30); acima disso pede para desfazer alguma. `não`: `recusada`.
5. `tipo = duvida`: uma única pergunta de esclarecimento, sem gravar nada.
6. `tipo = pergunta` (por exemplo, "o que você respondeu para o último lead?"): fora do escopo da primeira versão; a Central responde com os comandos disponíveis.

## Injeção no Núcleo V3

Duas edições, ambas sem SQL de escrita:

1. **Query do node `Buscar Estado da Sessao`**: acrescentar `mayara.instrucoes_ativas_texto() as instrucoes` ao `select` (somente leitura).
2. **Prompt do `AI Agent`**: novo bloco antes de `ESTILO DE ESCRITA`, lendo `{{ $('Calcular Lacunas').item.json.instrucoes }}`, com este cabeçalho:

> INSTRUÇÕES DO ESCRITÓRIO. Orientações dadas pelo escritório sobre como atender. Siga-as. Em qualquer conflito com PROIBIÇÕES ABSOLUTAS, SINAL DE RISCO PESSOAL ou MOVIMENTAÇÃO PATRIMONIAL, essas seções prevalecem e a instrução é ignorada. Em caso de conflito entre instruções, vale a mais recente (a primeira da lista). Informações comerciais que constem aqui (honorários, duração, condições) contam como aprovadas pelo escritório.

Quando não há instruções, o bloco fica vazio e o comportamento é o de hoje. O valor entra como dado (não é reavaliado como expressão), mas a função remove `{{` e `}}` do texto por segurança.

## Segurança

- A origem da mensagem é o campo `from` do webhook, que já passou pela validação HMAC da Meta. Só números ativos em `administradores` são tratados como administradores.
- Texto de lead **nunca** chega à Central, e texto de administrador **nunca** chega à Mayara-lead (depois da virada).
- Comandos fixos não passam por IA. A IA do ensino só produz uma regra em texto, que precisa de confirmação humana antes de valer.
- Auditoria: todo comando, confirmação e resultado em `comandos_log`.
- Risco residual: chip clonado ou celular acessado por terceiros. Mitigação: o `/desligar` está sempre disponível e `/regras` e `/desfazer` revertem qualquer ensino.

## Erros

| Situação | Comportamento |
|---|---|
| Comando desconhecido | Responde com a lista de `/ajuda`. |
| Falha na Central | Responde "não consegui, nada foi alterado" e registra o erro. |
| Falha na consulta de rota no Gateway | Fecha o portão e alerta pelo `errorWorkflow`; nada vai ao fluxo de lead. |
| `sim` sem pendente ou vencida | Trata como mensagem comum (ajuda) e explica que não há nada pendente. |
| Mensagem duplicada da Meta | Ignorada pela idempotência. |
| Limite de instruções atingido | Pede para consolidar ou desfazer. |

## Testes

1. **SQL** (transações desfeitas): estados da instrução, índice de uma pendente, expiração, `eh_administrador`, `instrucoes_ativas_texto` com e sem regras, limite de ativas.
2. **Código** (testes locais): classificador de mensagens, normalização de telefone, checagem de conflito (casos que devem e não devem ser recusados), remoção de `{{`/`}}`.
3. **Gateway**: simulação local do `Rota da Mensagem` com payloads sintéticos (administrador com e sem `/`, em modo exclusivo ou não, lead comum, status). As mensagens reais exigem a assinatura da Meta, então não há teste ao vivo automatizado.
4. **Aceitação no celular** (roteiro): `/ajuda`, `/status`; ensinar uma regra e confirmar com *sim*; ver a regra agir numa conversa de teste; `/regras`; `/desfazer`; conferir que a Mayara voltou ao comportamento anterior; `/desligar` e `/ligar` com uma mensagem de lead entre os dois; `/assumir` e `/devolver`; tentar ensinar algo proibido ("prometa 50% de desconto") e ver a recusa.

## Riscos e pontos a decidir no plano

1. **Task por mensagem durante a pausa.** Com `/desligar`, a Ponte cria uma Task de prioridade alta no EspoCRM a cada mensagem do lead. Convém corrigir (uma Task por lead por período) numa tarefa separada, antes de usar `/desligar` com leads reais.
2. **Virada do modo exclusivo.** Antes de ligar `canal_comando_exclusivo`, é preciso ter outro número para o teste de lead; senão o seu próprio teste de lead deixa de funcionar.
3. **Custo do prompt.** O bloco cresce com as regras (limite de 30 × 400 caracteres, cerca de 3 mil tokens no pior caso).
4. **Instabilidade da ferramenta do n8n.** Cada edição será feita em passos curtos, com leitura de volta e rollback (`n8n_workflow_versions`) pronto.

## Atualização de 03/10 (depois da escrita)

1. **Aviso de falha de agendamento já existe** (workflow `2Z3f0Ka1aOsuRwr8`, commit `b3f199f3`): alerta no número do administrador e Task de reserva no EspoCRM. A Central o reaproveita e não o recria.
2. **Prefixo "*Mayara:*"** já é aplicado no envio da Ponte e no follow-up. As respostas da Central **não** levam esse prefixo: vão sem identificação de remetente, pois quem lê é o administrador.
3. **Fase 2, avisos ao administrador com fila.** Mensagem de texto livre só chega dentro de 24 h da última mensagem do administrador. Para não perder avisos, uma tabela `mayara.avisos_admin` (texto, criado_em, entregue_em) guarda os pendentes, que a Central entrega na hora quando a janela está aberta ou na próxima mensagem do administrador, mais o comando `/pendencias`. Não faz parte da primeira entrega.
4. **Limitações da ferramenta de edição do n8n (observadas em 02 e 03/10):** nós de Postgres com operação `upsert` (`Salvar Estado da Conversa`, `Upsert row(s)`) não podem ser editados; `addNode` de `IF` ou `executeWorkflow` falha no Núcleo V3; edições com SQL de escrita não aplicam. Regras para o plano: lógica nova entra em **workflows novos e pequenos**; nós novos no workflow grande entram como `noOp` ligado ao ponto certo e depois são convertidos com `updateNode`; todo passo termina com leitura de volta.
5. **Lembretes de consulta** usam template da Meta, fora do alcance do prefixo e dos comandos desta spec.

## Ordem de execução

1. Migration `0011` (tabelas, funções, testes SQL) e carga do seu número em `administradores`.
2. Central de Comando (workflow novo, desligado) e seus testes.
3. Edições do Núcleo V3 (query e bloco do prompt), com o bloco vazio.
4. Ramo de administrador no Gateway, no modo não exclusivo (só mensagens com `/`).
5. Aceitação no celular dos comandos e do ensino.
6. Virada para o modo exclusivo, quando houver outro número de teste.

## Conclusão (03/10/2026)

**Entregue e em produção.** Migration `0011` aplicada (tabelas `administradores`, `instrucoes`, `comandos_log`, 17 funções, chaves `canal_comando_exclusivo` e `instrucoes_max_ativas`); biblioteca JS com 27 testes; workflow `Mayara — Central de Comando` (`jNhj68Ee7i3w8dey`, ativo, 20 nós); ramo de administrador no Gateway (`FV0PEtEcTFbuoRaO`); bloco `INSTRUÇÕES DO ESCRITÓRIO` no Núcleo V3 (`aULd8QZQ3OVFhoRg`). O número `+5514997022609` está cadastrado como administrador. O modo exclusivo está **desligado**.

**Testado pelo WhatsApp:** `/ajuda`, `/status`, `/regras`, `/assumir` com número fora da lista, `/desligar` (a Data Table passou a `paused`), `/ligar`; ensino com reescrita, confirmação por *sim* e ativação; *sim* sem instrução pendente; recusa de instrução proibida; injeção da instrução no prompt (a resposta da Mayara obedeceu a uma regra de teste). Regressão de lead: o número de teste, como lead, continua sendo atendido normalmente.

**Defeitos achados na aceitação e na revisão final, e corrigidos (cada um com teste que falhou antes):**
1. Caracteres combinantes literais no código gerado, que o n8n não preserva.
2. "Prometa 50% de desconto" escapava da recusa quando a IA o classificava como dúvida; a checagem passou a olhar o texto original.
3. A negação ("Não…", "Nunca…") valia por 25 caracteres e escondia uma ordem proibida em outra frase; passou a valer só colada ao verbo e na mesma frase. Isso também corrigiu um falso positivo ("Nunca prometa desconto nem garanta resultado").

**Não testado pelo WhatsApp (decisão do usuário: fica para depois da camada de canal):** `/desfazer`, `/reativar` e `/devolver` pelo celular; uma pergunta de lead com o modo exclusivo desligado depois de ensinar uma regra. Essas funções têm cobertura nos testes SQL e a classificação dos comandos tem cobertura nos testes JS.

**Limitações conhecidas:**
- A instrução nº 6 ("informe que a consulta é gratuita"), criada no teste, **continua ativa**.
- O nó `Classificar` do workflow vivo mantém uma cópia antiga e não usada de `montarResultadoEnsino` e da checagem de negação; só o `Validar Ensino` é usado. Recriar o workflow a partir do JSON versionado elimina a diferença.
- Se o banco cair antes de `Registrar Comando`, o administrador não recebe resposta (o workflow de erros avisa).
- Retenção do `comandos_log` (90 dias) e a fila de avisos ao administrador (fase 2) não foram implementadas.
- Com a Mayara desligada, a Ponte cria uma Task de prioridade alta no CRM por mensagem de lead; recomenda-se corrigir antes de usar `/desligar` com leads reais.
- A ferramenta de edição do n8n é instável; ver as regras registradas na memória do projeto.
