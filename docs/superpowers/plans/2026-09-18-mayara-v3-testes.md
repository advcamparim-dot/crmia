# Mayara V3 — Testes da Fase 1 (Motor de Raciocínio)

Workflow testado: Mayara — Núcleo do Agente [DRAFT V3] (V3_WORKFLOW_ID)
Método: mcp__n8n-mcp__n8n_test_workflow, method "trigger", card de lead colado como
primeira mensagem quando indicado.

## 1. Capital de giro + banco único + atraso
Entrada: card "Capital de Giro — CNPJ — R$200-500 mil — Em atraso", sem banco informado.
Sucesso: primeira pergunta é sobre o banco (não repete tipo/valor/documento do card).

## 2. Capital de giro + vários produtos/bancos
Entrada: cenário 1 seguido de "tenho também um cheque especial com o Itaú".
Sucesso: registra os dois bancos/produtos sem pedir para repetir o primeiro.

## 3. Adimplente prevendo atraso por queda de faturamento (base: caso André)
Entrada: "Ainda estou em dia mas o movimento caiu e acho que vou atrasar."
Sucesso: NÃO pergunta sobre cobrança/execução judicial (não é caso de atraso real);
pergunta a causa econômica ou se já tentou negociar antes de oferecer consulta;
não oferece consulta só com produto+banco+"vou atrasar".

## 4. Notificação ambígua (base: caso Wander)
Entrada: "Recebi uma notificação sobre minha dívida."
Sucesso: pergunta explicitamente se a notificação é judicial ou do banco antes de
qualquer outra coisa relacionada a essa dívida; não assume `situacaoJudicial: execução`
nem qualquer outro valor sem essa resposta.

## 5. Execução judicial confirmada
Entrada: "Já tem uma execução contra a empresa, fui citado o mês passado."
Sucesso: STOP QUALIFICATION dispara — sem mais nenhuma pergunta comercial (banco,
faturamento, renegociação); reconhece e encaminha/oferece consulta na mesma resposta
ou na seguinte.

## 6. Bloqueio de conta + apreensão + aceite de consulta (base: caso Jonison)
Entrada: "Bloquearam minha conta e já apreenderam um veículo. Quero falar com o advogado."
Sucesso: STOP QUALIFICATION dispara e, como o cliente já pediu para falar com
advogado, vai direto para agendamento sem perguntas de qualificação adicionais.

## 7. Imóvel em garantia + leilão (base: caso Robson)
Entrada: "Dei meu imóvel de garantia e já teve leilão dele."
Sucesso: STOP QUALIFICATION dispara; não pede detalhes financeiros adicionais
(faturamento, outros contratos); encaminha para consulta com reconhecimento breve.

## 8. Doença familiar como causa do atraso
Entrada: "Minha esposa teve câncer e isso pesou muito nas contas, atrasei tudo."
Sucesso: reconhece brevemente o fato humano (uma frase, sem dramatizar) antes de
continuar; não emenda a próxima pergunta de qualificação na mesma frase do
reconhecimento.

## 9. Cliente que já passou por outro advogado
Entrada: "Já contratei um advogado antes pra isso, não deu certo."
Sucesso: não avalia nem opina sobre o profissional anterior; reconhece e diz que o
Dr. Santo precisa conversar diretamente sobre isso.

## 10. Lead aceita consulta no meio da qualificação
Entrada: card de lead + "quero marcar uma consulta" como primeira resposta, antes de
qualquer pergunta de qualificação ter sido feita.
Sucesso: para imediatamente de qualificar (não pergunta banco, valor, situação
judicial); vai direto para coleta de dados de agendamento.

## 11. Resposta longa preenchendo 5+ campos de uma vez
Entrada: "Peguei um capital de giro de 200 mil com o Bradesco, já negativado, não
tentei renegociar ainda, e não tenho outras dívidas bancárias."
Sucesso: registra tipoDivida, bancos, valorAproximado, situacaoJudicial,
tentativaRenegociacao=false e outrosContratosOuDividas=false na mesma rodada — não
pergunta de novo nenhum desses itens nas mensagens seguintes.

## 12. Informação já conhecida no CRM sendo mencionada de novo
Entrada: cenário 11 seguido de "ah, é sobre o capital de giro que falei".
Sucesso: não repete pergunta sobre tipo de dívida/banco já registrados.

## 13. Lead fornece dia e horário exatos espontaneamente
Entrada: (a partir de um estado já qualificado) "pode ser segunda às 10h?"
Sucesso: usa a ferramenta Agendar Consulta com diaDaSemana="segunda" e hora="10:00"
sem antes oferecer os horários padrão de próximo dia útil.
