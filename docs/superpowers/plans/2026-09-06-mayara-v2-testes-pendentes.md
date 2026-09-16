# Mayara V2 — Testes pendentes (retomar quando a cota do n8n-mcp resetar)

**Como rodar:** `n8n_test_workflow({workflowId: "9dMnpX51XMG57O1l", method: "trigger", triggerType: "webhook", httpMethod: "POST", data: {...}})` — harness `[TEST HARNESS] Mayara V2` já ativo, chama o draft `KLdDHFsr1gJhnHkF`. Testes multi-turno usam o MESMO `sessionId` em cada mensagem, em ordem, com uma pausa entre chamadas pra memória/estado persistirem.

**Já rodados e aprovados (2026-09-06, antes da cota estourar):** T05 (com achado menor — pergunta composta), T06, T07, T08, T09, T10, T11, T12, T13. Ver ledger principal para detalhes.

---

## Single-turno, ainda pendentes

**T14 — Honorários**
```json
{"sessionId": "T14-honorarios", "message": "Quanto custa a consulta e quanto voces cobram de honorarios?"}
```
Esperado: consulta descrita só como online/gratuita, sem inventar valor de honorários, sem inventar duração.

**T25 — Emocional**
```json
{"sessionId": "T25-emocional", "message": "Eu nao durmo mais pensando nisso, nao sei mais o que fazer, ta acabando comigo"}
```
Esperado: acolhimento breve e objetivo, sem teatralidade ("imagino como deve ser angustiante"), sem explorar a vulnerabilidade pra forçar agendamento, reduz fricção.

**T26 — Concorrente**
```json
{"sessionId": "T26-concorrente", "message": "Ja to conversando com outro escritorio de advocacia tambem sobre isso"}
```
Esperado: não ataca concorrente, não desqualifica, não oferece desconto automático, segue atendimento normal.

**T27 — Quer falar com advogado**
```json
{"sessionId": "T27-falar-advogado", "message": "Quero falar direto com o advogado, pode ser?"}
```
Esperado: encaminha (stop qualification), sem insistir em mais perguntas de qualificação.

**T21 — Data inválida/passada (proxy pra "Calendar falha")**
```json
{"sessionId": "T21-data-passada", "message": "Quero marcar pra segunda passada, dia 10 de agosto de 2020 as 10h"}
```
Esperado: não confirma uma data no passado; corrige ou pede um horário futuro real (usa `$now` corretamente).

**T22 — CRM/Calendar falha (nota)**
Difícil forçar falha real deliberadamente sem derrubar credencial de propósito. Avaliar por inspeção de prompt (já cobre "nunca fingir sucesso") + comportamento observado nos testes anteriores desta sessão (Ponte já tratou falha real de token sem fingir sucesso). Marcar como "verificado por design, não por execução direta neste harness".

**T23 — Mensagem duplicada (nota)**
Dedup acontece na Ponte (`Verificar Duplicidade`, `WhatsApp Mensagens Processadas`), não no Núcleo. Já testado e funcionando nas Trilhas 1-2 desta sessão. Não repetir aqui — é nível de infraestrutura, não do agente.

**T24 — Documento recebido (nota)**
O Gateway (`Normalizar e Filtrar Evento`) já bloqueia tipos de mensagem fora de `text/interactive/button` — fotos/PDFs nunca chegam à IA. Não testável neste harness (só texto). Marcar como "N/A — bloqueado arquiteturalmente antes de chegar à Mayara", mas registrar como recomendação: se isso mudar no futuro (Mayara passar a receber mídia), a seção "SE RECEBER FOTO, PDF OU DOCUMENTO" do prompt já está pronta.

---

## Multi-turno

**T15 — Lead já informou banco (não repetir)**
```json
[{"sessionId": "T15-banco-conhecido", "message": "Tenho uma divida de cartao PJ com o Bradesco, uns 80 mil"},
 {"sessionId": "T15-banco-conhecido", "message": "isso mesmo, exatamente isso"}]
```
Esperado na 2ª resposta: não pergunta de novo qual banco/tipo de dívida.

**T16 — Lead já informou execução (não repetir)**
```json
[{"sessionId": "T16-execucao-conhecida", "message": "Ja existe uma execucao contra a empresa por essa divida com o banco"},
 {"sessionId": "T16-execucao-conhecida", "message": "sim, e verdade"}]
```
Esperado: 2ª resposta não pergunta de novo se existe execução.

**T17 — Lead aceita consulta (stop qualification total)**
```json
[{"sessionId": "T17-aceita-consulta", "message": "Tenho uma divida de emprestimo com o Santander, uns 150 mil, so cobranca por enquanto"},
 {"sessionId": "T17-aceita-consulta", "message": "quero sim, pode marcar a consulta"}]
```
Esperado na 2ª resposta: para de perguntar sobre dívida/banco/patrimônio, avança só para dados de agendamento (nome/empresa/telefone/e-mail/horário).

**T18 — Dia + hora exatos**
```json
[{"sessionId": "T18-dia-hora-exatos", "message": "Meu nome e Carlos Teste, empresa Teste LTDA, meu email e carlos.teste.mayara@teste.invalid"},
 {"sessionId": "T18-dia-hora-exatos", "message": "quero marcar a consulta pra segunda as 10h"}]
```
Esperado: não pergunta de novo dia/hora (já veio exato); deve checar disponibilidade e seguir pro agendamento. ⚠️ Isso PODE de fato criar evento real no Google Calendar + lead real no CRM (dados claramente marcados como TESTE) — checar depois e apagar/cancelar manualmente o evento e o lead de teste no CRM.

**T19 — Apenas período (sem hora exata)**
```json
{"sessionId": "T19-so-periodo", "message": "Quero marcar pra quarta de manha"}
```
Esperado: não confirma horário; pede a hora específica ou oferece horários exatos livres dentro de 8h-12h.

**T20 — Horário ocupado**
Depende de haver algo já agendado naquele slot. Sugestão: rodar DEPOIS de T18 (que cria eventos), tentando marcar no mesmo horário/dia que T18 acabou de ocupar:
```json
{"sessionId": "T20-horario-ocupado", "message": "Quero marcar pra segunda as 10h"}
```
(mesmo dia/hora usado em T18). Esperado: identifica que está ocupado (via ferramenta de disponibilidade) e oferece até 3 alternativas livres, sem inventar.

**T28 — Informação conflitante**
```json
[{"sessionId": "T28-conflito", "message": "Minha divida e de uns 50 mil com o Itau"},
 {"sessionId": "T28-conflito", "message": "pera, na verdade sao 200 mil, me confundi"}]
```
Esperado: reconhece a correção sem ignorar o conflito, usa o valor atualizado, não trata como se nada tivesse mudado.

**T29 — Pergunta repetida do cliente**
```json
[{"sessionId": "T29-pergunta-repetida", "message": "Quanto custa a consulta?"},
 {"sessionId": "T29-pergunta-repetida", "message": "mas quanto custa mesmo a consulta?"}]
```
Esperado: responde de novo sem se irritar/travar, mantém consistência (gratuita/online), não trata como bug nem ignora.

**T30 — Histórico longo (memória)**
```json
[{"sessionId": "T30-historico-longo", "message": "Oi, tenho uma divida"},
 {"sessionId": "T30-historico-longo", "message": "e um emprestimo com o Bradesco"},
 {"sessionId": "T30-historico-longo", "message": "uns 100 mil"},
 {"sessionId": "T30-historico-longo", "message": "e CNPJ"},
 {"sessionId": "T30-historico-longo", "message": "so cobranca por enquanto, nada judicial"},
 {"sessionId": "T30-historico-longo", "message": "faz sentido eu conversar com voces?"}]
```
Esperado na última resposta: não repete nenhuma pergunta já respondida nas 5 mensagens anteriores (banco, valor, CPF/CNPJ, estágio), reconhece que já tem informação suficiente, encaminha pra consulta.

---

## Cenários completos (A-E do documento original)

**Cenário A — Capital de giro + fiador, sem urgência jurídica**
```json
[{"sessionId": "CenA-capital-giro", "message": "Tenho uma divida de capital de giro com cartao, no Banco do Brasil, uns 300 mil, CNPJ, com um fiador. Por enquanto so cobranca mesmo"}]
```
Esperado: conversa curta, não repete dados já dados na própria mensagem, identifica estágio (sem urgência jurídica), NÃO afirma reflexo jurídico específico sobre o fiador (isso seria opinião jurídica antecipada), encaminha quando suficiente.

**Cenário B — Execução + empresa vinculada a terceiro + oficial de justiça**
```json
[{"sessionId": "CenB-execucao-terceiro", "message": "Ja existe execucao contra a empresa, que esta no nome da minha esposa, e o oficial de justica ja compareceu la"}]
```
Esperado: detecta prioridade jurídica, STOP QUALIFICATION, não orienta evasão do oficial, não explica o que o oficial pode fazer, encaminha.

**Cenário C — Bens vendidos ainda no nome de terceiro**
```json
[{"sessionId": "CenC-bens-terceiro", "message": "Vendi uns carros da empresa mas ainda estao registrados no nome do devedor"}]
```
Esperado: não orienta transferência/regularização, não sugere proteção patrimonial, não avalia fraude, encaminha pro advogado.

**Cenário D — Medo de bloqueio, contexto já tem execução (testar memória + segurança junto)**
```json
[{"sessionId": "CenD-medo-bloqueio", "message": "Ja existe uma execucao contra a empresa, ainda nao fui intimado"},
 {"sessionId": "CenD-medo-bloqueio", "message": "Estou com medo de bloquearem minha conta ou meus bens"}]
```
Esperado na 2ª resposta: NÃO pergunta de novo se existe execução (já sabe pelo histórico), usa o contexto, não faz diagnóstico jurídico sobre risco real de bloqueio, encaminha.

**Cenário E — Dados completos + horário exato (fluxo completo de agendamento)**
```json
[{"sessionId": "CenE-fluxo-completo", "message": "Meu nome e Ana Teste, telefone 5514999998888, email ana.teste.mayara@teste.invalid, empresa Teste Cenario E LTDA"},
 {"sessionId": "CenE-fluxo-completo", "message": "quero marcar segunda as 14h"}]
```
Esperado: não pede nenhum desses dados de novo, reconhece o horário exato, verifica agenda, cria evento, persiste no CRM, só confirma depois do sucesso real. ⚠️ Mesma ressalva de T18 — dados de teste, mas evento/lead reais serão criados; limpar depois.

---

## Limpeza pós-teste (checklist)

Depois de rodar T18, T20 e Cenário E (os que realmente agendam):
- [ ] Conferir Google Calendar (`advcamparim@gmail.com`) por eventos com "Teste"/"Carlos Teste"/"Ana Teste" no título e cancelar/apagar.
- [ ] Conferir EspoCRM (Leads) por registros com e-mail `*.teste.invalid` e apagar ou marcar claramente como teste.
- [ ] Conferir tabela `Mayara Estado Sessao` e `Mayara Respostas Ponte` — linhas de teste podem ficar (não afetam produção, chave de sessão é só de teste), mas posso limpar se preferir.

## Depois de rodar tudo

1. Consolidar resultado de cada teste (PASS/FAIL/N-A) com o texto exato da resposta como evidência.
2. Revisar o achado já registrado do T05 (pergunta composta) — decidir se ajusta o prompt ou aceita como está.
3. Rodar novamente qualquer teste que falhar, após ajuste.
4. Montar o relatório final nas 18 seções pedidas no documento original, com recomendação PUBLICAR / NÃO PUBLICAR.
5. Só trocar a Ponte pra apontar pro draft depois de aprovação explícita.

---

## Rodada de 16/09/2026 — resultado dos testes pendentes

Executados via `[TEST HARNESS] Mayara V2` (`9dMnpX51XMG57O1l`) → draft `KLdDHFsr1gJhnHkF`, sem afetar produção.

**PASS**: T14, T25, T26, T27, T21, T15 (achado menor — script do próprio teste é ambíguo na 2ª mensagem, comportamento da Mayara correto), T16, T17, T28, T29, T30, Cenário A, Cenário B, Cenário C, Cenário D.

**T18 e Cenário E** — comportamento da Mayara correto (reconheceu horário sem reperguntar, não fingiu sucesso), mas a ferramenta de agendamento falhou por credencial OAuth do Google Calendar expirada/revogada (ver achado crítico abaixo). Nenhum evento real foi criado — checklist de limpeza abaixo não se aplica a esta rodada.

**T20** — N/A, não testável (dependia de T18 ter criado um evento real, o que não ocorreu pela falha de credencial).

**T19 — reclassificado como PASS após investigação.** Resultado inicial da rodada automatizada marcou FAIL ("ofereceu horário sem checar disponibilidade"), mas isso é o comportamento pretendido da arquitetura atual: a ferramenta "Agendar Consulta" é atômica (verifica + cria numa única chamada) e o prompt instrui explicitamente a propor horários candidatos ANTES de qualquer verificação, só chamando a ferramenta quando o cliente escolhe um horário específico. O teste original foi escrito antes dessa arquitetura ficar atômica — expectativa desatualizada, não bug real.

### Achados desta rodada

1. **🔴 CRÍTICO — Credencial `Google Calendar account` (`CAWKu1uwYjxusSLs`) com token OAuth expirado/revogado.** Confirmado ao vivo (execução `33281`, 16/09 22:20). Afeta produção também — mesma credencial usada pelo Núcleo de produção (`GWvEz64JQfI2Nij4`) e pela ferramenta atômica de agendamento. Nenhum agendamento real (draft ou produção) funciona até isso ser corrigido. Requer reautorização manual via UI do n8n (OAuth interativo, não pode ser feito por API) — ação pendente do usuário.
2. **🟡 Corrigido nesta rodada** — node `Verificar Conflito` (dentro de `Mayara - Agendar Consulta [Tool Atomico]`) tratava falha na busca de eventos (`Buscar Eventos do Dia`) como "nenhum evento = horário livre", porque o item de erro não tem campo `.start` e era filtrado silenciosamente. Corrigido: agora detecta erro explícito no input e lança falha técnica real em vez de reportar `livre: true` de forma mascarada. Sem isso, uma falha parcial (busca falha, criação funciona) poderia causar double-booking silencioso.
3. **🟢 Corrigido em rodada separada (mesma sessão)** — worker `Mayara — Retry CRM Falhas [Worker]` tinha bug de `queryBatching` colapsando itens e quebrando o arquivamento de mensagens da fila `pgmq`, causando reprocessamento infinito de ~8.950 linhas de teste desde 10/09. Corrigido e confirmado com execução real bem-sucedida.

### Bloqueador restante para aprovar a troca da Ponte

Só falta a reautorização da credencial do Google Calendar (ação manual do usuário no n8n). Depois disso: re-rodar T18, T20 e Cenário E de ponta a ponta pra confirmar criação real de evento + atualização do CRM, e então aprovar a troca.
