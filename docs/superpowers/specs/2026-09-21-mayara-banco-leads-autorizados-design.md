# Banco de leads autorizados: a Mayara só atende quem está na lista

**Data:** 2026-09-21
**Status:** design aprovado pelo usuário em conversa, aguardando revisão deste documento
**Workflows afetados:** `WhatsApp - Gateway Seguro` (`FV0PEtEcTFbuoRaO`), novo workflow "Receber Lead do Formulário", `Mayara — Follow-up Sumiu no Meio [Worker]` (`CxlC28G0S3uE8X66`), `Mayara — Lembretes de Consulta [Worker]` (`YlRXMT6gEopuwFof`), ferramenta `Marcar Sem Interesse` do Núcleo V3 (`aULd8QZQ3OVFhoRg`)
**Relacionado:** `docs/superpowers/plans/2026-09-15-mayara-vinculo-campanha.md` (webhook do formulário, mensagem inicial por template)

## Motivação

Hoje o lead do formulário da campanha chega ao escritório por um cartão postado num grupo de WhatsApp, e alguém copia o telefone. Além disso, o Gateway usa uma lista fixa de telefones de teste escrita dentro do código do node `Normalizar e Filtrar Evento`, deixada de propósito como provisória até esta etapa (`docs/superpowers/plans/.progress/2026-09-05-mayara-improvements.progress.md`, Task 1.4).

Objetivo: o lead preenche o formulário, entra **diretamente** num banco de dados, e a Mayara **só atende números que estão nesse banco**.

## Decisões tomadas

| Decisão | Escolha | Origem |
|---|---|---|
| Onde fica a lista | Tabela nova no Supabase (schema `mayara`), lida pela Ponte em tempo real. O EspoCRM continua sendo o CRM. | Usuário escolheu o caminho A |
| Número que não está na lista | A Mayara não responde, o número e a mensagem são registrados, o escritório é avisado (um aviso por número) | Usuário |
| Lead que já disse "sem interesse" e preenche o formulário de novo | Reativa (novo pedido explícito de contato) | Recomendação confirmada |
| Lead com "sem interesse" que escreve de novo | A Mayara não responde, o escritório é avisado | Recomendação confirmada |
| Destino dos avisos | Mesmo número que já recebe os alertas de erro (workflow `Alertas — Erros de Workflow (Mayara)`, credencial `Bearer Auth account`) | Recomendação confirmada |
| Modo observação antes de ligar a regra | Não. Hoje só existem números de teste, então a regra liga direto | Recomendação confirmada |

## Por que não usar o espelho `crm_sync.leads`

O espelho atualiza com atraso e não percebe exclusões no EspoCRM (lacuna já documentada em `2026-09-07-painel-executivo-design.md`). Um lead novo ficaria sem resposta até o próximo sync. Por isso a lista é uma tabela própria, escrita no momento do formulário.

## Modelo de dados

Três tabelas novas no schema `mayara`, com RLS ligada e sem policies (acesso só pela credencial Postgres do n8n), no padrão das tabelas existentes. Vão para uma migration nova (`0008_...`).

### `mayara.leads_autorizados`

| Coluna | Tipo | Observação |
|---|---|---|
| `telefone` | text, PK | Formato `+55DDDNNNNNNNNN`. O mesmo número nunca duplica |
| `telefone_chave` | text, gerada, única | DDD + 8 últimos dígitos. É o campo de consulta da Ponte |
| `nome`, `email`, `empresa` | text | Dados do formulário, já sanitizados |
| `origem` | text | Por exemplo `landing_campanha_pj`, `teste` |
| `id_campanha` | text | Identificação da campanha ou UTM |
| `payload_bruto` | jsonb | O que o formulário enviou, para auditoria |
| `espocrm_lead_id` | text, nulo | Preenchido quando o lead é criado no EspoCRM (inclusive pelo retry) |
| `status` | text | `ativo`, `sem_interesse` ou `bloqueado`. Só `ativo` é atendido |
| `criado_em`, `atualizado_em` | timestamptz | Reusa o trigger `mayara.set_updated_at` |

**Por que `telefone_chave`:** o WhatsApp às vezes entrega números antigos sem o nono dígito, e o formulário traz com ele. A chave é gerada assim: com `digitos = regexp_replace(telefone, '\D', '', 'g')`, a chave é `substr(digitos, 3, 2) || right(digitos, 8)`. Comparar só DDD + 8 últimos dígitos evita barrar um lead legítimo por causa disso. Só números do Brasil (`+55`) são aceitos nesta fase.

### `mayara.numeros_nao_cadastrados`

| Coluna | Tipo | Observação |
|---|---|---|
| `telefone_chave` | text, PK | Uma linha por número |
| `telefone` | text | Como chegou do WhatsApp |
| `motivo` | text | `nao_cadastrado`, `sem_interesse` ou `bloqueado` |
| `primeira_mensagem_em`, `ultima_mensagem_em` | timestamptz | |
| `qtd_mensagens` | int | Incrementa a cada mensagem |
| `ultima_mensagem` | text | Texto da última mensagem (dado pessoal, ver Segurança) |
| `avisado_em` | timestamptz, nulo | Controla o aviso: um por número e por motivo, e um novo só se passarem 24h |
| `resolvido` | boolean | Um humano marca quando tratou o caso |

### `mayara.leads_rejeitados`

Guarda os preenchimentos do formulário que **não entraram** em `leads_autorizados`, para nada sumir em silêncio.

| Coluna | Tipo | Observação |
|---|---|---|
| `id` | bigserial, PK | |
| `motivo` | text | `telefone_invalido`, `campo_invalido` ou `acima_do_teto_por_hora` |
| `payload_bruto` | jsonb | O que o formulário enviou |
| `recebido_em` | timestamptz | |
| `resolvido` | boolean | Um humano marca depois de tratar (por exemplo, aprovar um lead retido pelo teto) |

## Fluxo de entrada: workflow "Receber Lead do Formulário"

1. **Recebe o webhook** e confere o token secreto (a maioria das ferramentas de formulário só aceita uma URL, então o token vai na própria URL). Token errado retorna 401, sem processar nada.
2. **Valida e normaliza.** Telefone para `+55DDDNNNNNNNNN`, com testes para o nono dígito, espaços, parênteses e prefixo `+55`. Nome, e-mail e empresa passam por sanitização (só texto, tamanho limitado). Registro inválido vai para `leads_rejeitados` (motivo `telefone_invalido` ou `campo_invalido`) e o escritório é avisado; ele nunca some em silêncio.
3. **Teto de novos leads por hora.** Se passar do teto, os leads excedentes vão para `leads_rejeitados` (motivo `acima_do_teto_por_hora`), aguardando aprovação humana, e o escritório é avisado. Protege contra cadastro em massa de números falsos, que faria o escritório mandar template a estranhos e derrubar a qualidade do número no WhatsApp.
4. **Grava em `leads_autorizados`** por upsert em `telefone`. Formulário repetido atualiza o mesmo lead. Se o status era `sem_interesse`, volta para `ativo`. O webhook responde "ok" só **depois** desta gravação; se ela falhar, responde erro para a ferramenta tentar de novo (seguro, porque é upsert).
5. **Em segundo plano:** cria a sessão em `mayara.session_state` já com os fatos do formulário nas chaves padronizadas (`nomeCompleto`, `nomeEmpresa`, `telefone`, `email`, `tipoDivida`, `valorAproximado`, `documento`, `situacaoJudicial`), cria o lead no EspoCRM (falha vai para a fila de retry `mayara_crm_retry` que já existe) e envia a primeira mensagem pelo template `primeiro_contato_campanha`.
6. **O envio do template fica desligado** por uma chave de configuração até a Meta aprovar o template e o formulário ter o texto de consentimento.

## Regra da Ponte: o portão no Gateway

Logo depois de `Normalizar e Filtrar Evento`, uma consulta a `leads_autorizados` (por `telefone_chave`, `status = 'ativo'`) decide:

- **Liberado:** segue o caminho de hoje. A lista fixa de telefones de teste sai do código do node. O número de teste do usuário entra na tabela com `origem = 'teste'`.
- **Fora da lista** (ou `status` diferente de `ativo`): faz upsert em `numeros_nao_cadastrados`, avisa o escritório se for a primeira vez ou se passaram 24h desde o último aviso, e **encerra sem responder**.
- **Falha na consulta:** a Mayara **não responde** (fail-closed) e o escritório é avisado. Erro de banco nunca libera atendimento a número desconhecido.
- A consulta é parametrizada e usa um índice único em `telefone_chave`.

O portão fica antes do buffer de mensagens e do debounce, para número barrado não gerar nenhum processamento.

## Interações com o resto do sistema

- **`Marcar Sem Interesse`:** além de marcar a sessão, passa a fazer `update leads_autorizados set status = 'sem_interesse'`.
- **Worker de follow-up e worker de lembretes:** a query de elegibilidade passa a exigir `status = 'ativo'` em `leads_autorizados` (join por `telefone_chave`). Assim ninguém fora da lista, ou que pediu para parar, recebe mensagem automática.
- **Lead que preenche com um telefone e escreve de outro:** cai em "não cadastrados" e o aviso permite a um humano cadastrar o número novo.

## Segurança

- Token longo e aleatório, só por HTTPS, comparação em tempo constante, nunca registrado em log; troca fácil se vazar. Se a ferramenta da agência suportar assinatura HMAC em cabeçalho, ela substitui o token na URL.
- RLS ligada nas duas tabelas, sem policies. Consultas sempre parametrizadas. Nenhum dado do formulário é tratado como confiável.
- **Sanitização antes de persistir:** os campos do formulário que viram fatos da conversa (`fatos_json`) passam por lista fixa de chaves e limite de tamanho, para texto do lead não entrar no prompt como instrução (achado da revisão de segurança de 21/09).
- **LGPD:** o formulário precisa de texto de consentimento para contato por WhatsApp. `payload_bruto` e `ultima_mensagem` guardam dado pessoal; o prazo de retenção fica como decisão futura (ver abaixo).

## Testes

- Normalizador de telefone e da chave: testes automáticos com `node:test` (nono dígito, com e sem `+55`, espaços, parênteses, número inválido, número estrangeiro rejeitado), no estilo dos testes da função de lacunas.
- Migration: aplicar num banco de teste e conferir constraints, chave gerada, unicidade e RLS.
- Webhook: POST de teste com dados falsos e `origem = 'teste'`, com o envio do template desligado, conferindo a linha na tabela, a sessão e o lead de teste no CRM.
- Portão: (1) número de teste liberado responde; (2) segundo telefone não cadastrado não recebe resposta, gera uma linha e um único aviso; (3) número com `sem_interesse` não recebe resposta e gera aviso; (4) consulta falhando não libera atendimento.
- Repetir os cenários de regressão da V3 pela Ponte com o número de teste liberado.

## Implantação e reversão

Aplicar a migration, cadastrar os números de teste, publicar o workflow do formulário (com o envio do template desligado) e por último inserir o portão no Gateway. Reversão do portão: restaurar a versão anterior do Gateway pelo histórico de versões do n8n (a lista fixa de teste continua no histórico até ser removida).

## Fora de escopo e dependências externas

- **Payload real da agência:** ainda não se sabe como o formulário chega (webhook, planilha, integração). O receptor é escrito de forma defensiva e o parsing final espera o exemplo real da agência. Lista de perguntas a enviar à agência foi entregue ao usuário em 21/09.
- **Aprovação do template `primeiro_contato_campanha` pela Meta** e o **texto de consentimento** no formulário: bloqueiam o envio da primeira mensagem, não a gravação do lead.
- **Prazo de retenção** de `payload_bruto` e `ultima_mensagem`, e **validade** da autorização de um lead (hoje sem expiração): decisões futuras.
- **Correções da revisão de segurança que não são deste design:** upgrade do Next.js, papel de banco somente leitura para o painel, atualização do n8n (instância na 2.10.2), lock real e claim atômico do buffer na Ponte.

## Riscos conhecidos

- Duas gravações (Supabase e EspoCRM): o retry cobre falha do CRM, mas um lead pode ficar liberado por instantes sem lead no CRM.
- Ligar o portão sem modo observação: se `telefone_chave` tiver algum caso de borda não previsto, um lead legítimo fica sem resposta. O aviso ao escritório e o teste com várias formas de escrita do mesmo número reduzem o risco.
- O código do node do Gateway hoje não está versionado no repositório; a mudança precisa ser exportada e versionada junto, para não repetir a deriva encontrada na Ponte.
