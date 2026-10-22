# Handoff Claude: status

Atualizado em 2026-10-14. Projeto: Mayara / Central de Comando (Supabase, n8n, EspoCRM). Sem credenciais nem dados pessoais de clientes neste arquivo.

## Etapa: Central em linguagem livre, Fase 3, e retenção das respostas automáticas

### Objetivo
1. Permitir que o administrador escreva em português comum na Central (consultar, agir com confirmação, ensinar), atrás da chave `central_linguagem_livre`.
2. Impedir que a Mayara responda leads sozinha enquanto o escritório respondeu manualmente pelo celular (o histórico da Mayara não registra mensagens enviadas à mão).

### Arquivos alterados ou criados
- `supabase/migrations/0047_mayara_central_livre.sql`, `supabase/tests/0047_central_livre.test.sql`: `executar_livre`, `_lead_do_pedido`, ramo `livre` no `executar_central`, chave `livre` no `contexto_central`.
- `supabase/migrations/0048_mayara_respostas_retidas.sql`, `supabase/tests/0048_respostas_retidas.test.sql`: chave `respostas_retidas`, `respostas_retidas()`, ajuste de `resposta_permitida_para` e `reservar_eventos_adiados`.
- `docs/superpowers/specs/2026-10-12-central-linguagem-livre/`: `interpretar.mjs` (e testes), `frases.mjs`, `gerar-interpretar-node.mjs`, `gerar-workflows.mjs`, `gerar-central-patch.mjs`, `testar-modelo-real.mjs`, arquivos `.node.js` gerados, `central-livre-patch.json`.
- `docs/superpowers/specs/workflows/mayara-central-interpretar-livre.json` (novo) e `mayara-central-de-comando.json` (reexportação do estado vivo).
- `docs/superpowers/plans/2026-10-12-...-fase2-interpretar.md` e `2026-10-13-...-fase3-workflows.md`; `docs/superpowers/specs/2026-10-08-central-linguagem-livre-design.md` (Fase 2 concluída).

### Alterações em produção (fora do repositório)
- Supabase: migrations 0047 e 0048 aplicadas. Configuração: `respostas_retidas=true`, `followup_modo=desligado`, `central_linguagem_livre=false`. Quatro follow-ups que estavam `reservado` foram marcados `cancelado` (motivo `retencao_manual_13_10`).
- n8n: criado e publicado o sub-workflow `Central: Interpretar Livre` (sem webhook nem gatilho público). Workflow `Central de Comando` atualizado (29 para 38 nós: desvio do ramo livre atrás da chave e tratamento do marcador `@efeito` de pausar/ligar).

### Testes executados e resultado
- `node --test` nas pastas `2026-10-12-central-linguagem-livre` e `2026-10-03-central-comando`: 71 testes, 0 falhas.
- SQL em transação com rollback: `OK 0047` e `OK 0048`.
- Conferência das ligações do workflow vivo por GET (REST).
- Frases de aceitação contra o modelo real: NÃO executadas (sem `ANTHROPIC_API_KEY` no ambiente). O script `testar-modelo-real.mjs` está pronto.
- Não testado pelo WhatsApp: canal fechado.

### Pendências
1. Canal `escritorio` está `close` desde 13/10 06:18; aguardando reconexão (QR) pelo usuário.
2. Após reconectar: ler o contexto dos leads atendidos à mão, registrar no contexto da Mayara e só então desligar `respostas_retidas` e religar `followup_modo`.
3. Ligar `central_linguagem_livre` e rodar o roteiro de 9 mensagens pelo WhatsApp (ou o script com chave exportada no terminal do usuário).
4. Fase 4 (abordar um lead) e plano do `/abordar`: não executados.

### Riscos
- Com a retenção ligada, nenhum lead recebe resposta automática; mensagens ficam em `mayara.eventos_adiados`. Esquecer de desligar a chave deixa o atendimento parado.
- Follow-ups desligados: leads em régua não recebem contato até religar.
- O prompt da interpretação ainda não foi validado contra o modelo real; ações de efeito continuam exigindo "sim", o que limita o dano de uma interpretação errada.
- O sub-workflow precisa permanecer publicado, senão a Central publicada recusa o ramo.
- n8n-mcp é instável ("Connection closed" pode ter aplicado a mudança): sempre reler por GET antes de repetir.

---

## Etapa: Blindagem do canal WhatsApp (executada em 14/10/2026, parcialmente)

### Objetivo
Vigiar a Evolution, curar quedas, avisar fora do WhatsApp e recuperar mensagens perdidas (inclusive respostas feitas pelo celular) sem duplicar e sem a Mayara responder sem contexto. Plano: `docs/superpowers/plans/2026-10-14-blindagem-do-canal-whatsapp.md`.

### Feito
- Migration `0049` aplicada e testada (`OK 0049`): mensagens vistas, `tratar_mensagem_humana`, `leitura_canal` (política do vigia), `concluir_recuperacao`. Cursor inicial `sincronizado_ate` gravado na implantação; `canal_vigia = false`.
- Bibliotecas `vigia.mjs` e `recuperar.mjs`; evento humano com texto e data em `evolucao.mjs`; geradores de nós e de workflows (testes: 82 passam).
- n8n: criados `Canal: Alertar Fora do WhatsApp` (publicado), `Canal: Recuperar` (publicado) e `Canal: Vigia` (INATIVO). Receptor `Canal: Receber Evolution` atualizado (marca mensagens vistas e usa `tratar_mensagem_humana`).
- Sonda da API (workflow temporário, apagado): contrato em `docs/superpowers/specs/2026-10-14-blindagem-canal/evolution-contrato.md`.
- Ensaio da recuperação em modo simulação com o canal fechado: lote vazio, sem efeito colateral (0 mensagens vistas, cursor intacto, 0 envios).
- Runbook: `docs/runbooks/canal-whatsapp.md`.

### Pendências (dependem do usuário)
1. Reconectar o canal (QR).
2. Criar a credencial Gmail OAuth2 no n8n e informar o ID; hoje o nó `Enviar E-mail` está desabilitado (o alerta cria só a tarefa no CRM). Informar o e-mail de destino (`alerta_email_destino`).
3. Com o canal aberto: repetir o ensaio em simulação (confirmar forma dos registros e o filtro por data), publicar o `Canal: Vigia`, ligar `canal_vigia`, ensaiar um reinício e um alerta.
4. Causa raiz das quedas: logs da Evolution (checklist no runbook).
5. Retenção das respostas (`respostas_retidas = true`) e follow-ups desligados continuam até conferir o contexto dos leads.

### Riscos
- Formato dos registros do `findMessages` e o filtro por data ainda não confirmados com dados reais; o código descarta registros fora da janela e limita a 100 por execução.
- `PUT /instance/restart` não exercitado.
- Mensagens recebidas com a Evolution desconectada podem não ser reentregues por ela.
- Com o vigia desligado nada novo age; o receptor já marca mensagens vistas.

### Atualização 14/10 (canal reconectado, 12:22 Brasília)
- Canal `open`; fora do ar de 13/10 06:18 a 14/10 12:22. Nenhuma mensagem de lead chegou desde a reconexão (fila de adiados vazia). Retenção ligada, follow-ups e vigia desligados.
- Contrato real do `findMessages` (v2.3.7): devolve do mais novo para o mais antigo, 200 por página, histórico sincronizado (≈84 mil registros); o filtro de data do servidor é ignorado. Correção feita e testada: `Canal: Recuperar` busca até 4 páginas em sequência, filtra a janela no código e para quando a página sai da janela (limite 400 registros brutos). Workflow vivo atualizado e conferido.
- Ensaio em simulação desde 13/10 00:00 UTC (400 registros): 31 processar, 20 humano, 208 descartados (83 grupo, 4 tipo ignorado, 1 enviada por mim, 120 `lid_sem_telefone`). Os telefones encontrados não eram de leads cadastrados. Sem efeito colateral.
- Risco novo: registros do histórico com endereço LID e sem telefone (120 no período, 33 nas últimas 24 h) não podem ser ligados a um lead; o webhook ao vivo não tem esse problema (0 ocorrências em 8 dias). Resolver exige consulta de contatos da Evolution (a planejar).
- Pendências inalteradas: credencial Gmail e e-mail de destino, logs da Evolution, ligar o vigia (`canal_vigia`), ensaios de reinício e de alerta.

### Atualização 14/10 15:40 UTC: vigia ligado
- `Canal: Vigia` publicado e `canal_vigia = true` (autorizado pelo usuário). Primeiro ciclo: `recuperar` desde 12:01 UTC (cursor da implantação); segundo ciclo: `nada`. Execuções sem erro.
- Primeira recuperação real: 20 mensagens marcadas como vistas, cursor avançado, 14 eventos entregues ao `Processar Evento`, 6 respostas humanas tratadas (todas de remetentes que não são leads: nenhum lead assumido, nenhuma memória gravada). Retenção ativa: 11 mensagens de um único número fora da lista de leads ficaram em `eventos_adiados`; nenhuma resposta a lead foi enviada.
- Efeito indesejado detectado: 3 mensagens do administrador sem texto foram reprocessadas e a Central respondeu 3 vezes "Esse canal aceita comandos que começam com /". Sem ação, regra ou pendência alterada.
- Correção aplicada antes do próximo ciclo (teste primeiro, 25 testes verdes): comando do administrador com mais de 10 minutos não é reexecutado na recuperação (descartado como `comando_atrasado`). Workflow vivo atualizado e conferido.
- Continuam ligados: retenção das respostas (`respostas_retidas`); desligados: follow-ups. Pendências: credencial Gmail e e-mail de destino, logs da Evolution, ensaios de reinício e de alerta, LIDs sem telefone no histórico, contexto das respostas manuais a leads.

### Atualização 14/10 16:06 UTC: retenção e abordagem autorizada
- Causa de um lead abordado não receber retorno: `respostas_retidas = true` segurava até a resposta de lead com abordagem autorizada pelo administrador (2 mensagens do lead ficaram em `eventos_adiados` por cerca de 11 minutos).
- Migration `0050` (teste `OK 0050`): a retenção não vale para lead `ativo` com `abordagem_ate` no futuro (`resposta_permitida_para` e `reservar_eventos_adiados`). Para os demais leads a retenção continua. O worker `Retomar Eventos Adiados` liberou os eventos no ciclo seguinte e a Mayara respondeu.
- Observação de qualidade (a investigar): a resposta ao primeiro "Boa tarde" do lead repetiu a apresentação e perguntou de novo se era dívida bancária, embora a abordagem já tivesse perguntado o banco. Regra "apresentar-se só na primeira mensagem" (regra 19) não está ativa.

### Atualização 14/10 (item 1 da revisão): uma sessão por lead
- Causa: a sessão (memória) era chaveada pelo número exato; o WhatsApp entrega alguns números sem o nono dígito e o CRM/abordagem usa o número com o nono dígito, gerando duas sessões e fazendo a Mayara recomeçar do zero (caso do lead A; os leads B e C tinham o mesmo par).
- Migration `0051` (teste `OK 0051`, regressão `OK 0042`, 0024 e 0049): `sessao_do_lead` (sessão com mais histórico, inclusive sessões só de histórico), `com_sessao_canonica(evento)`, `iniciar_sessao_reativacao` e `registrar_followup`/`registrar_mensagem_humana` passam a usar a sessão canônica, `unir_sessoes_duplicadas` (nada é apagado; `unida_em`/`unida_para`; log das linhas de histórico movidas em `mayara.sessoes_unidas_log` para permitir desfazer).
- Dados: 3 duplicatas unidas (leads A, B e C). Sessões canônicas agora com fatos do formulário e histórico somado.
- n8n: `Canal: Processar Evento` ganhou `Resolver Sessão` e `Aplicar Sessão` antes de `Evento Autorizado?` (fail-open: se a consulta falhar, segue o evento original). Backup do estado anterior fora do repositório; reexportado em `docs/superpowers/specs/workflows/`.
- Ainda não coberto: o nó `Criar Sessão` do workflow do formulário de landing (chave legada da Meta) não foi alterado. A validação ponta a ponta com mensagem real de lead depende de liberar a retenção.
- Próximos itens da revisão: cursor da recuperação (achado 2), contexto das respostas manuais, retenção sem prazo (achado 3).

### Atualização 14/10 (item 2 da revisão): cursor da recuperação
- Defeito: `Canal: Recuperar` avançava `sincronizado_ate` mesmo com a busca falha ou cortada pelo limite de 4 páginas.
- Correção (teste primeiro, 88 testes verdes): `statusBusca` (biblioteca `recuperar.mjs`) diz se a busca foi completa (`ok`), falhou (`busca_falhou`) ou foi cortada (`janela_truncada`). O sentinela do lote leva `completo` e `motivo`; o nó `Concluir?` só deixa o cursor avançar com `completo = true`. Caso contrário, `Incompleta?` e `Registrar Incompleta` gravam em `canal_eventos` um descarte com motivo `recuperacao_incompleta:<motivo>` (não grava em simulação) e a próxima rodada tenta de novo da mesma janela.
- Workflow vivo atualizado e conferido (27 nós). Backup do estado anterior fora do repositório.
- Limite conhecido: se a janela passar de 800 registros brutos (4 páginas), o cursor fica parado e a recuperação repete a mesma janela a cada 15 minutos (a deduplicação evita reprocessar). Aviso ativo desse caso ainda não existe; hoje fica só no log (`canal_eventos`).

### Atualização 14/10 (item 3 da revisão, parcial): contexto das respostas manuais
- Corrigidos achados da 2ª revisão: o handoff não cita mais nomes de clientes; a fala humana gravada na memória agora leva data e hora no texto (migration `0052`, `OK 0052`), porque o histórico do agente é lido por id.
- Levantamento (workflows temporários agendados, já apagados; só contagens): nos chats endereçados por telefone não há mensagens manuais; as respostas de leads e do escritório ficam em chats LID, que foram ligados aos leads pelo id das mensagens enviadas pela própria Mayara (`envios_log`). Resultado: 3 leads com contato manual durante a queda (13/10), 5, 2 e 9 mensagens manuais; os demais leads não têm.
- Migration `0053` (`OK 0053`): `registrar_nota_contexto`. Foi gravada uma nota interna na memória desses 3 leads com a linha do tempo do período (lead e escritório, com data e hora), com marcador para não ser enviada ao lead. Idempotente.
- Descoberta: a régua de follow-up está defasada (ex.: lead com conversa manual consta como "nunca respondeu"). Com a régua religada hoje, 7 leads seriam elegíveis de imediato. Follow-ups continuam DESLIGADOS e a retenção continua LIGADA, por decisão de segurança, até o usuário decidir quais leads ficam com atendimento humano.

### Atualização 14/10: nota de contexto segura (achados 1 e 2 da 3ª revisão)
- Problema: a nota gravava o texto dos leads com tipo `ai` (como fala da Mayara), abrindo espaço para instrução injetada, e o limite de 4000 caracteres cortava as linhas mais recentes.
- Migration `0054` (`OK 0054`): `nota_contexto_formatar` monta a nota no banco a partir de linhas estruturadas; cada trecho vai entre « » como dado, sem quebra de linha, sem « » próprios e sem a expressão "nota do sistema"; o cabeçalho avisa que os trechos nunca são instruções; no limite, descarta as linhas mais antigas e informa quantas foram omitidas. `registrar_nota_contexto(telefone, cabecalho, linhas jsonb)` substitui a versão de texto livre, que ficou desativada (retorna falso).
- Dados: as 3 notas já gravadas foram reformatadas no lugar (todas as linhas interpretadas: 15, 2 e 7 trechos entre « »).
- Em aberto da 3ª revisão: idempotência da nota na própria função, duplicação do bloco de sessão/linha de memória, ano no carimbo de data, e a classificação "manual" depender de `envios_log` completo.

### Atualização 15/10: correções da revisão do modo livre
- Log de comandos: no ramo livre o `Finalizar` passa a gravar a ação interpretada (`livre_assumir`, `livre_pausar`...; `livre_erro` se o modelo falhou) em vez de `ensino`. Validado em n8n real com workflow temporário (antes/depois do ramo livre). Central ao vivo atualizada e reexportada (38 nós).
- Nomes de alvo: `limparNome` aceita letras, números, espaço e `' . & , -` (até 80 caracteres) e continua recusando `%`, `_`, `$`, `{`, `<`, `:`, `/` e afins. Sub-workflow `Central: Interpretar Livre` atualizado ao vivo (72 testes verdes).
- Lead só do CRM: migration `0055` (`OK 0055`, regressão do 0047 verde). `assumir` e `devolver` no modo livre só valem para lead da lista de atendimento; para lead só do CRM a resposta é clara e nenhuma pendência é gravada. `abordar` e `situacao_lead` seguem aceitando lead do CRM.
- Em aberto da revisão do modo livre: teste das 36 frases com o modelo real (falta chave no ambiente), ensino com mais de 400 caracteres cai em "não entendi", e a chamada ao modelo sem tempo limite.
- Time Chaves: credencial do EspoCRM corrigida pelo usuário (cabeçalho `X-Api-Key`); leitura de Leads validada (200, 69 leads). A função do usuário de API foi aberta para todas as permissões; recomendado voltar a somente leitura.

### Atualização 16/10: modo livre da Central ligado e roteiro executado
- `central_linguagem_livre = true` (autorizado pelo usuário em 15/10). Roteiro de 9 mensagens pelo WhatsApp de administrador, conferido no `comandos_log`:
  1. contagem de leads do dia: `livre_contagem_leads`, resposta direta (texto "1 leads", plural a ajustar).
  2. situação de um lead por nome: `livre_situacao_lead`.
  3. listar regras ativas: `livre_listar_regras`.
  4. pausar a Mayara + "não": confirmação pedida, ação cancelada, Mayara segue ligada.
  5. assumir por nome com dois candidatos: lista os dois com final do telefone, pede o telefone, não cria pendência. Enviar só o telefone na mensagem seguinte vira conversa (sem contexto entre mensagens, por desenho).
  6. frase ambígua: classificada como conversa, responde a apresentação e não executa nada (ideal seria "não entendi").
  7. ensino de regra: pede confirmação (a resposta enviada foi "sim", e a regra 20 ficou ativa por engano).
  8. desfazer a regra criada + "sim": executado, regra desfeita; log registra `livre_desfazer_regra`.
  9. abordar um lead: "Essa ação ainda não está habilitada." sem pendência e sem envio (Fase 4).
- Não exercitado: pausar/ligar com "sim" (único caminho que usa o marcador de efeito da Central; altera o modo real da Mayara).
- Ajustes pequenos em aberto: plural "1 leads"; frase ambígua deveria responder "não entendi"; teste das 36 frases com o modelo real; ensino com mais de 400 caracteres; timeout da chamada ao modelo.
- Observação: proposta de abordagem falhou por número do CRM sem o nono dígito (DDD 41); cogitar tentar a variante com o 9 quando a Evolution responde que o número não existe.

### Atualização 17/10: reativação em massa, spec e plano de execução
- Objetivo: cadastrar na lista da Mayara os leads do CRM que estão fora dela (e reativar os já listados, inclusive os assumidos, devolvidos à Mayara), preparar uma mensagem individual por lead pelo contexto, apresentar uma a uma ao administrador (`sim N`), enviar só as aprovadas (10 por dia, intervalo mínimo de 25 min, horário de atendimento, mais recentes primeiro) e integrar cada lead à régua de follow-up depois do envio.
- Arquivos: `docs/superpowers/specs/2026-10-16-reativacao-em-massa-design.md` (spec, já commitada) e `docs/superpowers/plans/2026-10-17-reativacao-em-massa.md` (plano mestre; Fase 1 com código e testes SQL completos, migrations 0056 a 0058; Fases 2 a 7 em esboço, cada uma com plano próprio ao começar).
- Testes executados: nenhum ainda; só documentação escrita. Nada foi alterado no banco, nos workflows ou nas chaves (`reativacao_ligada` nem existe ainda; retenção ligada, follow-ups desligados, modo livre ligado, vigia ligada).
- Pendências: aprovação do plano pelo usuário e escolha do método de execução; exportação de uma conversa de exemplo do WhatsApp (formato) antes da Fase 2.
- Riscos: reativação envia mensagem a leads antigos pelo número do escritório (proteção: aprovação mensagem a mensagem, limite diário, parada automática após três falhas); desvio do spec registrado no plano (estado final `enviado` com `integrado_em`, sem estado `integrado` separado).

### Atualização 17/10: falha de agendamento de 16/10 e plano da liberação automática
- Causa da falha de agendamento (um atendimento em 16/10): a credencial `Google Calendar account` do n8n pediu reconexão; a consulta à agenda falhou, a Mayara avisou "instabilidade" e a equipe confirmou o horário à mão. Única ocorrência no histórico. Provável causa de fundo: autorização do Google expira a cada 7 dias com o app OAuth em modo "Teste". Ação do usuário: reconectar a credencial e, se for o caso, publicar o app em "Produção".
- Plano escrito (nada aplicado ainda): `docs/superpowers/plans/2026-10-17-abordagem-automatica.md`, projeto separado da reativação. Chave `abordagem_automatica` desligada por padrão, worker de 2 em 2 minutos, teto por hora, descarte de administrador/lead inativo/conversa recente, três falhas desligam sozinha, notificação com carência de 30 min, piloto com teto baixo.
- Riscos: depende da agenda reconectada e provada antes de ligar; Task 5 (comando) tem o detalhe de código a escrever após ler o `executar_central` vivo.

### Atualização 17/10: liberação automática ligada e textos novos da régua (quem nunca respondeu)
- **Liberação automática de atendimento** (plano `docs/superpowers/plans/2026-10-17-abordagem-automatica.md`): migrations 0059 a 0061 aplicadas (`OK 0059`, `OK 0060`, `OK 0061`), worker `Abordagem: Liberar Automática` (`NXv0RW1Z72vz3BE8`) ativo, comando `/abordagem automatica status|ligar|desligar` na Central. Ligada pelo usuário às 14h26 de 17/10 com teto de 2 por hora. Até este registro, nenhum lead novo entrou, então nada foi enviado. Teste de agendamento real foi dispensado pelo usuário; leitura da agenda provada após a reconexão do Google Calendar.
- **Régua de follow-up em simulação** por decisão do usuário (`followup_modo = simulacao`). Cadência vigente: 14 mensagens no máximo (teto), 3 nas primeiras 6 h, 5 até o dia seguinte, depois uma por dia útil, ao longo de 11 a 13 dias úteis; janela 6h às 19h (sábado até 18h).
- **Textos novos para quem nunca respondeu (opção A aprovada):** 14 ângulos e 14 textos de reserva diferentes, um por etapa, com assunto de empresa ou pessoa. Biblioteca `followup.mjs`, prompt e nós `Montar Pedido` e `Escolher Texto` atualizados no worker vivo (`lSpRnhWMbBbVsQys`) e exportados. Testes: 18/18 na pasta da régua. A sequência `conversa` não mudou.
- **Pendências:** mesmo tratamento para a sequência `conversa` (se o usuário pedir); app OAuth do Google em "Teste" ou "Produção"; conferir se a regra da janela (`evolution_janela_horas = 48`) barraria o follow-up real de quem nunca respondeu (houve duas falhas `fora_da_janela` em 13/10); Cristina com duas sessões de memória.
- **Riscos:** primeiro dia da cadência é intenso para o número do escritório (3 mensagens em 6 h); liberação automática ligada sem prova ponta a ponta do agendamento.

### Atualização 18 a 20/10: régua ligada, retenção de respostas e Painel Camparim (etapas 1 e 2)
- **Mayara e régua (estado vigente):** `followup_modo = ligado`, 14 textos diferentes por etapa nas duas sequências (`nunca respondeu` e `conversa`), validador recusa "Recebi alguma" e "Pensando aqui no seu caso"; `evolution_janela_horas = 0` (regra das 48 h removida, a lista de atendimento continua sendo o filtro); liberação automática de abordagem ligada pelo usuário (teto 2/hora); retenção de respostas (`respostas_retidas`) segue ligada, vigia ligada, modo livre ligado. Mayara responde só leads da lista, sempre.
- **Painel Camparim, etapa 1 (base segura):** conexão ao Supabase com a CA oficial fixada (impressão digital conferida), quadro que falha mostra "indisponível" (nunca zero), sessões revogáveis no banco (migration `0065`), rota `/api/saude`. Cópia limpa em `publicar/painel-executivo-camparim/` (63 arquivos; `npm ci`, 91 testes, `tsc` e build provados). **Falta o usuário publicar no GitHub e fazer o deploy no Coolify** (passo a passo em `publicar/COMO-PUBLICAR.md`).
- **Painel Camparim, etapa 2 (tela inicial configurável):** migrations `0066` (números, etapas, follow-ups, fontes, tempo de resposta), `0067` (registro de falhas de agendamento, com novo nó no workflow `Avisar Falha de Agendamento`, exportado em `docs/superpowers/specs/workflows/mayara-avisar-falha-agendamento.json`), `0068` (fila "Precisa de você", seis tipos), `0069` (arranjo dos quadros). Rota `/painel` com barra de períodos (Hoje, Ontem, Semana, Mês, Período livre), faixa de números, fila, quadros arrastáveis em "Configurar" e pilha única no celular. Plano e rulings: `docs/superpowers/plans/2026-10-19-painel-camparim-etapa2.md`.
- **Testes executados:** SQL `OK 0065` a `OK 0069`; painel 91/91 (Vitest), `tsc` limpo, `next build` ok; teste em workflow temporário do nó novo (linha criada e marcada como resolvida, workflow apagado). Nenhuma execução em produção do painel ainda.
- **Resultado:** a fila real de 19/10 listou dois leads esperando a equipe; etapas somam o total de leads da lista; tempo médio de resposta da Mayara cerca de um minuto.
- **Pendências:** publicação da etapa 1 e 2 pelo usuário (e conferir o usuário do banco no Coolify, sem senha); aceite visual com o usuário logado (arrastar, salvar, celular); remover o app duplicado "Exited" e a variável `SESSION_SECRET` no Coolify; etapa 3 (eventos, funil, metas, contratos por WhatsApp, parcelas) e etapa 4 ainda sem plano; decisão sobre `respostas_retidas` (respostas a leads da lista fora da janela de 24 h da abordagem ficam retidas); reativação em massa só tem plano; unificar as duas sessões de memória de um lead.
- **Riscos:** o arrastar da grade só foi provado por build e teste da renderização do servidor, não no navegador com dados reais; as funções novas só têm `execute` para o dono do banco e o papel `painel_leitura` (se o usuário do `SUPABASE_DB_URL` for outro, o painel falha com "indisponível" nos quadros novos).

### Atualização 21/10: Mayara aquece mais antes de oferecer a consulta
- **Problema:** em um atendimento de 21/10 a Mayara ofereceu a consulta na 2ª resposta do lead. Causa: o lead disse só "Judicial", a Mayara gravou "execução" (inferência) e a regra STOP QUALIFICATION (prioridade absoluta, com o item vago "já existe informação suficiente") mandou oferecer. Nas outras conversas recentes a oferta veio entre a 3ª e a 6ª resposta.
- **Decisões do usuário:** mínimo de 4 respostas do lead antes de a Mayara oferecer por iniciativa própria; caso judicial confirma, acolhe numa mensagem e só oferece na seguinte.
- **Mudanças (Núcleo V3.1, `yWPXunb0uMWjFaDz`, exportado em `docs/superpowers/specs/workflows/mayara-nucleo-v31.json`):** (1) prompt: "judicial/processo" sem detalhe não é fato de execução nem sinal duro (pergunta a fase), o item vago saiu da lista de parada, nova regra de aquecimento e caso judicial em dois tempos; (2) a consulta de estado conta as respostas do lead; (3) `Calcular Lacunas` injeta o bloco AQUECIMENTO; (4) o `Guardrail` troca por acolhimento mais uma pergunta qualquer oferta feita antes do mínimo, exceto se o lead pediu para marcar, citou execução/penhora/bloqueio/citação, ou a oferta já estava em andamento. Se a leitura falhar, não interfere (fail-open). Código e testes em `docs/superpowers/specs/2026-10-21-aquecimento/` (13 testes).
- **Testes:** 13/13 do módulo; simulação do caso real nos Code nodes; duas conversas sintéticas no Núcleo vivo com o modelo real (workflow temporário apagado): sem oferta até a 5ª resposta em uma, e penhora acolhida sem oferta seguida de oferta na mensagem seguinte na outra.
- **Pendências e riscos:** acompanhar os próximos leads reais; a Mayara pode repetir a pergunta sobre citação se o lead não responder (a trava de pergunta repetida corta com resposta curta); o mínimo é uma constante (`MINIMO_RESPOSTAS`) fácil de ajustar. Restam linhas de teste sintéticas no histórico (telefones +5511999990101, 0102, 0201 e 0202).

### Atualização 21/10: ritmo novo da régua de follow-up
- **Motivo:** o usuário viu duas mensagens ao mesmo lead no mesmo dia (10h e 16h). Era o desenho da régua (dois toques por dia nos dias úteis 1 a 3, e 9 mensagens nos 3 primeiros dias úteis), não erro.
- **Aplicado (aprovado pelo usuário), migration `0070` (`OK 0070`):** primeiro dia com 2 mensagens (+2 h e +6 h desde o silêncio), depois no máximo uma por dia: dias úteis 1, 2, 3, 5, 7, 9, 11, 13, 15, 17, 20 e 23; hora 10h (sequência `conversa`: etapa 4 às 16h; `nunca_respondeu`: etapa 4 às 14h). A contagem de dias úteis da sequência `conversa` passa a partir da etapa 2 (antes, da 3). Os 14 textos por etapa e o teto de 14 não mudaram. Etapas 15 a 26 de `nunca_respondeu` ficam sem uso (teto 14). Obs.: o sábado conta como dia útil de follow-up (comportamento antigo mantido).
- **Efeito nos leads de hoje (13 em silêncio):** o pico de 11 mensagens previsto para 21/10 às 10h deixou de existir; vencidos acumulados: 24/10 → 1, 26/10 → 2, 27/10 → 4, 29/10 → 5, 30/10 → 10, 31/10 → 12, 06/11 → 13. Leads em etapas finais esperam mais tempo; dois leads em atendimento ativo seguem excluídos por segurança.
- **Riscos:** reduz o volume diário; se o usuário quiser mais toques, ajustar a tabela `mayara.regua_followup` (sem mudar código). Arquivos: `supabase/migrations/0070_regua_ritmo_novo.sql` e `supabase/tests/0070_regua_ritmo_novo.test.sql`.

### Atualização 21/10: três leads assumidos mantidos e funil do CRM atualizado
- Por decisão do usuário, os 3 leads bloqueados (finais 1357, 1049 e 3106) seguem assumidos pela equipe; a Mayara e a régua não mexem neles. Nada foi alterado na lista da Mayara.
- No EspoCRM (só o campo `status`, por workflow temporário já apagado, com a credencial de integração existente): 1357 e 1049 → `Consulta Realizada` (consulta feita, proposta enviada, aguardando fechamento); 3106 → `In Process` (busca do CNPJ pela equipe). Opções do funil do Lead: New, In Process, Consulta Agendada, Consulta Realizada, Converted, Dead.
- Risco: o campo `cLostReason` desses leads ainda está como "Não Respondeu" (valor antigo); o espelho do painel só reflete o novo status na próxima sincronização.

### Atualização 21/10: reativação em massa dos leads do CRM (pronta, desligada)
- **Decisões do usuário:** texto único (texto A, direto), 20 envios por dia, régua própria para o lead frio com um toque por dia útil durante 14 dias úteis (manhã no dia 1, tarde no dia 2, alternando). Substitui, para esses leads, a aprovação mensagem a mensagem do desenho de 16/10.
- **Migrations aplicadas:** `0071` (`OK 0071`): configurações `reativacao_ligada` (false), `reativacao_limite_dia` (20), `reativacao_intervalo_min` (25), `reativacao_texto`; funções `reativacao_cadastrar`, `reativacao_proxima`, `reativacao_primeiro_nome`, `reativacao_texto_para`; `abordagem_auto_proximo` passa a preparar a próxima reativação só quando não há lead novo esperando (lead novo tem prioridade e a reativação não consome o teto por hora); `_ultima_saida` passa a contar `abordagem_automatica` como início do ciclo da régua (corrige lead de abordagem automática que ficava fora da régua). `0072` (`OK 0072`): sequência `frio` (14 etapas, uma por dia útil, 10h nos dias ímpares e 16h nos pares, a partir do dia útil seguinte ao envio), `agenda_followup` e `followups_elegiveis` escolhem `frio` para lead da reativação que nunca respondeu; quem responde e silencia cai em `conversa`.
- **Código:** `followup.mjs` usa os 14 textos de `nunca_respondeu` para `frio` (24 testes verdes); nós `Montar Pedido` e `Escolher Texto` do worker de follow-up atualizados ao vivo e exportados.
- **Estado:** os 59 leads foram cadastrados na lista (origem `reativacao_massa`, ativos, sem janela, fora da régua). Verificação na Evolution: 58 com WhatsApp, 1 telefone fixo sem WhatsApp (movido para origem `reativacao_sem_whatsapp`, não entra na fila). Fila de envio: 58. **Interruptor `reativacao_ligada` segue em false; nada foi enviado.**
- **Pendências:** autorização do usuário para ligar; acompanhar os primeiros envios (o robô desliga sozinho a abordagem automática após 3 falhas seguidas).
- **Riscos:** 15 mensagens ao longo de 14 dias úteis para quem não responder é a maior pressão de todas as réguas, e o número do escritório usa API não oficial (risco de bloqueio); lead que escreve espontaneamente antes de ser abordado fica com a mensagem retida (sem aviso automático); quatro nomes de empresa recebem saudação sem nome.

### Atualização 22/10: funil do CRM sincronizado com a Mayara (ligado)
- **Migration `0073` (`OK 0073`):** `mayara.crm_status_pendentes`, `crm_status_registrar`, tabela `crm_status_log` e chave `crm_funil_modo` (agora `ligado`). Regras: só avança (New < In Process < Consulta Agendada < Consulta Realizada < Converted), nunca desfaz marcação manual, cada status é aplicado uma vez por lead (se a equipe reverter, a automação não briga), `Dead` (motivo "Sem Interesse") só para lead sem_interesse ainda em andamento, pausa de 1 hora após 3 falhas no mesmo status.
- **Worker `Mayara — CRM: Sincronizar Funil [Worker]` (`80Z630kqKfYO3wKj`, ativo, a cada 10 min):** consulta os pendentes, faz PUT no EspoCRM com a credencial de integração e registra o resultado. Exportado em `docs/superpowers/specs/workflows/mayara-crm-sincronizar-funil.json`. Autorizado pelo usuário em 22/10 (o sistema de permissões exigiu confirmação explícita).
- **Primeira rodada (22/10 08:40):** 14 atualizações, todas HTTP 200: 12 leads New → In Process e 2 New → Dead (Carla e um número de empresa marcados sem_interesse pela Mayara).
- **Pendências:** "Consulta Realizada" e "Converted" seguem manuais no CRM (a automação respeita); comando de contrato pelo WhatsApp (Etapa 3) vai marcar Converted; decidir os dois números errados da reativação (5049 ativo); publicação do painel.
- **Riscos:** `Dead` tira o lead da lista de ativos do EspoCRM; se a equipe reverter, a automação não reaplica.

### Atualização 22/10: painel publicado e etapa 3A (histórico e funil)
- **Publicação:** etapas 1 e 2 do painel enviadas ao GitHub (`painel-executivo-camparim`) e implantadas pelo Coolify (`/api/saude` 200 com banco "ok"). Correção de segurança do limitador de login (usa a última entrada de `x-forwarded-for` e há teto global de 30 falhas em 15 min). Falta o usuário conferir a tela logado.
- **Etapa 3A (plano `docs/superpowers/plans/2026-10-22-painel-camparim-etapa3a.md`):** migrations `0074` (`painel.eventos`, `eventos_atualizar()`) e `0075` (`funil_periodo`), ambas com teste SQL verde; quadro "Análise do funil" no painel (97 testes, `tsc`, build); worker `Painel — Atualizar Eventos [Worker]` (`IQgkk6SHyAOdUVhq`, a cada 10 min; primeira execução ok, 1 evento novo) exportado em `docs/superpowers/specs/workflows/painel-atualizar-eventos.json`. Código publicado (`46d976b`).
- **Funil real desde 01/10:** Novo 83 entraram, 23 avançaram, 60 agora; Em conversa 23 entraram, 4 avançaram, 3 perderam, 16 agora.
- **Pendências:** etapas 3B (contratos e parcelas por WhatsApp, quadros de receita, parcela atrasada na fila, Converted no CRM) e 3C (metas), ainda sem plano; previsão de vendas só a partir de novembro (30 dias de histórico).
- **Riscos:** datas de consulta, equipe e perda são aproximadas; histórico só desde 06/10.

### Atualização 22/10: etapa 3B (contratos e parcelas) pronta
- **Plano e execução:** `docs/superpowers/plans/2026-10-22-painel-camparim-etapa3b.md` (tasks 1 a 7 concluídas, task 8 parcial). Migrations `0076` a `0079` com testes SQL verdes; regressões `0030`, `0068` e `0073` verdes.
- **Comando no WhatsApp (chave `contrato_comando`, agora `ligado`):** frase livre de contrato → o modelo só preenche um formulário fechado → o código calcula dinheiro (centavos), datas e vencimentos e confere a soma → a Central mostra o resumo e só grava no "sim". Soma que não bate nunca grava e informa a diferença (a frase do exemplo dá R$ 200,00). Provado com o modelo real e pelo caminho `executar_central`.
- **Banco:** `painel.contratos`, `painel.parcelas`, `painel.parcelas_log`; funções de registrar, marcar paga e desfazer; leituras `contratos_numeros` e `parcelas_abertas`; parcela atrasada na fila; contrato leva o lead a `Converted` no CRM e ao funil.
- **Painel (publicado, `47fea0f`):** quadros de contratos fechados, receita contratada e recebida e lista de parcelas com "Marcar como paga" e "Desfazer" (única escrita de dinheiro, com sessão, validação e auditoria).
- **Pendências:** teste real pelo WhatsApp do usuário com o lead sintético (final 6999); conferir o painel logado; remover os dados sintéticos depois (o SQL da ferramenta não aceita `delete`, será por workflow temporário); etapa 3C (metas); contratos não têm edição nem cancelamento.
- **Riscos:** o modelo pode errar a leitura de valores e datas (mitigado pelo resumo completo, pela soma conferida duas vezes e pelo "sim"); a 1ª linha do teste antigo `0030` afirma `central_linguagem_livre = 'false'` e hoje falha por estar ligada de propósito.
