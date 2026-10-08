# Painéis do Camparim: Painel do CEO e Central de Atenção do Administrador

Data: 2026-10-08
Status: rascunho para revisão do usuário
Relacionados: `2026-09-07-painel-executivo-design.md` (painel atual), `2026-10-03-mayara-central-de-comando-design.md`, `2026-10-07-lead-grupo-agencia/` (entrada de leads pelo grupo da agência)

## Objetivo

O CEO abre o painel e, em menos de 30 segundos, entende **quanto dinheiro entrou, quanto pode entrar, onde estão as oportunidades e o que trava o crescimento**. O administrador abre outra tela e vê **o que exige intervenção hoje**, com responsável, tempo parado e ação sugerida.

Sucesso:
1. Todo número do painel pode ser explicado: o usuário clica e vê os registros que o compõem.
2. Onde não há dado, o painel diz "sem dados ainda". Nunca mostra zero que pareça resultado.
3. O que a Mayara faz (atendimentos, falhas, transferências) fica visível sem depender do CRM.
4. Receita é sempre honorário, nunca o valor da dívida do cliente.

## Decisões já tomadas com o usuário

1. **Contratos, propostas, pagamentos e casos são cadastrados no EspoCRM** (entidades `CContrato`, `CProposta`, `CPagamento`, `CCasoJuridico`). O painel lê da cópia sincronizada (`crm_sync`).
2. **Duas telas:** `/ceo` (Painel do CEO) e `/administrador` (Central de Atenção + saúde da Mayara). Cada indicador é clicável e abre o detalhamento.
3. **Gasto com anúncios por lançamento manual mensal**, por campanha, em formulário no próprio painel. Integração com o Meta Ads fica para depois.
4. Abordagem técnica: **evoluir o painel atual** (Next.js + Supabase, `painel.camparimadvogados.com.br`), sem ferramenta nova.

## Fora do escopo desta especificação

- Integração automática com o Meta Ads.
- Painéis separados por área (Comercial, Financeiro, Jurídico, Marketing). As áreas viram **seções** das duas telas; painéis próprios só se o uso pedir.
- Acesso por papéis. O login continua sendo a senha única atual; papéis (CEO x administrador) ficam para uma fase posterior.
- Prazos processuais e qualquer inferência jurídica automática.
- Probabilidade de fechamento gerada por IA. Previsões usam apenas histórico real.
- Indicadores de qualidade da Mayara que dependem de auditoria subjetiva (agendamento prematuro, pergunta redundante). Entram só quando houver critério objetivo e registro (ver Fase 5).

## Estado atual (auditoria de 08/10/2026)

- **Painel:** uma página (`/painel-executivo`, 313 linhas) com resumo, comercial, funil, financeiro, jurídico e alertas, lendo `crm_sync` com filtro de período. Login por senha única, limite de tentativas por IP, cookie assinado.
- **CRM (contagens):** 59 leads, 186 tarefas, 263 conversas e 1.364 mensagens de IA. **Zero** reuniões, propostas, contratos, pagamentos, casos, campanhas, oportunidades e incidentes de IA.
- **Banco da Mayara (mesmo Supabase, schema `mayara`):** envios, eventos do canal, estado do canal, cartões lidos do grupo, leads autorizados, sessões, falhas de CRM, instruções ensinadas.
- **Sincronização:** workflow n8n a cada 5 min (6 entidades) e rotina diária das 04:00 que remove registros apagados do CRM. Leads sincronizam em segundos.
- **Gasto com anúncios:** não existe em nenhum lugar.
- **Campanha do lead:** só aparece dentro do texto da descrição, sem campo próprio.

## Arquitetura

```
EspoCRM --(n8n, 5 min)--> crm_sync.* --\
Banco da Mayara (mayara.*) -------------+--> schema painel (views) --> app Next.js
Gasto manual (painel.gasto_anuncios) ---/                              /ceo  /administrador
```

- O app lê **apenas views do schema `painel`**, com um papel de banco **somente leitura** (`painel_leitura`). As views devolvem agregados e colunas mínimas. Detalhamento mostra nome e **final do telefone** mais link para o registro no CRM; telefone completo e conteúdo de conversa não aparecem no painel.
- Cada indicador é uma função pura em `lib/` (uma por domínio: `ceo.ts`, `administrador.ts`, `mayara.ts`) que recebe o período e filtros e devolve `{ valor, anterior, variacao, meta?, estado }`, onde `estado` é `ok`, `sem_dados` ou `atrasado`.
- A tela só formata o que as funções devolvem. Isso permite testar os números sem a interface.

### Unidades e fronteiras

| Unidade | Faz | Depende de |
|---|---|---|
| Views `painel.*` | Aplicam as definições dos indicadores no banco | `crm_sync`, `mayara` |
| `lib/periodo.ts` (existe) | Períodos e comparação com o anterior | nada |
| `lib/ceo.ts` | Indicadores executivos, funil, campanhas, pipeline, previsão | views |
| `lib/administrador.ts` | Central de Atenção e saúde das integrações | views |
| `lib/mayara.ts` | Métricas da Mayara | views |
| Formulário de gasto | Grava `painel.gasto_anuncios` | login existente |
| Telas `/ceo`, `/administrador` | Layout, filtros, clique para detalhar | `lib/*` |

## Base de dados (Fase 1)

Novos elementos, todos com teste de banco:

1. **Campo `campanha` no lead** (campo próprio no EspoCRM). O fluxo do grupo e a carga passam a preenchê-lo; leads já carregados são corrigidos a partir da descrição.
2. **`crm_sync.lead_historico_status`**: `(id, lead_id, status_anterior, status_novo, mudou_em)`, preenchida pela sincronização quando o status muda. Sem esse histórico não há funil por coorte; ele **só existe daqui para frente** (o painel informa "histórico desde dd/mm").
3. **`painel.gasto_anuncios`**: `(campanha, mes, valor, criado_em)` com chave única `(campanha, mes)`.
4. **Auditoria de campos** das entidades `CProposta`, `CContrato`, `CPagamento`, `CCasoJuridico`, `Meeting` e `Task` (nomes reais dos campos de valor, status, datas e responsável) antes de escrever qualquer view financeira. A lista de campos do painel atual vem do workflow de sincronização e será conferida contra o CRM.
5. **Separação passivo x honorário:** o lead guarda o valor do passivo (hoje faixa em texto); contrato guarda honorários. Passivo nunca entra em receita.
6. **Papel `painel_leitura`** e schema `painel` com as views.

## Painel do CEO (`/ceo`)

Filtros no topo: período (hoje, 7, 30, 90 dias, personalizado), campanha, responsável. Todo indicador mostra o período, o anterior e a variação percentual; meta quando houver.

**Linha 1, indicadores:** leads recebidos, leads qualificados, consultas realizadas, taxa de comparecimento, contratos fechados, honorários contratados, honorários recebidos, contas a receber, CAC.

**Linha 2:** funil comercial por etapa com conversão entre etapas, e desempenho por campanha (investimento, leads, qualificados, clientes, receita).

**Linha 3:** pipeline (propostas abertas, valor, tempo médio de fechamento, propostas sem próxima ação) e previsão de recebimentos em 30, 60 e 90 dias.

**Linha 4:** evolução mensal e resumo jurídico (casos ativos, novos no mês, sem responsável), em agregados.

### Definições (primeira versão)

| Indicador | Definição | Estado inicial |
|---|---|---|
| Lead recebido | Lead criado no período | Pronto |
| Lead qualificado | Status fora de `New` e `Dead` (refinada depois com os fatos da Mayara) | Pronto |
| Consulta realizada | Reunião com status `Held` | Sem dados até haver reuniões |
| Comparecimento | Realizadas ÷ agendadas no período | Sem dados |
| Contrato fechado | `CContrato` com status `Assinado` e data de assinatura no período | Sem dados |
| Honorários contratados | Soma do valor de honorários dos contratos assinados | Sem dados |
| Honorários recebidos | Soma de pagamentos `Pago` com data de pagamento no período | Sem dados |
| Contas a receber | Parcelas não pagas, separadas em a vencer e vencidas | Sem dados |
| Honorários de êxito | Linha separada, nunca somada a recebidos nem a previsão garantida | Sem dados |
| CAC | Gasto do período ÷ contratos fechados no período, por campanha | Depende do lançamento de gasto |
| Custo por lead | Gasto ÷ leads da campanha | Depende do lançamento de gasto |
| ROAS sobre recebimentos | Honorários recebidos atribuídos ÷ gasto | Depende de contratos e gasto |

### Funil por coorte

Etapas: lead recebido, primeiro contato, respondeu, qualificado, consulta oferecida, consulta aceita, consulta agendada, consulta realizada, proposta apresentada, contrato assinado, primeiro pagamento. A conversão é calculada sobre **leads de uma mesma coorte** (os criados no período) que alcançaram a etapa seguinte, com uma coluna "em andamento" para os que ainda podem avançar. Nunca divide números de períodos diferentes. Etapas sem registro ainda aparecem como "sem dados", não como zero.

## Central de Atenção e saúde da Mayara (`/administrador`)

Cada alerta mostra: **o que é, responsável, desde quando, ação sugerida e link**. Lista ordenada por gravidade e tempo parado.

| Alerta | Fonte |
|---|---|
| Canal do WhatsApp caído | `mayara.canal_estado` |
| Lead novo sem atendimento além do prazo | leads sem conversa e sem tarefa, por idade |
| Cartão do grupo ilegível ou falha ao criar no CRM | `mayara.cartoes_agencia` |
| Falha permanente de gravação no CRM | `mayara.crm_retry_failed` |
| Falha de agendamento | tarefas de alerta de agendamento |
| Tarefas vencidas e sem responsável | `Task` |
| Lead urgente sem responsável | transferências para humano sem tarefa tratada |
| Pagamento vencido | `CPagamento` (quando houver) |
| Erro de integração | falhas de sincronização (`crm_sync.sync_failures`) e sincronização atrasada |

**Saúde da Mayara:** leads atendidos, tempo até a primeira abordagem, taxa de resposta, transferências para humano, falhas de envio, consultas agendadas, mensagens por origem. Fonte: `mayara.*` e conversas do CRM.

**Painel de sincronização:** última sincronização de cada entidade e se está atrasada. Uma entidade parada há mais de um dia vira alerta.

## Gasto com anúncios

Formulário no painel (apenas usuário logado): campanha, mês, valor em reais. Lançar de novo o mesmo par campanha e mês atualiza o valor. Sem lançamento no período, CAC e custo por lead aparecem como "sem dados", nunca como zero.

## Segurança, privacidade e erros

- Papel de banco somente leitura e views mínimas; o app não tem acesso às tabelas de origem.
- Agregados por padrão. Detalhamento: nome, final do telefone, status, link no CRM.
- Login atual preservado (senha única, limite por IP, cookie assinado). Papéis ficam para depois.
- Toda tela mostra "atualizado há X min". Falha de banco ou de sincronização aparece como aviso na tela, não como zero.
- O painel não infere prazos processuais nem probabilidades.

## Testes

- Funções de indicador: testes unitários com dados fictícios (Vitest, já no projeto), incluindo: período vazio, divisão por zero, coorte incompleta, passivo x honorário e êxito separado.
- Views e funções no banco: testes SQL em transação com `rollback`, como nas migrations existentes.
- Aceitação por fase com dados reais conferidos contra o CRM (contagens batem).
- Verificação visual de cada tela com login real antes de entregar a fase.

## Fases de entrega

Cada fase termina utilizável, com seu plano e sua aprovação.

1. **Base de dados:** campo campanha, histórico de status, gasto, papel e views, auditoria de campos.
2. **Central de Atenção e painel da Mayara** (`/administrador`): já tem dados reais.
3. **Painel do CEO com funil e campanhas** com o que existir (leads por campanha, qualificação, gasto lançado).
4. **Financeiro e previsão** conforme contratos e pagamentos forem cadastrados no CRM.
5. **Jurídico, produtividade e qualidade avançada da Mayara** (com critérios objetivos de auditoria registrados em tabela própria).

## Riscos e pendências

- **Dados que ainda não existem:** contratos, pagamentos e propostas só aparecem quando a equipe os cadastrar. O painel funciona vazio, mas sem esses cadastros a parte financeira não tem o que mostrar.
- **Histórico de etapas começa agora:** conversões por coorte só ficam confiáveis depois de algumas semanas.
- **Nomes de campos das entidades financeiras ainda não conferidos** (Fase 1, item 4).
- **Login único:** quem tem a senha vê tudo. Aceitável para a fase inicial, a tratar antes de dar acesso a mais pessoas.
- **Metas:** o texto original pede meta por indicador. Proposta: tabela simples de metas por indicador e mês, na Fase 3, só se você quiser usar.

## Perguntas em aberto

1. Quem mais, além de você, vai acessar cada tela? (define quando faz sentido criar papéis)
2. Existe meta numérica hoje (leads por mês, contratos por mês, honorários por mês)?
3. Qual é o prazo aceitável para "lead novo sem atendimento" (por exemplo, 30 minutos em horário comercial)?
