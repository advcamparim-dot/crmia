# Painel Camparim: Plano de Execução

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer o painel em `painel.camparimadvogados.com.br` ler o banco de verdade, mostrar falhas como "indisponível" em vez de zero e ter login com sessão revogável; e fixar a ordem das etapas seguintes (tela configurável, fila, funil, metas, contratos por WhatsApp).

**Architecture:** Este plano detalha a **etapa 1 (consertar)** do design, que desbloqueia tudo. As etapas 2 a 4 ficam como roteiro com interfaces; cada uma ganha plano próprio quando a anterior terminar (o design diz que cada etapa tem plano próprio). O app Next.js 14 existente em `painel-executivo/` é mantido.

**Tech Stack:** Next.js 14 (App Router), `pg`, Vitest, Supabase Postgres (`wuhvlvsolewslkawazlq`), Coolify.

**Spec:** `docs/superpowers/specs/2026-10-18-painel-camparim-design.md`

## Global Constraints

- Manter o stack: Next.js 14, `pg` com `SUPABASE_DB_URL`, hospedagem no Coolify; identidade "Câmara" (`#0d1310`, `#141d18`, `#b08a5a`, `#c9ab7d`; Lora, Karla, IBM Plex Mono).
- Login único (uma pessoa); sem multiusuário, papéis ou permissões.
- O painel não envia mensagens e não altera a Mayara, a régua de follow-up nem a abordagem automática (hoje ligadas).
- Antimeta: nunca mostrar zero ou vazio quando o dado não pôde ser lido; falha aparece como "indisponível" por quadro.
- O painel não mostra texto de conversa de lead.
- Escritas do painel só por funções de banco específicas, com sessão válida.
- Migrations a partir de `0065` (`0062` está reservado pelo trabalho paralelo de handoff de consulta; conferir `git log` e `list_migrations` antes de numerar). Testes SQL em `supabase/tests/NNNN_*.test.sql`, dentro de `begin; ... rollback;`, terminando com `select 'OK NNNN';`; funções com `set search_path = ''` e `revoke all ... from public, anon, authenticated`.
- Não imprimir nem versionar senhas, URLs de conexão, `SESSION_SECRET` ou `PAINEL_SENHA`.
- Commits terminam com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Verificação do certificado de verdade:** a correção não pode ser `rejectUnauthorized: false`; o teste exige `rejectUnauthorized: true` com a CA do Supabase.
2. **Falha por quadro:** forçar erro numa consulta mostra "indisponível" só naquele quadro e nunca `0` nem `R$ 0,00`.
3. **Logout com cookie copiado:** depois de sair, o mesmo token é recusado; token adulterado, expirado ou inexistente também.
4. **Imagem do Docker:** o certificado precisa estar dentro do código empacotado (não em arquivo fora do `.next`), porque o estágio final só copia `public`, `.next`, `node_modules` e `package.json`.
5. **Rota de saúde sem vazar nada:** `/api/saude` responde só `ok` ou falha, sem mensagem de erro, host ou versão.
6. **Colisão com o plano de confiabilidade de hoje:** se as sessões revogáveis já tiverem sido feitas por ele, a Task 3 não duplica.

## File Structure

- Create: `painel-executivo/lib/supabase-ca.ts` (CA pública do Supabase como string), `painel-executivo/lib/carregado.ts` (resultado por quadro), `painel-executivo/lib/sessao.ts` (sessão revogável), `painel-executivo/app/api/saude/route.ts`, `supabase/migrations/0065_painel_sessoes.sql`, `supabase/tests/0065_painel_sessoes.test.sql`
- Modify: `painel-executivo/lib/db.ts`, `painel-executivo/lib/session.ts`, `painel-executivo/app/login/actions.ts`, `painel-executivo/app/painel-executivo/page.tsx`, `painel-executivo/Dockerfile` (healthcheck)
- Test: `painel-executivo/lib/db.test.ts`, `painel-executivo/lib/carregado.test.ts`, `painel-executivo/lib/sessao.test.ts`

---

## Etapa 1: Consertar (detalhada)

### Task 1: Conexão segura com o banco e rota de saúde

**Files:** Create `lib/supabase-ca.ts`, `app/api/saude/route.ts`; Modify `lib/db.ts`, `Dockerfile`; Test `lib/db.test.ts`

**Interfaces:**
- Produces: `construirSsl(): { ca: string; rejectUnauthorized: true }` em `lib/db.ts`; `getPool(): Pool` continua igual; `GET /api/saude` → `200 {"banco":"ok"}` ou `503 {"banco":"falha"}`.

- [ ] **Step 1: Obter a CA do Supabase.** Pedir ao Dr. Santo só o host e a porta do `SUPABASE_DB_URL` (nunca a senha). Rodar `openssl s_client -starttls postgres -showcerts -connect HOST:PORTA` e guardar o certificado raiz da cadeia; se a raiz não vier na cadeia, usar o "Root 2021 CA" do painel do Supabase (Database Settings). Expected: um bloco PEM `BEGIN CERTIFICATE` de uma autoridade do Supabase.
- [ ] **Step 2: Escrever `lib/db.test.ts`** com os testes `construirSsl devolve ca não vazia e rejectUnauthorized true` e `a CA é um certificado PEM válido` (confere o cabeçalho `-----BEGIN CERTIFICATE-----` e que `new X509Certificate(ca)` não lança).
- [ ] **Step 3: Rodar** `cd painel-executivo && npx vitest run lib/db.test.ts`. Expected: FAIL (`construirSsl` não existe).
- [ ] **Step 4: Criar `lib/supabase-ca.ts`** exportando `SUPABASE_CA_PEM: string` (a CA pública, versionada) e implementar `construirSsl()` em `lib/db.ts`; `getPool()` passa a usar `ssl: construirSsl()` no lugar de `ssl: true`.
- [ ] **Step 5: Criar `app/api/saude/route.ts`** que roda `select 1` com timeout de 3 s e devolve os códigos acima, sem corpo de erro; trocar o healthcheck do `Dockerfile` de `/login` para `/api/saude`.
- [ ] **Step 6: Rodar** `npx vitest run`. Expected: todos passam.
- [ ] **Step 7: Commit** `fix(painel): conexao com o banco verifica o certificado do Supabase e rota de saude`.

### Task 2: Falha por quadro, nunca zero

**Files:** Create `lib/carregado.ts`; Modify `app/painel-executivo/page.tsx`; Test `lib/carregado.test.ts`

**Interfaces:**
- Produces: `type Carregado<T> = { estado: 'ok'; dados: T } | { estado: 'indisponivel' }`; `carregar<T>(rotulo: string, fn: () => Promise<T>): Promise<Carregado<T>>` (captura o erro, registra com `console.error`, nunca relança); `texto(c: Carregado<T>, f: (d: T) => string): string` devolvendo `"indisponível"` quando falhou.

- [ ] **Step 1: Escrever `lib/carregado.test.ts`:** `carregar devolve ok com os dados`, `carregar devolve indisponivel quando a função lança, sem relançar`, `texto devolve "indisponível" para falha e nunca "0" nem "R$ 0,00"`, `texto aplica o formatador quando ok` (inclusive para o dado legítimo `0`, que continua `"0"`).
- [ ] **Step 2: Rodar** `npx vitest run lib/carregado.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implementar `lib/carregado.ts`.**
- [ ] **Step 4: Em `page.tsx`**, substituir `Promise.allSettled` e `unwrap` com fallbacks zerados por `carregar(...)` por seção, e renderizar o selo "indisponível" no lugar dos números de cada seção que falhou; remover as constantes `*_FALLBACK`. "Última sincronização" também usa `carregar` e mostra "indisponível" em vez de "nunca" quando falha.
- [ ] **Step 5: Rodar** `npx vitest run` e `npx tsc --noEmit`. Expected: passam.
- [ ] **Step 6: Commit** `fix(painel): falha de leitura aparece como indisponivel por secao, nunca como zero`.

### Task 3: Sessão revogável

**Pré-condição:** conferir `git log` e `list_migrations`; se a migration de sessões do plano `2026-10-18-confiabilidade-mayara-painel.md` já existir, **pular esta task** e registrar no plano que ela veio de lá.

**Files:** Create `supabase/migrations/0065_painel_sessoes.sql`, `supabase/tests/0065_painel_sessoes.test.sql`, `lib/sessao.ts`; Modify `lib/session.ts`, `app/login/actions.ts`; Test `lib/sessao.test.ts`

**Interfaces:**
- SQL (schema `painel`): tabela `sessoes(id uuid pk, token_hash text unique, emitida_em, expira_em, revogada_em)`; `painel.sessao_criar(p_hash text, p_expira timestamptz) returns uuid`; `painel.sessao_valida(p_hash text) returns boolean`; `painel.sessao_revogar(p_hash text) returns void`.
- TS (`lib/sessao.ts`): `criarSessao(): Promise<string>` (token aleatório de 32 bytes; grava só o hash SHA-256); `validarSessao(token: string): Promise<boolean>`; `revogarSessao(token: string): Promise<void>`.

- [ ] **Step 1: Escrever o teste SQL** `0065_painel_sessoes.test.sql` (asserções: criada → válida; expirada → inválida; revogada → inválida; hash desconhecido → inválida; `anon` sem `execute`) e rodar. Expected: erro (função não existe).
- [ ] **Step 2: Escrever a migration** com tabela e funções (RLS ligada, sem acesso para `anon` e `authenticated`) e aplicar com `apply_migration`; rodar o teste. Expected: `OK 0065`.
- [ ] **Step 3: Escrever `lib/sessao.test.ts`** com o banco substituído por um duplo (função de consulta injetada): `token válido passa`, `token adulterado falha`, `token expirado falha`, `logout invalida o token e o mesmo token é recusado depois`, `o token bruto nunca é enviado ao banco, só o hash`. Rodar. Expected: FAIL.
- [ ] **Step 4: Implementar `lib/sessao.ts`** e trocar `lib/session.ts` (`requireSession` usa `validarSessao`; `createSessionCookie` usa `criarSessao`; `clearSessionCookie` chama `revogarSessao` antes de apagar o cookie); remover `signSession` e `verifySession` e adaptar `session.test.ts`. O cookie continua `httpOnly`, `secure` em produção, `sameSite=lax`.
- [ ] **Step 5: Rodar** `npx vitest run` e `npx tsc --noEmit`. Expected: passam.
- [ ] **Step 6: Commit** `feat(painel): sessao revogavel no servidor (migration 0065)`.

### Task 4: Publicar e verificar em produção

**Files:** nenhum arquivo novo.

- [ ] **Step 1: Pedir ao Dr. Santo para fazer o deploy** do aplicativo `painel-executivo-camparim` que está "Running" no Coolify (não o duplicado "Exited") e avisar quando terminar. Não mexo no Coolify.
- [ ] **Step 2: Verificar a saúde:** `curl -s -o /dev/null -w "%{http_code}" https://painel.camparimadvogados.com.br/api/saude`. Expected: `200`.
- [ ] **Step 3: Verificar os logs** do aplicativo no Coolify: nenhuma linha `SELF_SIGNED_CERT_IN_CHAIN` depois do deploy. Expected: ausência do erro.
- [ ] **Step 4: Com o Dr. Santo logado, conferir:** "Leads novos" no período de 30 dias mostra o total real (73 ou mais), "Última sincronização" mostra um horário recente, e os demais quadros mostram valores reais ou "indisponível", nunca zero por erro.
- [ ] **Step 5: Conferir o logout:** copiar o cookie, sair, repetir a chamada com o cookie antigo. Expected: redireciona ao login (se a Task 3 foi executada).
- [ ] **Step 6: Atualizar `docs/handoffs/claude-status.md`** (sem dados de clientes) e fazer o commit final da etapa.

---

## Etapas 2 a 4 (roteiro; plano próprio ao começar cada uma)

**Etapa 2, Base do painel.** Entrega: grade configurável, barra de períodos, faixa de números e fila "Precisa de você" com dados reais.
- Leitura por views do schema `painel` (`v_faixa_numeros(p_de, p_ate)`, `v_fila_atencao`) sobre `leads_autorizados`, `session_state`, `followups_log`, `followup_estado`, `envios_log`, `canal_estado` e a Task do CRM; cada tipo da fila (os sete do design) com seu teste SQL.
- Biblioteca de arrastar e redimensionar (por exemplo `react-grid-layout`); funções `painel.layout_ler()` e `painel.layout_salvar(p_layout jsonb)`; modo "Configurar" com adicionar, esconder e redimensionar; celular em coluna única com a fila primeiro.
- Aceite: critérios 1 a 4 do design.

**Etapa 3, Histórico e dinheiro.**
- Registro de eventos por lead (tabela só de acréscimo) com preenchimento retroativo do que for possível; funil e análise do funil (entrou, avançou, perdeu) com contagens conferidas contra as tabelas de origem.
- Tabelas `contratos`, `parcelas`, `metas`; status automático de parcela (a receber, atrasada) e funções `painel.parcela_pagar(p_id, p_data)`, `painel.parcela_desfazer(p_id)`, `painel.meta_definir(...)`, cada uma com registro de quem mudou o quê e quando; menu "Marcar como paga" no painel.
- Comando em frase livre no WhatsApp: nova ação `registrar_contrato` no interpretador do modo livre (`docs/superpowers/specs/2026-10-12-central-linguagem-livre/interpretar.mjs`) e em `mayara.executar_livre`, com confirmação por "sim", validação da soma (o exemplo do design: R$ 5.000 + 12 × R$ 1.600 = R$ 24.200 ≠ R$ 24.000, não grava), escolha entre leads de nome parecido e vencimentos mensais (20/11/2026 a 20/10/2027).
- Aceite: critérios 5 a 7 do design.

**Etapa 4, Previsão de vendas.** Quadro de leads ativos e projeção a 20, 40 e 60 dias, calculado só com 30 dias ou mais de histórico; antes disso mostra "em formação".

---

## Self-review

- **Cobertura do design:** a etapa 1 cobre o defeito de conexão, o "zero por erro" e a sessão revogável; as etapas 2 a 4 apontam cada item restante (fila, grade, períodos, funil, metas, contratos, parcelas, previsão) e os critérios de aceite 1 a 9 estão distribuídos entre elas.
- **Tamanho:** o plano é curto de propósito. Código só aparece como assinaturas, nomes de teste e asserções; as etapas 2 a 4 ganham planos próprios, como o design determina.
- **Consistência de nomes:** `Carregado`, `carregar`, `texto`, `construirSsl`, `criarSessao`, `validarSessao`, `revogarSessao` e `painel.sessao_*` aparecem iguais nas tasks que os usam.
- **Risco declarado:** a Task 1 depende de obter a CA do Supabase (passo 1) e a Task 4 depende de o Dr. Santo fazer o deploy no Coolify.

## Registro de execução

- **Task 1 concluída em 18/10** (32/32 testes do painel, `tsc` limpo, `next build` ok).
  - Reprodução do defeito: com `ssl: true`, a conexão ao pooler do Supabase falha com `SELF_SIGNED_CERT_IN_CHAIN`; com a CA do Supabase e `rejectUnauthorized: true`, o handshake passa (o erro restante é só de usuário/senha, como esperado sem credenciais).
  - CA: "Supabase Root 2021 CA" (autoassinada, válida até 26/04/2031), SHA-256 `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`, idêntica ao certificado oficial publicado pelo Supabase (conferido). Guardada como constante em `lib/supabase-ca.ts` (vai dentro do `.next`; confirmado no bundle do servidor).
  - Ruling: obtive a CA pelo pooler público (sem credenciais) e a confirmei contra o arquivo oficial, em vez de pedir host e porta ao Dr. Santo.
  - Ruling: acrescentei `limparConexao`, não previsto no plano: o `pg` deixa a URL sobrescrever o objeto `ssl`, então um `?sslmode=require` na `SUPABASE_DB_URL` de produção anularia a CA. A função remove só os parâmetros de ssl.
  - Ruling: a rota `/api/saude` usa importação relativa (o Vitest não tem o alias `@`).
  - Healthcheck do `Dockerfile` agora é `/api/saude`.
- **Task 2 concluída em 18/10** (40/40 testes do painel, `tsc` limpo, `next build` ok). `lib/carregado.ts` (`Carregado`, `carregar`, `texto`, `INDISPONIVEL`) e `page.tsx` refatorada: cada seção carrega separado; falha vira "indisponível" (inclusive "Última sincronização" e a tabela de alertas), nunca zero. Os fallbacks zerados foram removidos.
  - Teste de página (`app/painel-executivo/page.test.ts`): resumo falhando mostra 5 "indisponível" e mantém o funil real; tudo falhando não mostra `R$ 0,00`, `0%` nem "nenhum alerta"; zero legítimo continua aparecendo. Conferido que os dois testes de falha reprovam contra a página antiga.
  - Ruling: o Vitest ganhou o alias `@` e `oxc.jsx.runtime = automatic` (o Vite 8 usa oxc no lugar do esbuild) para testar a página sem tocar no `tsconfig` do Next.
- **Task 3 concluída em 18/10** (44/44 testes do painel, `tsc` limpo, `next build` ok; `OK 0065`). Pré-condição conferida: nenhuma migration nem código de sessão revogável existia (o plano de confiabilidade de hoje ainda não foi executado).
  - Migration `0065` aplicada: tabela `painel.sessoes` (RLS ligada, hash SHA-256 com formato validado) e funções `sessao_criar`, `sessao_valida`, `sessao_revogar`, com `execute` só para o dono e `painel_leitura`.
  - TS: `lib/sessao.ts` (`criarSessao`, `validarSessao`, `revogarSessao`, `hashDoToken`; consulta injetável para teste); `lib/session.ts` agora usa o banco; logout revoga antes de apagar o cookie; validação com falha de banco **nega** o acesso. `session.test.ts` (do HMAC antigo) foi substituído por `sessao.test.ts` (7 testes).
  - Ruling: retirei a limpeza automática de sessões antigas (o `delete` dentro da função foi barrado pela ferramenta SQL); o volume é uma linha por login.
  - Ruling: `SESSION_SECRET` deixou de ser usada; ficou só o aviso no `.env.example` (remover do Coolify é opcional).
  - **Risco para a Task 4:** as funções só têm `execute` para o dono e para `painel_leitura` (que não faz login). O usuário do `SUPABASE_DB_URL` precisa ser o dono (`postgres...`) ou ter `execute`; senão o login falha. Confirmar com o Dr. Santo só o **nome de usuário** da URL (nunca a senha) antes do deploy.
- **Task 4 em espera (18/10):** o aplicativo em produção (`painel-executivo-camparim:main-me9vc0yr...` no Coolify) é construído a partir de **outro repositório**, `advcamparim-dot/painel-executivo-camparim` (branch `main`, GitHub). Este repositório local não tem `remote` e a máquina não tem `gh`, então não há como enviar o código daqui sem uma decisão do Dr. Santo sobre o caminho de publicação (e a autorização do envio). Pendente também: confirmar só o nome de usuário do `SUPABASE_DB_URL` (precisa ser o dono ou ter `execute` nas funções `painel.sessao_*`) e, se o painel deve manter só um aplicativo no Coolify, remover o duplicado parado.
