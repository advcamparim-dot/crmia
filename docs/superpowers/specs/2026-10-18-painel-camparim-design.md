# Painel Camparim: tela inicial configurável, fila de atenção, funil, metas e contratos

**Data:** 2026-10-18
**Substitui o foco do painel de** `2026-09-07-painel-executivo-design.md` (a identidade visual, o login e a hospedagem continuam; o conteúdo e a origem dos dados mudam). Compatível com `2026-10-18-confiabilidade-mayara-painel-design.md`: as sessões revogáveis desse documento entram aqui, e o "funil por coorte", que lá ficou para depois, é entregue aqui.

## Intenção

O Dr. Santo precisa abrir um único endereço e saber o que aconteceu no escritório e o que depende dele agora. Hoje o painel existe em `painel.camparimadvogados.com.br`, mas mostra tudo zerado por dois motivos:

1. **Defeito:** o app não consegue abrir conexão com o banco (erro `SELF_SIGNED_CERT_IN_CHAIN` nos logs do Coolify) e, quando uma consulta falha, o código mostra `0` e `R$ 0,00` como se fossem dados reais.
2. **Origem dos dados errada:** ele só lê o espelho do EspoCRM, e o CRM só tem leads, todos como "Novo". Reuniões, oportunidades, contratos, pagamentos e casos têm 0 registros, porque o escritório não os registra lá. O que acontece de verdade (conversas, follow-ups, consultas combinadas por WhatsApp, transferências para a equipe) fica no Supabase e o painel nunca o lê.

Quem usa: só o Dr. Santo (uma pessoa, login único), no computador e às vezes no celular. Não há equipe a configurar.

## Resultado esperado

Uma tela inicial de quadros que o Dr. Santo arruma como quiser, com dados reais da Mayara, do CRM, da agenda e dos contratos, e com avisos claros quando um dado não está disponível.

## Metas, não metas e antimetas

**Metas**
- Tela inicial com quadros arrastáveis e redimensionáveis, com o arranjo guardado no banco e válido no computador e no celular.
- Uma barra de períodos (Hoje, Ontem, Semana, Mês, Período livre) que vale para todos os quadros.
- Fila "Precisa de você" com as sete situações abaixo.
- Funil por etapa do lead (entrou, avançou, perdeu), metas do mês e, mais tarde, previsão.
- Registro de contratos e parcelas por frase livre no WhatsApp, e controle do status das parcelas no painel.

**Não metas**
- Não replicar o EspoCRM nem substituí-lo; o CRM continua existindo, mas o painel não depende dele para o que importa.
- Sem multiusuário, papéis ou permissões.
- O painel não envia mensagens, não aprova propostas e não altera a Mayara, a régua de follow-up nem a liberação automática.
- Sem previsão de vendas antes de existir histórico suficiente.

**Antimetas** (seria falha mesmo que "funcionasse")
- Mostrar zero ou valor vazio quando o dado não pôde ser lido. Falha de leitura aparece como "indisponível", por quadro.
- Mostrar texto de conversa de lead no painel. A fila mostra tipo, nome, espera e horário, não o conteúdo da mensagem (decisão minha, ver "Decisões minhas").
- Aceitar um contrato cuja soma não bate com o total, sem aviso e confirmação.

## Restrições e o que já existe

- App Next.js 14 em `painel-executivo/`, hospedado no Coolify; banco Supabase Postgres (`wuhvlvsolewslkawazlq`) acessado por `pg` com `SUPABASE_DB_URL`. Manter o stack.
- Identidade "Câmara" do documento de 07/09: verde-floresta (`#0d1310`, `#141d18`) e latão (`#b08a5a`, `#c9ab7d`), Lora, Karla e IBM Plex Mono, abas estilo divisória de fichário.
- Login único com cookie assinado por HMAC (existente); passa a usar sessão revogável no servidor, como definido no design de confiabilidade (token com hash guardado, logout revoga).
- Papel de banco `painel_leitura` hoje só lê as views do schema `painel`. A leitura continuará por views; as escritas (ver abaixo) passam por funções específicas, não por acesso livre às tabelas.
- Coolify tem dois aplicativos chamados `painel-executivo-camparim`; um está parado ("Exited"). A limpeza do duplicado é decisão do Dr. Santo no Coolify.
- Não alterar nada que mude o comportamento da Mayara, da régua ou da abordagem automática, hoje ligadas.

## O que foi decidido

### Tela inicial

Barra de períodos no topo; faixa de números; fila "Precisa de você" como quadro principal; "Leads por etapa" ao lado; embaixo, follow-ups do dia, fontes de lead e tempo de resposta. O botão "Configurar" libera os quadros para arrastar, redimensionar, adicionar do catálogo e esconder. O arranjo é guardado no banco. No celular os quadros empilham em uma coluna, com a fila primeiro. Cada quadro é independente: se um falha, os demais continuam.

Faixa de números: leads novos, em conversa, sem resposta, follow-ups enviados, consultas marcadas e estado do canal WhatsApp.

### Fila "Precisa de você"

Itens, do mais urgente para o menos (o Dr. Santo confirmou os sete):
1. Lead que respondeu e está esperando a equipe, com há quanto tempo.
2. Transferência para a equipe (a Mayara passou a conversa).
3. Agendamento que falhou e precisa de confirmação manual.
4. Consulta nas próximas 24 horas, com o horário.
5. Parcela atrasada, com valor e dias de atraso.
6. Fim da sequência de follow-up (14 mensagens sem resposta, lead em revisão humana).
7. Problema no canal (WhatsApp desconectado ou falhas de envio).

Cada item tem um botão para abrir a conversa ou a ficha do lead e some da fila quando a situação se resolve.

### Metas

Quadro de metas do mês com velocímetro. O Dr. Santo escolhe o que acompanhar entre **consultas marcadas**, **contratos fechados** e **receita**; define o valor da meta de cada um e o painel mostra o avanço e os dias restantes. Consultas marcadas contam sozinhas (agenda e Mayara). Contratos e receita dependem do registro de contratos.

### Funil e histórico

Quadro "Leads por etapa" e quadro "Análise do funil" (quantos estão na etapa agora, quantos avançaram, quantos se perderam ali). Exige um registro de eventos por lead (tabela de eventos só de acréscimo: lead criado, primeira mensagem da Mayara, lead respondeu, follow-up enviado, consulta marcada, transferido para a equipe, devolvido à Mayara, perdido, contrato fechado), preenchido a partir de agora e retroativamente, no que for possível, com o que as tabelas atuais guardam. Cada etapa do funil e cada contagem precisa bater com as tabelas de origem.

### Previsão de vendas

Quadro "Vendas em potencial" (leads ativos agora e projeção para 20, 40 e 60 dias) baseado na taxa de conversão real. Só é calculado depois de 30 dias de histórico; antes disso mostra "em formação". É a última etapa.

### Contratos por frase livre no WhatsApp

Comando em linguagem livre no WhatsApp de administrador, interpretado pelo modo livre da Mayara (o mesmo que hoje pausa, assume e consulta). Exemplo do Dr. Santo: "contrato fechado com o João da Silva no valor de 24 mil, 5 mil de entrada pago 20/10 e mais 12 parcelas de 1600 reais com vencimento para todo dia 20 de cada mês iniciando 20 de novembro".

- Dados do contrato: lead (por nome), valor total, entrada (valor e data, se já paga) e parcelas (quantidade, valor, primeiro vencimento e dia de vencimento). A data de assinatura é a do dia do comando.
- A Mayara devolve um resumo do que entendeu e só grava quando o Dr. Santo responde "sim", como nas outras ações.
- **Soma:** entrada mais parcelas tem que bater com o valor total. No exemplo acima, R$ 5.000 mais 12 × R$ 1.600 dá R$ 24.200, não R$ 24.000. Quando não bate, a Mayara informa a diferença e não grava até o Dr. Santo corrigir ou confirmar qual valor vale.
- **Lead:** se houver mais de um com o nome parecido, lista os candidatos com o final do telefone e pede a escolha. Se o cliente não for um lead existente, deve pedir confirmação antes de criar o registro.
- **Onde fica:** tabelas de contratos e parcelas no Supabase (fonte do painel). Espelhar no EspoCRM fica fora desta entrega.
- No painel, o contrato conta em "contratos fechados" e "receita contratada" na data de assinatura; "receita recebida" soma as parcelas pagas, na data do pagamento.

### Parcelas

Status automático, sem ação do Dr. Santo: **a receber** antes do vencimento e **atrasada** depois do vencimento sem pagamento registrado. Num menu em cada parcela do painel ele escolhe "Marcar como paga" e informa a data do pagamento; também pode desfazer e voltar ao automático. A entrada pode nascer paga pelo comando do WhatsApp. Não se registra valor pago diferente do combinado (juros, desconto).

### Escrita pelo painel

Hoje o painel só lê. Passa a ter exatamente três ações de escrita: marcar ou desfazer o pagamento de uma parcela, definir a meta do mês e salvar o arranjo dos quadros. Cada uma é uma função de banco específica, exige sessão válida, e as duas primeiras gravam um registro de quem mudou o quê e quando.

## O que fica a cargo de quem construir

- A forma de reler a conexão com o banco (o certificado do Supabase) e a biblioteca de arrastar e redimensionar.
- A estrutura exata das tabelas de eventos, contratos, parcelas, metas e arranjo.
- Como obter retroativamente as datas de cada etapa a partir das tabelas atuais, e quais etapas exigem dado que não existe.
- Os textos exatos e o desenho final dos quadros dentro da identidade visual.

## Ordem de entrega

1. **Consertar:** conexão do painel com o banco; troca do "zero em caso de erro" por "indisponível" por quadro; sessão revogável.
2. **Base:** grade configurável, barra de períodos, faixa de números e fila "Precisa de você", com dados reais da Mayara e do CRM.
3. **Histórico e dinheiro:** registro de eventos, funil, metas, comando de contrato no WhatsApp, parcelas e a escrita restrita do painel.
4. **Previsão de vendas.**

Cada etapa tem seu plano de execução próprio e só começa depois da anterior.

## Decisões minhas (para o Dr. Santo conferir)

- **Sem filtro por usuário** na barra de períodos (não há equipe).
- **Etapas do funil** (palpite meu, a partir do que a Mayara registra): Novo (lead sem resposta), Em conversa (lead respondeu e a Mayara atende), Consulta (consulta marcada), Com a equipe (transferido para humano) e Contrato (contrato fechado). "Respondeu", que apareceu no desenho, fica dentro de "Em conversa".
- **Definições dos números** (palpite meu, para o construtor seguir): *Leads novos* = leads criados no período. *Sem resposta* = leads a quem a Mayara escreveu e que nunca responderam. *Em conversa* = leads que responderam e têm atendimento ativo. *Perdido* = lead marcado sem interesse ou que chegou ao fim da sequência de follow-up sem resposta. *Fontes de lead* = campanha e origem registradas no cadastro do lead (hoje a origem do EspoCRM está vazia e a campanha vem no texto do cartão da agência; o construtor decide como extraí-la e mostra "sem origem" para o que não tiver). *Tempo de resposta* = tempo médio entre a mensagem do lead e a resposta da Mayara, mais a maior espera atual de um lead que aguarda a equipe.
- **A fila não mostra o texto das mensagens** do lead, porque o painel sempre prometeu não conter conversas. Os botões abrem o WhatsApp do lead e a ficha no CRM.
- **Receita da meta** é a receita contratada; a recebida aparece em quadro próprio.
- **Contratos ficam só no Supabase.** O EspoCRM não é alimentado nesta entrega.
- **A data de assinatura** é a data do comando.

## Critérios de aceite

1. O painel em produção abre, conecta ao banco e mostra os 73 leads atuais e a atividade real dos últimos 30 dias; nenhum quadro mostra zero por falha de leitura.
2. Forçando uma falha numa consulta, só aquele quadro mostra "indisponível".
3. Arrastar, redimensionar, esconder e adicionar quadros persiste após recarregar e em outro aparelho; no celular os quadros empilham.
4. A fila mostra cada um dos sete tipos a partir de dados reais ou de dados de teste, ordenados por urgência, e o item some quando resolvido.
5. O comando de contrato: a frase do exemplo gera o resumo, aponta a diferença de R$ 200 e não grava; com os valores corrigidos e o "sim", grava contrato, entrada paga e 12 parcelas com os vencimentos certos (20/11/2026 a 20/10/2027).
6. Parcela vira "atrasada" após o vencimento sem ação; "Marcar como paga" muda para paga na data informada; "Desfazer" volta ao automático.
7. Os totais de "contratos fechados", "receita contratada" e "receita recebida" batem com as tabelas de contratos e parcelas.
8. Logout invalida a sessão, mesmo com o cookie copiado.
9. Os testes do painel, os testes SQL das novas tabelas e funções e o build passam.
