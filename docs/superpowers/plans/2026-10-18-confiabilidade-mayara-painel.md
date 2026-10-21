# Confiabilidade da Mayara e do Painel — Plano de Implementação

> **Para agentes:** habilidade obrigatória: usar `superpowers:subagent-driven-development` (recomendado) ou `superpowers:executing-plans` tarefa por tarefa. Os passos usam checkboxes.

**Objetivo:** corrigir continuidade de follow-up, sessão canônica, sessão revogável e semântica comercial do painel, preservando a abordagem automática ativa.

**Arquitetura:** a camada Mayara recebe uma migration incremental (`0071`) que corrige apenas dados e funções de decisão já existentes. A sessão revogável já é fornecida pela migration `0065_painel_sessoes.sql` do `main`; não há uma segunda tabela ou RPC de sessão. A interface deixa clara a diferença entre produção por período e funil de coorte.

**Stack:** PostgreSQL/Supabase, Node.js, n8n exportado em JSON, Next.js 14, TypeScript, Vitest, `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-18-confiabilidade-mayara-painel-design.md`

## Restrições globais

- Não desligar, pausar, reordenar ou alterar cadência/janela da abordagem automática.
- Não enviar mensagens reais, publicar workflow no n8n nem aplicar migration no Supabase sem validação e autorização operacional separadas.
- Propostas existentes são manuais por padrão.
- O token puro de sessão nunca é persistido; cookie permanece `httpOnly`, `secure` em produção e `sameSite=lax`.
- O painel continua acessando somente objetos do schema `painel` mediante funções explicitamente concedidas a `painel_leitura`.
- Não usar atualização forçada de dependência.

## Foco de revisão

1. Uma resposta humana após saída automática deve impedir follow-up, mesmo quando a origem é `abordagem_automatica`.
2. Um número com e sem nono dígito deve ter uma única mensagem de proposta na sessão canônica.
3. Token válido, adulterado, expirado e revogado precisam ter resultados distintos e testados.
4. Nenhuma alteração desta entrega pode mudar a seleção, configuração, teto ou cadência da abordagem automática.

## Estrutura de arquivos

- `supabase/migrations/0071_mayara_confiabilidade.sql`: compatibilidade de follow-up e sessão canônica de proposta.
- `supabase/tests/0071_mayara_confiabilidade.test.sql`: regressões SQL para a migration 0071.
- `painel-executivo/lib/sessao.ts` e `supabase/migrations/0065_painel_sessoes.sql`: sessão revogável consolidada.
- `painel-executivo/lib/metrics.ts`, `painel-executivo/app/painel-executivo/page.tsx`, respectivos testes: semântica “Produção no período”.
- `docs/operacao/release-mayara.md`: fonte canônica de workflows e checklist de release/manual de contingência.

### Tarefa 1: Corrigir decisões persistentes da Mayara

**Arquivos:**
- Criar: `supabase/migrations/0071_mayara_confiabilidade.sql`
- Criar: `supabase/tests/0071_mayara_confiabilidade.test.sql`
- Modificar: `supabase/tests/0035_propostas_acoes.test.sql`

**Interfaces:**
- Consome: `mayara._ultima_saida(text)`, `mayara.followups_elegiveis(timestamptz)`, `mayara.sessao_do_lead(text,text)`, `mayara.confirmar_envio_proposta(bigint,boolean,text)`, `mayara.abordagem_auto_proximo(timestamptz)`.
- Produz: as mesmas assinaturas públicas de função; a seleção da abordagem automática é preservada.

- [ ] Escrever teste SQL que insira envio `ok` de origem `abordagem_automatica`, sem entrada posterior, e confirme elegibilidade na primeira etapa devida; inserir entrada posterior e confirmar exclusão.
- [ ] Executar o teste contra a base com migrations atuais; esperar falha porque `_ultima_saida` não reconhece a origem automática.
- [ ] Escrever teste em `0035_propostas_acoes.test.sql` com variantes de telefone 8/9 dígitos e confirmar que `confirmar_envio_proposta(..., true, ...)` grava uma única mensagem AI na chave de `sessao_do_lead`.
- [ ] Executar os testes novos; esperar falhas pelos comportamentos ausentes.
- [ ] Implementar a migration `0065`: incluir `abordagem_automatica` na lista de origens de `_ultima_saida`; usar `mayara.sessao_do_lead(p.telefone, 'whatsapp:escritorio:' || p.telefone)` antes da inserção no histórico; não substituir nem reconfigurar `abordagem_auto_proximo`.
- [ ] Executar os testes SQL específicos e a suite SQL relevante; esperar aprovação sem alteração de configuração automática.
- [ ] Commit: `fix(mayara): preserve followup and canonical proposal history`.

### Tarefa 2: Sessões revogáveis do painel

Durante a integração, esta tarefa foi substituída pela implementação mais recente que já existe no `main`: `painel.sessoes`, `painel.sessao_criar`, `painel.sessao_valida` e `painel.sessao_revogar`. Não criar uma segunda tabela, RPC ou adaptador de sessão.

### Tarefa 3: Corrigir a semântica comercial do painel

**Arquivos:**
- Modificar: `painel-executivo/lib/metrics.ts`
- Criar ou modificar: `painel-executivo/lib/metrics.test.ts`
- Modificar: `painel-executivo/app/painel-executivo/page.tsx`
- Modificar: testes da página, se existentes.

**Interfaces:**
- Consome: `getProducaoNoPeriodo(period): Promise<ProducaoEstagio[]>`.
- Produz: `getProducaoNoPeriodo(period): Promise<FunilEstagio[]>`; título e legenda que não afirmam conversão/coorte.

- [ ] Escrever teste que simule contrato assinado no período para lead criado antes dele e confirme que o resultado é tratado como produção, não como taxa de conversão do mesmo grupo de leads.
- [ ] Executar o teste; esperar falha pois a API/visual ainda é chamada de funil.
- [ ] Renomear a função e tipos para “produção”; manter as cinco contagens por data, sem calcular porcentagem de conversão a partir delas.
- [ ] Atualizar página: `Produção no período`, `Itens realizados no período; não representa coorte nem taxa de conversão.`; trocar variáveis internas `funil` por `producao`.
- [ ] Rodar testes do painel e `npm run build`; esperar aprovação.
- [ ] Commit: `fix(painel): label period production accurately`.

### Tarefa 4: Tornar release e falha de modelo verificáveis

**Arquivos:**
- Criar: `docs/operacao/release-mayara.md`
- Modificar: `docs/superpowers/specs/2026-10-12-central-linguagem-livre/gerar-workflows.test.mjs`
- Modificar: `docs/superpowers/specs/2026-10-12-central-linguagem-livre/gerar-workflows.mjs`
- Regenerar: `docs/superpowers/specs/workflows/mayara-central-interpretar-livre.json`

**Interfaces:**
- Consome: `montarInterpretarLivre()` e o workflow exportado `mayara-central-interpretar-livre.json`.
- Produz: workflow com erro tratado e timeout de execução compatível com a versão instalada do n8n; checklist de release.

- [ ] Confirmar na documentação/versionamento da instância n8n qual campo de workflow suporta timeout por execução. Se a versão não suportar timeout no JSON, registrar a configuração equivalente de worker/instância no runbook e não inventar campo não suportado.
- [ ] Escrever teste que assegure erro tratado e a configuração de timeout escolhida no gerador/exportação.
- [ ] Executar teste e observar falha antes da alteração de configuração.
- [ ] Implementar a configuração suportada e gerar novamente o JSON pelo script existente.
- [ ] Escrever o runbook com: fonte canônica `docs/superpowers/specs/workflows`; ordem migration → teste SQL → gerar/exportar → comparar workflow ativo → teste controlado → ativação; retorno seguro e alerta em timeout; e regra expressa de não enviar mensagens reais no teste.
- [ ] Rodar testes do gerador e `jq -e .` no JSON gerado; esperar aprovação.
- [ ] Commit: `docs(mayara): define verifiable release and model fallback`.

### Tarefa 5: Planejar atualização de dependências em mudança isolada

**Arquivos:**
- Criar: `docs/superpowers/plans/2026-10-18-painel-dependency-security.md`

**Interfaces:**
- Consome: `painel-executivo/package.json`, `package-lock.json`, saída atual de `npm audit --omit=dev --json`.
- Produz: plano separado com versão alvo suportada pelo Node/Docker efetivamente usado e matriz de teste de atualização.

- [ ] Rodar `npm audit --omit=dev --json` e registrar os advisories diretos/transitivos ainda presentes, sem copiar segredos de ambiente.
- [ ] Consultar a compatibilidade oficial entre a versão segura de Next, versão de Node da imagem Docker e React.
- [ ] Escrever plano separado que fixe versões, inclua atualização do lockfile, teste Vitest, build e smoke test de login; proibir `npm audit fix --force`.
- [ ] Commit: `docs(painel): plan controlled dependency security update`.

## Revisão do plano

- Cobertura: Tarefa 1 cobre continuidade, propostas e sessão canônica; Tarefa 2 cobre revogação; Tarefa 3 corrige apresentação comercial; Tarefa 4 cobre timeout e release; Tarefa 5 isola a atualização de dependência.
- Decisão: a atualização do Next não entra junto com alterações funcionais, pois é uma mudança de compatibilidade e segurança que requer versão alvo validada.
- Interface: Tarefa 1 não altera assinaturas existentes; Tarefa 2 adiciona RPCs privadas ao schema `painel`; Tarefa 3 só renomeia a API interna consumida pela página.
