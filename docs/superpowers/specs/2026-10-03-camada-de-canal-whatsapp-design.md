# Camada de canal do WhatsApp: trocar o conector sem mexer na Mayara

Data: 2026-10-03
Status: rascunho para revisão do usuário
Relacionados: `2026-10-02-mayara-numero-escritorio-coexistencia-design.md` (caminho oficial com coexistência), `2026-10-03-mayara-central-de-comando-design.md` (Central e fila de avisos)

## Objetivo

Desacoplar o WhatsApp do resto da Mayara. Hoje o recebimento está preso ao formato da Meta (um Gateway) e o envio está espalhado em vários nós que chamam a Graph API diretamente. A camada de canal cria **um ponto de entrada e um ponto de saída por provedor**, de modo que trocar o conector (Meta oficial, Evolution API, outro) seja uma mudança de configuração e de um adaptador, não de seis workflows.

Sucesso:
1. O portão de leads, o Núcleo V3, a memória, o agendamento e a Central funcionam **sem alteração** com qualquer provedor.
2. Um número pode ser ligado a um provedor, desligado e trocado por uma linha de configuração, sem editar workflows de negócio.
3. Com o provedor não oficial, a Mayara só responde a quem escreveu há pouco e respeita um teto de envios.

## Decisões já tomadas com o usuário

1. O usuário quer avaliar sair da API oficial para conectar o número do escritório. A API oficial continua como plano B.
2. Arquitetura-alvo: **Evolution API auto-hospedada em serviço separado no Coolify** (volume persistente e backup), webhook para o n8n, EspoCRM como registro de negócio (lead, consulta, tarefa) e **Supabase como estado operacional** (sessão, memória, lista de leads, instruções, log de comandos). Conector desacoplado para poder trocar depois.
3. Começar **reativo**: só responder a quem iniciou a conversa, sem disparos em massa, com monitoramento de reconexão, pendências e erros.
4. **Atualizado em 03/10:** o usuário decidiu conectar **o número do escritório diretamente**, sem chip descartável, por não haver disparo em massa. O chip descartável passa a ser opcional. Para compensar, a fase 2 roda em **modo de observação**: a Evolution recebe tudo, mas o portão de leads continua liberando só os números cadastrados (hoje, os de teste), então a Mayara **não responde a clientes reais** até o usuário decidir abrir.

## Riscos aceitos (decisão do usuário, registrada)

- Clientes não oficiais do WhatsApp violam os termos de uso. O número pode ser **banido**, com perda do número e do histórico de conversas. O risco é do usuário e foi explicado antes desta spec.
- O rollback do **software** (voltar ao provedor oficial) é uma linha de configuração. O rollback do **número** não é instantâneo: um número banido está perdido, e um número que saiu da API oficial precisa ser registrado de novo.

## Fora do escopo

- Instalar e operar a Evolution API no Coolify (infraestrutura do usuário; a spec só define o que a camada espera dela).
- Grupos, mídia, áudio e envio de arquivos (mídia recebida continua indo para o desvio "requer humano", como hoje).
- Múltiplos números por provedor além de uma instância por número.
- Responder automaticamente a mensagens enviadas pela equipe pelo celular (ideia futura: pausar a Mayara quando a equipe responder).

## Estado atual (verificado em 03/10/2026)

**Entrada.** Um único Gateway (`FV0PEtEcTFbuoRaO`, webhook `whatsapp-mayara`): valida a assinatura da Meta, normaliza o evento (`Normalizar e Filtrar Evento`) e segue para `Tem Mensagem?` → rota de administrador → portão de leads → Ponte. O objeto normalizado tem `accepted`, `reason`, `channel`, `phone`, `profileName`, `message`, `messageType`, `messageId`, `timestamp`, `phoneNumberId`, `displayPhoneNumber`, `sessionKey`, `dedupeKey`, `requiresHuman` e campos de campanha.

**Saída.** Nós que chamam `graph.facebook.com` diretamente (levantamento dos exports versionados; a varredura completa da instância faz parte da implementação):

| Workflow | Nó | Tipo de mensagem |
|---|---|---|
| Ponte WhatsApp | `Enviar via Graph API` | texto (resposta da Mayara) |
| Ponte WhatsApp | `Enviar Pausa via Graph API` | texto (aviso de pausa) |
| Follow-up Sumiu no Meio | `Enviar via Graph API` | texto |
| Lembretes de Consulta | `Enviar Lembrete via Graph API` | **template** da Meta |
| Central de Comando | `Responder` | texto |
| Alertar Escritório | `Enviar Alerta` | texto (para o administrador) |
| Receber Lead do Formulário (inativo) | `Enviar Template` | **template** da Meta |
| Alertas de Erros de Workflow | `Enviar Alerta WhatsApp` | texto (só existe no n8n) |

**Chave de sessão.** `whatsapp:<phone_number_id>:<telefone>`. O `phone_number_id` identifica a linha.

## Arquitetura

```
Meta  ──> Gateway Meta (assinatura) ──┐
                                       ├──> Canal: Processar Evento ──> portão ──> Ponte ──> Núcleo V3
Evolution ──> Canal: Receber Evolution ┘                                  └──> Central de Comando

Ponte / Follow-up / Lembretes / Central / Alertas ──> Canal: Enviar ──> Meta (Graph API) | Evolution (REST)
```

### Componentes

| Componente | Função |
|---|---|
| `mayara.canais` | Cadastro das linhas: qual provedor atende cada `canal_id`. |
| `mayara.envios_log` | Auditoria dos envios e base do teto por minuto. |
| `mayara.canal_templates` | Texto equivalente de cada template da Meta, para provedores sem template. |
| Workflow `Canal: Processar Evento` | Tudo que hoje vem depois de `Normalizar e Filtrar Evento` no Gateway, extraído para um sub-workflow compartilhado. |
| Workflow `Canal: Receber Evolution` | Webhook da Evolution: autentica, filtra, normaliza e chama `Processar Evento`. |
| Workflow `Canal: Enviar` | Único ponto de saída; escolhe o provedor pela tabela `canais`. |
| Workflow `Canal: Estado` | Recebe o estado da conexão da Evolution e avisa o administrador. |

## Modelo de dados (migration `0012`)

```sql
create table mayara.canais (
  canal_id text primary key,              -- phone_number_id (Meta) ou nome da instancia (Evolution)
  provedor text not null check (provedor in ('meta', 'evolution')),
  rotulo text not null,
  telefone text,                          -- numero da linha, informativo
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

create table mayara.envios_log (
  id bigserial primary key,
  canal_id text not null,
  destino_chave text not null,            -- mayara.chave_telefone do destinatario
  tipo text not null check (tipo in ('texto', 'template')),
  ok boolean not null,
  erro text,
  provedor_message_id text,
  criado_em timestamptz not null default now()
);
create index envios_log_canal_tempo_idx on mayara.envios_log (canal_id, criado_em desc);

create table mayara.canal_templates (
  nome text primary key,                  -- nome do template na Meta
  corpo text not null                     -- texto com {{1}}, {{2}}...
);
```

RLS ligada, sem policies, sem acesso para `anon` e `authenticated`; funções com `search_path = ''` e `revoke` do público.

Chaves novas em `mayara.config`: `evolution_janela_horas` (padrão `48`), `evolution_teto_por_minuto` (padrão `20`), `evolution_segredo_sha256` (hash do segredo do webhook).

Função `mayara.pode_enviar(p_canal_id text, p_destino text, p_tipo text) returns jsonb` devolve `{ "ok": true, "provedor": "..." }` ou `{ "ok": false, "motivo": "canal_desconhecido" | "canal_inativo" | "fora_da_janela" | "teto_por_minuto" }`. Para `meta` só valida que o canal existe e está ativo. Para `evolution`, além disso exige mensagem recebida desse destinatário nas últimas `evolution_janela_horas` (usa `session_state.last_lead_message_at`) e menos de `evolution_teto_por_minuto` envios no último minuto.

## Contrato interno

### Evento normalizado (entrada)

O mesmo objeto de hoje, com um acréscimo de nome e uma generalização:

- `canalId`: `phone_number_id` na Meta; nome da instância na Evolution. Substitui o uso direto de `phoneNumberId` (que continua existindo como alias para a Meta).
- `sessionKey = whatsapp:<canalId>:<telefone>`. Na Meta nada muda, então as sessões atuais continuam válidas.
- `provedor`: `meta` ou `evolution`.

### Pedido de envio (saída)

Entrada de `Canal: Enviar`: `{ canalId, para, tipo: 'texto' | 'template', texto?, template?: { nome, variaveis[] }, origem }`, onde `origem` é o nome do workflow chamador (auditoria).
Saída: `{ ok, provedorMessageId?, erro? }`. O chamador **nunca** sabe qual provedor foi usado.

Regras do `Canal: Enviar`:
1. Consulta `mayara.pode_enviar`. Se `ok = false`, **não envia**, grava em `envios_log` e devolve `{ ok: false, erro: <motivo> }`.
2. `meta`: monta o corpo da Graph API v25.0 (texto ou template) com a credencial `Bearer Auth account`. Comportamento idêntico ao de hoje.
3. `evolution`: se `tipo = template`, renderiza o texto a partir de `canal_templates` (falha se o template não estiver cadastrado). Antes do envio espera um atraso proporcional ao tamanho do texto (entre 1 e 4 segundos). Envia por `POST /message/sendText/<instancia>` com o cabeçalho `apikey`.
4. Grava o resultado em `envios_log`.

## Entrada pela Evolution (`Canal: Receber Evolution`)

1. **Autenticação:** o webhook exige o cabeçalho `x-canal-segredo`; o hash SHA-256 do valor é comparado com `mayara.config.evolution_segredo_sha256`. Sem o cabeçalho ou com valor errado: descarta em silêncio. Se o Coolify permitir, o caminho do webhook fica acessível só na rede interna.
2. **Filtros (descartam sem consultar o banco):** mensagens com `fromMe = true`; grupos (`@g.us`); `status@broadcast`; newsletters; reações, edições e exclusões; qualquer evento que não seja mensagem.
3. **Telefone:** extraído do `remoteJid`. Se o identificador vier no formato `@lid` e não houver telefone alternativo no payload, o evento é **descartado e registrado** (o portão compara por telefone e não pode decidir sem ele).
4. **Texto:** `conversation`, `extendedTextMessage.text` ou o título de resposta de botão/lista. Áudio, imagem, documento e figurinha viram `requiresHuman = true`, como hoje.
5. **Normalização:** produz o evento normalizado com `provedor = 'evolution'`, `canalId = <instância>` e chama `Canal: Processar Evento`.
6. **Deduplicação:** `messageId` = `key.id`; a Ponte já deduplica por esse campo.

*Os nomes exatos dos campos do payload e do endpoint de envio dependem da versão da Evolution fixada e devem ser conferidos na fase de teste com o chip descartável.*

## Estado da conexão (`Canal: Estado`)

Recebe o evento de estado da conexão da Evolution. Se o estado não for "conectado", registra em `mayara.avisos_admin` (fila da fase 2 da Central) e tenta avisar o administrador. **O aviso não pode sair pela própria linha que caiu**; ver a primeira questão em aberto.

## Migração por fases

1. **Fase 1, sem risco, só com a Meta:** migration `0012`; criar `Canal: Enviar` (provedor `meta`) e trocar os 8 pontos de envio por uma chamada a ele, um de cada vez; extrair `Canal: Processar Evento` do Gateway. Resultado: comportamento idêntico ao de hoje, já desacoplado.
2. **Fase 2, número do escritório em modo de observação:** subir a Evolution no Coolify, criar `Canal: Receber Evolution`, o provedor `evolution` em `Canal: Enviar` e `Canal: Estado`, e conectar o número do escritório. Antes da conexão: ativar o backup de conversas do WhatsApp Business. Durante 2 a 4 semanas a Mayara só conversa com os números de teste cadastrados (as mensagens de clientes reais chegam, são registradas e ignoradas pelo portão), com janela de 48 h, teto por minuto e follow-up e lembretes desligados. Isso valida filtros, `@lid`, estabilidade da conexão e reconexão com tráfego real, sem a Mayara falar com ninguém de fora. Um chip descartável continua sendo uma alternativa para quem preferir testar antes.
3. **Fase 3, abrir para leads reais:** só depois da observação, cadastrar leads reais no portão (ou abrir o modo de formulário), com a política reativa.

## Erros e segurança

| Situação | Comportamento |
|---|---|
| Webhook da Evolution sem segredo válido | Descartado em silêncio. |
| Canal desconhecido ou inativo no envio | Não envia; `envios_log` com o motivo; o chamador recebe `ok: false`. |
| Envio fora da janela ou acima do teto (Evolution) | Não envia; o chamador trata como falha (a Mayara não insiste). |
| Template sem texto equivalente (Evolution) | Não envia; erro explícito. |
| Falha de rede ou HTTP no envio | `ok: false` com o erro; sem reenvio automático (evita duplicar). |
| Evento de grupo, `fromMe`, status ou `@lid` sem telefone | Descartado antes de qualquer consulta. |

## Testes

1. **SQL (transação desfeita):** `pode_enviar` para canal desconhecido, inativo, `meta`, `evolution` dentro e fora da janela e no teto; `envios_log`.
2. **Biblioteca JS** (`canal-evolution.mjs`, com fixtures de payload): texto simples, texto estendido, `fromMe`, grupo, status, áudio, reação, `@lid` com e sem telefone alternativo, mensagem sem `key.id`.
3. **Contrato de envio:** o construtor do corpo da requisição para `meta` e `evolution` com os mesmos pedidos de entrada.
4. **Regressão da fase 1:** a mesma bateria manual de hoje (lead, comandos, agendamento) com o envio já passando por `Canal: Enviar`.
5. **Aceitação da fase 2 (chip descartável):** roteiro com mensagem de texto, mensagem enviada pelo celular (`fromMe`), grupo, áudio, queda e retomada da conexão, mensagem fora da janela, estouro do teto.

## Riscos

1. **Ferramenta de edição do n8n instável** (quedas, nós que não podem ser editados). Mitigação: workflows novos e pequenos, trocas pontuais, leitura de volta a cada passo, rollback por versão.
2. **Extrair `Processar Evento` do Gateway** mexe no caminho de produção de todo lead. Mitigação: criar o sub-workflow novo, validar com tráfego real do número de teste e só então ligar o Gateway a ele.
3. **Banimento do número** (aceito pelo usuário): reduzido por política reativa, janela, teto e chip descartável antes de qualquer decisão.
4. **Lembretes e follow-up** são mensagens iniciadas pela Mayara e aumentam o risco de banimento. Ficam desligados no provedor `evolution` até a decisão da fase 3.

## Decisões do usuário (03/10/2026)

1. **Aviso de linha caída: por e-mail.** O n8n não tem hoje nenhuma credencial de e-mail (SMTP ou Gmail). Criar uma é pré-requisito da fase 2 e é ação do usuário. `Canal: Estado` envia o e-mail e, em paralelo, grava em `mayara.avisos_admin`.
2. **Hospedagem: no mesmo servidor do n8n**, mas como serviço separado (a Evolution precisa de Postgres e Redis próprios). Verificar memória e disco do servidor antes da fase 2.
3. **Lembretes de consulta: desligados** no provedor não oficial. O follow-up "sumiu no meio" também fica desligado na fase 2. As duas políticas são `evolution_*` configuráveis e não exigem mudar workflow.

## Ainda em aberto

- **Chip descartável:** dispensado pelo usuário em 03/10 (conecta-se o número do escritório). Continua possível como etapa opcional antes da fase 2.

## Revisão de 06/10/2026: Evolution como linha única

Decisão do usuário: a Meta deixa de ser usada e o número do escritório (+55 14 99617-7022), conectado pela Evolution, passa a ser a única linha da Mayara. Esta seção prevalece sobre as fases 1 a 3 acima onde houver conflito.

1. **Estado real:** a Evolution v2.3.7 roda no Coolify (`https://evolution.camparimadvogados.com.br`), a instância `escritorio` está conectada e o webhook chega ao workflow `Canal: Receber Evolution`, que hoje só registra em `mayara.canal_eventos` (conteúdo da mensagem nunca é guardado). Validado com tráfego real: texto vira `aceito`; imagem vira `aceito` com `requer_humano = true`; eventos de conexão são descartados.
2. **Portão inalterado:** a Mayara só responde a quem está em `mayara.leads_autorizados` (hoje, um número de teste). Mensagens de outras pessoas continuam ignoradas em silêncio.
3. **Envio pela Evolution:** `Canal: Enviar` ganha o ramo `evolution`: `POST /message/sendText/<instância>` com a credencial `Evolution API`, corpo `{ number, text, delay }`, onde `delay` é o atraso humano (1 a 4 s) calculado por `atrasoHumanoMs`. A resposta é convertida para o formato da Graph API (`messages[0].id` = `key.id`), de modo que a Ponte (`Envio OK?`) não muda.
4. **Janela e administrador:** a regra de 48 h continua para leads. Quem está em `mayara.administradores` (ativo) fica fora da regra, para que alertas de erro e de falha de agendamento cheguem mesmo sem conversa recente.
5. **Troca de linha:** os pontos que têm o ID da linha Meta fixo passam a usar `escritorio`; a linha Meta fica inativa em `mayara.canais`. Quem ainda apontar para ela falha de forma segura (`canal_inativo`).
6. **Lembretes de consulta e follow-up:** workflows desativados (decisão de 03/10). Registro conhecido: o worker de lembretes avança o estágio antes de enviar e perde o lembrete se o envio falhar; corrigir antes de reativar.
7. **Ordem:** (a) migration 0014 (exceção do administrador); (b) ramo Evolution do `Canal: Enviar`; (c) `Canal: Processar Evento` e ligação do recebimento (Task 5); (d) troca dos IDs de canal, desativação dos workers, ativação do canal `escritorio` e teste ponta a ponta com o celular do usuário.
