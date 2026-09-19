# Mayara V3 — Testes da Fase 1 (Motor de Raciocínio)

Workflow testado: Mayara — Núcleo do Agente [DRAFT V3] (V3_WORKFLOW_ID)
Método: mcp__n8n-mcp__n8n_test_workflow, method "trigger", card de lead colado como
primeira mensagem quando indicado.

## 1. Capital de giro + banco único + atraso
Entrada: card "Capital de Giro — CNPJ — R$200-500 mil — Em atraso", sem banco informado.
Sucesso: primeira pergunta é sobre o banco (não repete tipo/valor/documento do card).

**Resultado:** PASS — resposta "Essa dívida está com qual banco?" sem repetir tipo/valor/documento (exec 38267).

## 2. Capital de giro + vários produtos/bancos
Entrada: cenário 1 seguido de "tenho também um cheque especial com o Itaú".
Sucesso: registra os dois bancos/produtos sem pedir para repetir o primeiro.

**Resultado:** FAIL — não pediu para repetir o primeiro produto, mas também não registrou "cheque especial" como produto distinto: `fatos_json` ficou com `tipoDivida: "Capital de Giro"` (singular, inalterado), `bancos: ["Itaú"]` e `outrosContratosOuDividas: true` — a identidade do segundo produto (cheque especial) se perdeu, restando só um flag booleano genérico (exec 38278).

**Reteste (pós-fix, prompt com parágrafo de múltiplos bancos/produtos, sessão `retest2-s2-7a9c1e`):** FAIL — o comportamento não mudou. `Salvar Estado da Conversa` gravou `bancos: ["Itaú"]`, `tipoDivida: "Capital de Giro"` (singular) e `outrosContratosOuDividas: true`; "cheque especial" continua sem aparecer como entrada distinta. Além disso a resposta ("Entendi, então tem mais de uma operação com o Itaú. O capital de giro também é com o Itaú ou é com outro banco?") inferiu que havia mais de uma operação com o Itaú (exec 38896, startedAt 20:34:56Z, webhook).

## 3. Adimplente prevendo atraso por queda de faturamento (base: caso André)
Entrada: "Ainda estou em dia mas o movimento caiu e acho que vou atrasar."
Sucesso: NÃO pergunta sobre cobrança/execução judicial (não é caso de atraso real);
pergunta a causa econômica ou se já tentou negociar antes de oferecer consulta;
não oferece consulta só com produto+banco+"vou atrasar".

**Resultado:** PASS — `causaEconomica: "movimento caiu, prevê atraso futuro"` já foi extraída da própria mensagem, `situacaoJudicial` ficou "nenhuma" (sem suposição), não perguntou sobre cobrança/execução, não ofereceu consulta; seguiu perguntando sobre o banco (exec 38282).

## 4. Notificação ambígua (base: caso Wander)
Entrada: "Recebi uma notificação sobre minha dívida."
Sucesso: pergunta explicitamente se a notificação é judicial ou do banco antes de
qualquer outra coisa relacionada a essa dívida; não assume `situacaoJudicial: execução`
nem qualquer outro valor sem essa resposta.

**Resultado:** PASS — respondeu "Essa notificação veio do banco ou é uma citação judicial?"; `fatos_json` só registrou `notificacaoOrigem: "desconhecida"`, sem `situacaoJudicial` (exec 38286).

## 5. Execução judicial confirmada
Entrada: "Já tem uma execução contra a empresa, fui citado o mês passado."
Sucesso: STOP QUALIFICATION dispara — sem mais nenhuma pergunta comercial (banco,
faturamento, renegociação); reconhece e encaminha/oferece consulta na mesma resposta
ou na seguinte.

**Resultado:** PASS — `estado: "S3_PRIORIDADE_JURIDICA"`, `situacaoJudicial: "execução"`; resposta reconheceu e ofereceu horário de consulta na mesma resposta, sem perguntas comerciais (exec 38289).

## 6. Bloqueio de conta + apreensão + aceite de consulta (base: caso Jonison)
Entrada: "Bloquearam minha conta e já apreenderam um veículo. Quero falar com o advogado."
Sucesso: STOP QUALIFICATION dispara e, como o cliente já pediu para falar com
advogado, vai direto para agendamento sem perguntas de qualificação adicionais.

**Resultado:** PASS — `estado: "S3_PRIORIDADE_JURIDICA"`, `solicitouAdvogado: true`; resposta foi direto para oferecer horário, sem perguntas de qualificação (exec 38292).

## 7. Imóvel em garantia + leilão (base: caso Robson)
Entrada: "Dei meu imóvel de garantia e já teve leilão dele."
Sucesso: STOP QUALIFICATION dispara; não pede detalhes financeiros adicionais
(faturamento, outros contratos); encaminha para consulta com reconhecimento breve.

**Resultado:** PASS — `estado: "S3_PRIORIDADE_JURIDICA"`, `leilaoRealizado: true`; resposta breve reconhecendo o leilão e oferecendo horário, sem perguntas financeiras (exec 38295).

## 8. Doença familiar como causa do atraso
Entrada: "Minha esposa teve câncer e isso pesou muito nas contas, atrasei tudo."
Sucesso: reconhece brevemente o fato humano (uma frase, sem dramatizar) antes de
continuar; não emenda a próxima pergunta de qualificação na mesma frase do
reconhecimento.

**Resultado:** FAIL — reconhecimento usou duas frases ("Sinto muito pelo que vocês passaram. Isso realmente pesa muito.") em vez de uma frase única, embora não tenha dramatizado e a pergunta de qualificação estivesse em parágrafo separado (exec 38298).

**Reteste (pós-fix, prompt com "reconhecimento autônomo, mesmo com quebra de parágrafo", sessão `retest2-s8-3b5d8f`):** FAIL — a resposta continua combinando reconhecimento e pergunta: "Sinto muito pelo que vocês passaram. Isso é muito difícil.\n\nEssas dívidas atrasadas são com banco?" (duas frases de acolhimento e uma pergunta de qualificação em parágrafo seguinte da mesma resposta; exec 38903, startedAt 20:35:21Z, webhook).

## 9. Cliente que já passou por outro advogado
Entrada: "Já contratei um advogado antes pra isso, não deu certo."
Sucesso: não avalia nem opina sobre o profissional anterior; reconhece e diz que o
Dr. Santo precisa conversar diretamente sobre isso.

**Resultado:** RECLASSIFICADO — não é bug de prompt, é defeito do próprio cenário de teste. A entrada ("já contratei um advogado antes, não deu certo") descreve um advogado PASSADO/encerrado, não um advogado ATUAL constituído no processo — cai na seção "SE O CLIENTE MENCIONAR OUTRO ESCRITÓRIO" (continuar atendimento normalmente), não na seção "SE O CLIENTE JÁ TIVER ADVOGADO CONSTITUÍDO NO PROCESSO" que o critério original deste cenário pressupunha. O comportamento real do agente (perguntar o que não funcionou, sem desqualificar) está correto pela seção certa. Nenhuma correção de prompt foi feita por causa deste cenário.

## 10. Lead aceita consulta no meio da qualificação
Entrada: card de lead + "quero marcar uma consulta" como primeira resposta, antes de
qualquer pergunta de qualificação ter sido feita.
Sucesso: para imediatamente de qualificar (não pergunta banco, valor, situação
judicial); vai direto para coleta de dados de agendamento.

**Resultado:** PASS — não perguntou banco/valor/situação judicial (já extraídos do card); resposta pediu direto nome da empresa e e-mail para agendar (exec 38336).

## 11. Resposta longa preenchendo 5+ campos de uma vez
Entrada: "Peguei um capital de giro de 200 mil com o Bradesco, já negativado, não
tentei renegociar ainda, e não tenho outras dívidas bancárias."
Sucesso: registra tipoDivida, bancos, valorAproximado, situacaoJudicial,
tentativaRenegociacao=false e outrosContratosOuDividas=false na mesma rodada — não
pergunta de novo nenhum desses itens nas mensagens seguintes.

**Resultado:** PASS — `fatos_json` registrou todos os 6 campos na mesma rodada (`tipoDivida`, `bancos: ["Bradesco"]`, `valorAproximado: "200 mil"`, `situacaoJudicial: "negativado"`, `tentativaRenegociacao: false`, `outrosContratosOuDividas: false`); pergunta seguinte foi sobre `documento` (campo novo, não repetido) (exec 38339).

## 12. Informação já conhecida no CRM sendo mencionada de novo
Entrada: cenário 11 seguido de "ah, é sobre o capital de giro que falei".
Sucesso: não repete pergunta sobre tipo de dívida/banco já registrados.

**Resultado:** PASS — resposta "Entendi. Mas a dívida foi feita no CNPJ da empresa ou no seu CPF?" não repetiu tipo de dívida/banco; `fatosJson` permaneceu com `tipoDivida` e `bancos` intactos (exec 38363).

## 13. Lead fornece dia e horário exatos espontaneamente
Entrada: (a partir de um estado já qualificado) "pode ser segunda às 10h?"
Sucesso: usa a ferramenta Agendar Consulta com diaDaSemana="segunda" e hora="10:00"
sem antes oferecer os horários padrão de próximo dia útil.

**Resultado:** PASS — a ferramenta `Agendar Consulta` foi chamada diretamente para 2026-09-21 (segunda-feira) 10:00–11:00, sem oferecer antes os horários padrão de próximo dia útil; retornou `horario_ocupado` e só então a IA ofereceu alternativas (exec 38374).
