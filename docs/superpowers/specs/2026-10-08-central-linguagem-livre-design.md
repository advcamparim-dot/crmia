# Central de Comando em linguagem livre: ações sem "/"

Data: 2026-10-08
Status: rascunho para revisão do usuário
Relacionados: `2026-10-03-mayara-central-de-comando-design.md` (comandos com "/" e ensino), `2026-10-08-paineis-ceo-administrador-design.md`

## Objetivo

O administrador escreve para o número do escritório como falaria com uma assistente: *"assuma o Gilberto"*, *"pause a Mayara"*, *"como estão os leads de hoje?"*, *"fale com a Solange"*. A Central entende a intenção, confirma o que for arriscado e executa. Os comandos com "/" continuam existindo como via exata, sem IA.

Sucesso:
1. Cada mensagem livre vira **uma** destas intenções: ensinar, consultar, agir, ou conversar. Nunca uma ação inventada.
2. **Nenhuma ação com efeito é executada sem a confirmação "sim"** do administrador.
3. A IA **nunca escreve SQL nem escolhe a função a executar**; ela só preenche um formulário fechado, e o código valida.
4. Se a IA falhar ou a frase for ambígua, nada é executado e a Central pede para repetir ou sugere o comando com "/".

## Situação atual (verificada em 08/10/2026)

- O modo exclusivo (`canal_comando_exclusivo = true`) está ligado: toda mensagem do administrador vai para a Central.
- Mensagem com "/" é interpretada por regra fixa (`status`, `ligar`, `desligar`, `assumir`, `devolver`, `regras`, `desfazer`, `reativar`, `ajuda`).
- Mensagem **sem "/"** cai no ramo `livre`, que hoje só **ensina**: o nó `Interpretar Instrucao` (Claude Sonnet 4.5, temperatura 0) responde `instrucao`, `duvida` ou `pergunta`. Só `instrucao` gera uma regra pendente, que vale após "sim".
- "sim" e "não" já funcionam sem "/" (`confirmar_sim`, `confirmar_nao`) e agem **sobre a instrução pendente**.
- As ações existentes são funções do banco chamadas por `mayara.executar_central(fn, arg, arg2, autor)`: `status`, `regras`, `assumir`, `devolver`, `desfazer`, `reativar`, `confirmar_*`, `criar_pendente`.
- Há auditoria e idempotência por mensagem (`mayara.comandos_log`, `registrar_comando`, `finalizar_comando`) e resposta pelo canal normal (`Canal: Enviar`, origem `central`).
- A abordagem controlada de um lead existe no banco (`autorizar_abordagem`, janela de 24 h, migration 0024), mas não tem comando.

## Decisões de desenho (confirmar na revisão)

1. **Primeira versão cobre estas ações** (lista fechada):

| Intenção | Ação | Confirma? | Reaproveita |
|---|---|---|---|
| ensinar | criar regra de atendimento | sim (já é assim) | `criar_pendente` |
| consultar | status geral; contagem de leads (hoje, semana, mês); situação de um lead; listar regras | não | `status`, `regras`, novas funções de leitura |
| agir | pausar a Mayara; ligar a Mayara | sim | `desligar`/`ligar` |
| agir | assumir um lead; devolver um lead | sim | `assumir_lead`, `devolver_lead` |
| agir | desfazer ou reativar uma regra | sim | `desfazer_instrucao`, `reativar_instrucao` |
| agir | abordar um lead (a Mayara escreve primeiro) | **sim, depois do rascunho** | `autorizar_abordagem` + envio |
| conversar | agradecimento, dúvida solta | não | resposta curta |

2. **Fora da primeira versão:** enviar texto livre a um lead ("diga ao João que..."), alterar dados no CRM, apagar qualquer coisa, mudar configurações, abordar vários leads de uma vez, e qualquer ação sobre outro administrador.
3. **Um pendente por vez** (regra ou ação). Se chegar uma nova proposta com outra pendente, a Central avisa e pede "sim" ou "não" antes. A pendência expira em 10 minutos.
4. **Citar o lead pelo nome é permitido.** Se houver zero ou mais de um candidato, a Central lista (nome e final do telefone) e pede para repetir com o telefone. Não há desambiguação em vários turnos na primeira versão.
5. **Sem contexto de lead no prompt da IA.** O modelo recebe só a mensagem do administrador e a lista fixa de intenções. Texto vindo de leads (descrições, conversas) nunca entra nessa chamada, o que fecha a porta a injeção de instruções por dados externos.

## Arquitetura

```
mensagem sem "/"  ──►  Interpretar (LLM, formulário fechado)  ──►  Validar (código)  ──►  Roteador
                                                                          │
              ┌──────────── consultar: função de leitura ────────────────┤
              ├──────────── agir: grava ação pendente + pede "sim" ──────┤
              └──────────── ensinar / conversar: como hoje ──────────────┘
"sim" ──► executa a ação pendente (ou a regra pendente) pela via que já existe
```

### Unidades

| Unidade | Faz | Depende de |
|---|---|---|
| `interpretar.mjs` (biblioteca testada) | Define o formulário fechado, valida a resposta da IA, normaliza telefone, monta o texto de confirmação | nada |
| Sub-workflow `Central: Interpretar Linguagem Livre` | Chama o modelo, aplica `interpretar.mjs`, devolve `{tipo, acao, resposta...}` no formato que o roteador atual já entende | `interpretar.mjs`, banco |
| `mayara.acoes_pendentes` + funções | Guardam e executam a ação confirmada, com expiração | banco |
| Funções de leitura (`buscar_leads_por_nome`, `contagem_leads`, `situacao_lead`) | Respondem consultas sem efeito colateral | `leads_autorizados`, `session_state`, `crm_sync.leads` |
| Ramo `livre` do `Roteador` | Passa a chamar o sub-workflow novo, atrás da chave `central_linguagem_livre` | os acima |

### Formulário fechado da IA

```json
{ "intencao": "ensinar|consultar|agir|conversar",
  "acao": "status|contagem_leads|situacao_lead|listar_regras|pausar|ligar|assumir|devolver|desfazer_regra|reativar_regra|abordar|null",
  "alvo": { "nome": "texto ou null", "telefone": "texto ou null", "numero_regra": "inteiro ou null" },
  "periodo": "hoje|semana|mes|null",
  "regra": "texto curto ou null",
  "duvida": "pergunta curta ou null" }
```

O código **rejeita** qualquer valor fora desta lista, qualquer campo extra com efeito, e qualquer `intencao = agir` sem `acao`. A IA não vê SQL e não conhece os nomes das funções.

### Ações pendentes

```sql
mayara.acoes_pendentes (
  id bigserial primary key,
  acao text not null check (acao in ('pausar','ligar','assumir','devolver','desfazer_regra','reativar_regra','abordar')),
  argumentos jsonb not null default '{}',
  resumo text not null,                 -- o texto mostrado na confirmação
  autor_chave text not null,
  estado text not null default 'pendente' check (estado in ('pendente','confirmada','cancelada','expirada')),
  criado_em timestamptz not null default now(),
  confirmar_ate timestamptz not null
)
```

`confirmar_pendente('sim')` passa a olhar **as duas** tabelas (instruções e ações), nesta ordem: ação pendente, depois instrução pendente (nunca as duas ao mesmo tempo, pela decisão 3).

### Abordar um lead (a ação mais sensível)

1. O administrador diz "fale com o Gilberto" (ou "retome o Gilberto").
2. A Central resolve o lead, mostra o **rascunho** da mensagem (gerado com o nome, a campanha e o histórico disponível, no estilo e nas proibições da Mayara) e pede "sim".
3. Com "sim": `autorizar_abordagem` (janela de 24 h), carrega a sessão com o histórico, envia pelo canal normal (prefixo "Mayara:") e grava a mensagem na memória da Mayara.
4. Recusa automática se o lead estiver `sem_interesse` ou `bloqueado`, se a janela de envio estiver vencida demais, ou se o canal estiver fora do ar.
5. Limite: no máximo 10 abordagens por hora e 40 por dia por esta via, para proteger o número do escritório.

## Segurança

- Só mensagens do número de administrador chegam à Central (já verificado no banco antes de qualquer interpretação).
- Toda interpretação e toda execução ficam registradas no log de comandos, com a frase original.
- Nenhuma ação sobre dados (CRM, apagar, configurar) está na lista; adicionar uma ação exige mudar a biblioteca, o banco e os testes.
- A IA não executa nada: a ação sai do código que valida o formulário, e só depois do "sim".
- Falha do modelo, resposta inválida ou frase ambígua: resposta "Não entendi com segurança; use /ajuda" e **nenhuma execução**.
- Chave `central_linguagem_livre` desliga tudo e volta ao comportamento de hoje (ensino livre, ações com "/").

## Testes

- **Biblioteca (`interpretar.mjs`):** testes unitários para formulário válido, valores fora da lista, ação sem alvo, telefone inválido, nome vazio, instrução disfarçada de ação ("apague tudo", "mande para todos"), texto muito longo.
- **Banco:** testes SQL em transação com `rollback`: ação pendente criada, confirmada, cancelada e expirada; segunda proposta bloqueada; "sim" sem pendente; ação executada uma única vez; busca por nome com 0, 1 e vários resultados.
- **Conjunto de frases de aceitação (30 a 40 em português):** variações de cada intenção, mais frases perigosas ou ambíguas. Critério: todas as frases de efeito resultam em pendência (nunca em execução direta); nenhuma frase perigosa vira ação; consultas respondem direto; a taxa de acerto da intenção nas frases normais é registrada no relatório.
- **Aceitação pelo WhatsApp:** roteiro com `assuma o Gilberto` → "sim"; `devolva o Gilberto`; `pause a Mayara` → "não"; `quantos leads chegaram hoje?`; uma frase ambígua; e uma abordagem completa com rascunho.

## Fases

1. **Banco:** `acoes_pendentes`, funções de confirmação e de leitura, com testes.
2. **Biblioteca `interpretar.mjs`** com testes e o conjunto de frases (sem chamar a IA).
3. **Sub-workflow e ligação ao `Roteador`**, atrás da chave desligada; teste do conjunto de frases contra o modelo real; ligar a chave.
4. **Abordar um lead** (rascunho, limites, memória) e leitura do histórico da conversa, junto com a habilidade de ler o histórico de que falamos.

## Fora do escopo e riscos

- **Nome ambíguo:** a primeira versão não conduz diálogo de desambiguação; pede o telefone.
- **A IA pode errar a intenção.** Mitigação: confirmação de tudo que tem efeito, lista fechada, e acompanhamento da taxa de acerto no conjunto de aceitação.
- **Custo:** uma chamada curta ao modelo por mensagem livre do administrador.
- **Histórico de conversas de outro canal** (como a do Flávio) só entra se for importado; o rascunho de "abordar" avisa quando o histórico for curto ou ausente.

## Perguntas em aberto

1. A lista de ações da primeira versão está certa? Falta alguma que você use no dia a dia?
2. Limites de abordagem: 10 por hora e 40 por dia servem?
3. Quer que "pausar" e "ligar" a Mayara exijam confirmação (proposto: sim) ou executem direto?
4. Quando a frase citar um lead pelo nome e houver mais de um, prefere a lista com final do telefone (proposto) ou que a Mayara simplesmente recuse?
