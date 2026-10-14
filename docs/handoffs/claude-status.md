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
- Primeira recuperação real: 20 mensagens marcadas como vistas, cursor avançado, 14 eventos entregues ao `Processar Evento`, 6 respostas humanas tratadas (todas de remetentes que não são leads: nenhum lead assumido, nenhuma memória gravada). Retenção ativa: 11 mensagens de um único número fora da lista (final 8888) ficaram em `eventos_adiados`; nenhuma resposta a lead foi enviada.
- Efeito indesejado detectado: 3 mensagens do administrador sem texto foram reprocessadas e a Central respondeu 3 vezes "Esse canal aceita comandos que começam com /". Sem ação, regra ou pendência alterada.
- Correção aplicada antes do próximo ciclo (teste primeiro, 25 testes verdes): comando do administrador com mais de 10 minutos não é reexecutado na recuperação (descartado como `comando_atrasado`). Workflow vivo atualizado e conferido.
- Continuam ligados: retenção das respostas (`respostas_retidas`); desligados: follow-ups. Pendências: credencial Gmail e e-mail de destino, logs da Evolution, ensaios de reinício e de alerta, LIDs sem telefone no histórico, contexto das respostas manuais a leads.

### Atualização 14/10 16:06 UTC: retenção e abordagem autorizada
- Causa de um lead abordado não receber retorno: `respostas_retidas = true` segurava até a resposta de lead com abordagem autorizada pelo administrador (2 mensagens do lead ficaram em `eventos_adiados` por cerca de 11 minutos).
- Migration `0050` (teste `OK 0050`): a retenção não vale para lead `ativo` com `abordagem_ate` no futuro (`resposta_permitida_para` e `reservar_eventos_adiados`). Para os demais leads a retenção continua. O worker `Retomar Eventos Adiados` liberou os eventos no ciclo seguinte e a Mayara respondeu.
- Observação de qualidade (a investigar): a resposta ao primeiro "Boa tarde" do lead repetiu a apresentação e perguntou de novo se era dívida bancária, embora a abordagem já tivesse perguntado o banco. Regra "apresentar-se só na primeira mensagem" (regra 19) não está ativa.

### Atualização 14/10 (item 1 da revisão): uma sessão por lead
- Causa: a sessão (memória) era chaveada pelo número exato; o WhatsApp entrega alguns números sem o nono dígito e o CRM/abordagem usa o número com o nono dígito, gerando duas sessões e fazendo a Mayara recomeçar do zero (caso do Emerson; Claudemiro e Jonathas tinham o mesmo par).
- Migration `0051` (teste `OK 0051`, regressão `OK 0042`, 0024 e 0049): `sessao_do_lead` (sessão com mais histórico, inclusive sessões só de histórico), `com_sessao_canonica(evento)`, `iniciar_sessao_reativacao` e `registrar_followup`/`registrar_mensagem_humana` passam a usar a sessão canônica, `unir_sessoes_duplicadas` (nada é apagado; `unida_em`/`unida_para`; log das linhas de histórico movidas em `mayara.sessoes_unidas_log` para permitir desfazer).
- Dados: 3 duplicatas unidas (Emerson, Claudemiro, Jonathas). Sessões canônicas agora com fatos do formulário e histórico somado.
- n8n: `Canal: Processar Evento` ganhou `Resolver Sessão` e `Aplicar Sessão` antes de `Evento Autorizado?` (fail-open: se a consulta falhar, segue o evento original). Backup do estado anterior fora do repositório; reexportado em `docs/superpowers/specs/workflows/`.
- Ainda não coberto: o nó `Criar Sessão` do workflow do formulário de landing (chave legada da Meta) não foi alterado. A validação ponta a ponta com mensagem real de lead depende de liberar a retenção.
- Próximos itens da revisão: cursor da recuperação (achado 2), contexto das respostas manuais, retenção sem prazo (achado 3).
