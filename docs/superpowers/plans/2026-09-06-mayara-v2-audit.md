# Mayara V2 — Auditoria do Sistema Atual

**Data:** 2026-09-06
**Escopo:** Mayara — Núcleo do Agente (GWvEz64JQfI2Nij4), Ponte WhatsApp (B1xdt1WotCQE3NOb), Gateway (FV0PEtEcTFbuoRaO), integração EspoCRM, Google Calendar.
**Fase:** AUDITORIA (nenhuma alteração de comportamento do agente foi feita ainda — apenas leitura).

---

## 1. Resumo executivo

A Mayara hoje é **um único node de AI Agent com um prompt de ~700 palavras**, sem máquina de estados explícita, sem representação estruturada de fatos, e sem suíte de testes. A infraestrutura ao redor (deduplicação de mensagem, lock de sessão, fail-open de logging, kill-switch) é sólida — isso já validamos e corrigimos nas Trilhas 1 e 2. O que falta é **tudo que vive dentro da cabeça do agente**: hoje isso é 100% delegado ao LLM interpretando um prompt em prosa, sem estrutura de dados, sem guardrails técnicos, sem testes.

Isso não é necessariamente errado para o estágio atual (poucos testes, número de teste único) — mas tem lacunas de segurança jurídica reais (seção 10 do seu documento — movimentação patrimonial — **não está coberta hoje**) e nenhuma validação sistemática antes de publicar mudanças de prompt.

## 2. Problemas encontrados, causa raiz e categoria

| # | Problema | Categoria | Causa raiz |
|---|----------|-----------|------------|
| 1 | Nenhuma regra sobre movimentação/ocultação patrimonial (spec §10) | **A (Prompt) + J (Segurança Jurídica)** | O prompt nunca foi atualizado para esse cenário — não existe porque ninguém pediu ainda, não é um bug técnico |
| 2 | Sem limite de caracteres (650) no prompt | **A (Prompt)** | Nunca especificado |
| 3 | Sem enforcement técnico de "uma pergunta por mensagem" | **A (Prompt) + K (Outro — falta de guardrail estrutural)** | Depende 100% do LLM seguir a instrução em prosa; não há verificação pós-geração |
| 4 | Sem máquina de estados explícita | **F (Estado)** | O agente nunca teve estado formal — tudo é inferido da janela de memória a cada turno |
| 5 | `contextWindowLength` da memória está no padrão (5), não configurado | **C (Contexto/Memória)** | Node "Simple Memory" nunca teve esse campo tocado — 5 trocas é pouco pra uma qualificação de várias mensagens |
| 6 | Sem representação de FATO vs INFERÊNCIA — tudo é texto livre na janela de chat | **C (Contexto/Memória) + G (Dados)** | Nunca existiu um "knownFacts" estruturado; o agente relê o histórico bruto toda vez |
| 7 | Criação de Lead no CRM sem checagem de idempotência técnica (só instrução "use uma vez") | **D (Tool Calling) + K** | Não há Data Table nem verificação prévia — depende do LLM lembrar que já chamou |
| 8 | CRM não é consultado como fonte de verdade antes da conversa (só o "card de lead colado", que vem de fora) | **E (CRM) + F (Estado)** | Mayara nunca faz `Buscar Lead por Telefone` no início da conversa, só no fim (pós-agendamento) |
| 9 | Sem separação entre atendimento inicial e follow-up (spec §26) | **B (Workflow)** | Um único agente atende os dois casos hoje; não existe lógica de "lead silencioso" |
| 10 | Sem suíte de testes adversariais | **K (Outro — processo)** | Nunca foi construída; testes até agora foram manuais, um de cada vez |
| 11 | "STOP QUALIFICATION" existe só como instrução em prosa ("transferir para humano quando..."), sem sinal computado | **F (Estado) + A (Prompt)** | Não há verificação estrutural de gatilhos de prioridade jurídica (execução, penhora, etc.) — depende do LLM detectar sozinho |
| 12 | Sem guia de "concorrência" (spec §23) nem "vulnerabilidade emocional" (spec §24) | **A (Prompt)** | Nunca especificado |
| 13 | Documentos (foto/PDF) hoje nem chegam à IA — o Gateway já bloqueia tipos != text/interactive/button | **K (Outro, mas favorável)** | Achado positivo: a arquitetura atual já é seguramente restritiva aqui, por acidente de design, não por decisão deliberada |
| 14 | Deduplicação de mensagem e lock de sessão já existem e funcionam (verificado nas Trilhas 1-2) | **— (não é problema)** | Ponte já cobre isso via `messageId` + `WhatsApp Sessao Lock` |
| 15 | Honorários/duração de consulta: prompt já proíbe inventar (`INFORMACOES COMERCIAIS`) | **— (não é problema, já está correto)** | Já segue a política oficial (consulta online, gratuita, sem duração definida) |

## 3. O que já está certo (não mexer sem necessidade)

- Proibições absolutas de conduta (não prometer resultado, não inventar números, não citar terceiros) — já cobrem boa parte da seção 9 do seu documento.
- Uso do `$now` real no prompt para data/hora (seção 18) — já implementado corretamente.
- Verificação de disponibilidade antes de oferecer horário — já implementada e já é uma ferramenta real (`Verificar Disponibilidade na Agenda`), corrigida nesta sessão.
- Confirmação de agendamento só após sucesso real da ferramenta — já está explícito no prompt.
- Dedup + lock de sessão na Ponte — infraestrutura já sólida.
- Fail-open de logging — já não bloqueia o atendimento principal (seção 28 do seu documento já atendida).

## 4. Decisões que preciso da sua aprovação antes de implementar

Isso são pontos que mudam custo, latência ou comportamento de forma material — não vou decidir sozinho:

**D1 — Extração estruturada de fatos como passo separado?**
Pra realmente ter `knownFacts` (fato vs inferência) de forma confiável, o caminho mais robusto é um segundo passo de LLM (Information Extractor) rodando depois de cada resposta, escrevendo um Data Table de fatos por sessão. Isso **dobra o custo de IA por mensagem** e adiciona ~1-2s de latência. Alternativa mais barata: manter tudo dentro do prompt do agente principal (como hoje), só que com instruções mais rígidas — funciona pior em conversas longas, mas não muda custo.
→ Pergunta: aceita o custo/latência extra pela robustez, ou prefere manter num único LLM por enquanto?

**D2 — Máquina de estados: enforced tecnicamente ou apenas instrução no prompt?**
Uma máquina de estados "de verdade" (com transições bloqueadas fora do LLM) exigiria bem mais nós no workflow. Uma versão mais leve: o estado vira um campo (`S0`...`S7`) que o próprio agente lê e escreve via tool call dedicada, mas a transição em si ainda é decidida pelo LLM (mais rápido de construir, menos garantia formal).
→ Pergunta: quero a versão leve agora (estado como campo que o agente gerencia) e deixamos enforcement rígido pra uma iteração futura?

**D3 — Onde implementar: workflow de rascunho separado, ou editar "Mayara — Núcleo do Agente" direto?**
Sua seção 33 pede para preservar produção durante testes. Recomendo duplicar o Núcleo (`Mayara — Núcleo do Agente [DRAFT V2]`), fazer tudo lá, rodar os 30 testes contra o draft, e só trocar a Ponte para apontar pro draft depois de aprovado. Isso mantém a Mayara real respondendo clientes normalmente durante todo o trabalho.
→ Confirma esse caminho?

**D4 — Seção 10 (movimentação patrimonial) precisa da sua palavra final**
Vou implementar a regra de recusa educada ("não posso orientar isso, o advogado precisa analisar") exatamente como você escreveu no documento — isso é redação sua, não decisão jurídica minha. Só confirmando que é pra ir exatamente como está no seu texto, sem eu alterar o teor jurídico.

## 5. Próximos passos propostos (após suas respostas acima)

1. Criar workflow draft (cópia do Núcleo) — produção intocada.
2. Reescrever o system prompt incorporando: stop-qualification, uma pergunta por mensagem, RECONHECER-CONECTAR-PERGUNTAR, limite de 650 caracteres, seção patrimônio (verbatim), concorrência, vulnerabilidade, honorários (mantém regra já correta).
3. Ajustar `contextWindowLength` da memória (Simple Memory) para um valor maior (proponho 50, conforme boas práticas).
4. Se D1 = sim: montar o Information Extractor + Data Table de fatos.
5. Montar os 30 testes adversariais (T01-T30) + 5 cenários (A-E) como conversas simuladas.
6. Rodar cada teste contra o draft, registrar resultado (PASS/FAIL) com evidência real de execução.
7. Corrigir falhas, re-testar.
8. Entregar o relatório final nas 18 seções pedidas, com recomendação PUBLICAR / NÃO PUBLICAR.
9. Só troco a Ponte pra apontar pro draft depois da sua aprovação explícita.
