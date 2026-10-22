# Painel Camparim, Etapa 3C (Metas do mês): Plano de Execução

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline).

**Goal:** Quadro "Metas do mês" com velocímetro: o Dr. Santo escolhe entre consultas marcadas, contratos fechados e receita, define o valor de cada meta, e o painel mostra o avanço, a projeção e os dias restantes.

**Architecture:** Tabela `painel.metas` (mês, tipo, valor) e `painel.metas_log` (auditoria); `painel.meta_definir` (única escrita, com sessão no painel) e `painel.metas_mes()` (leitura, com os realizados vindos de `painel.eventos` e `painel.contratos`). Quadro `metas` no catálogo, com um velocímetro em SVG por meta e um formulário para definir.

**Spec:** `docs/superpowers/specs/2026-10-18-painel-camparim-design.md` (seção "Metas" e "Escrita pelo painel"); base: etapas 3A e 3B.

## Global Constraints

- Escrita do painel: só `meta_definir` (a de pagamento é da 3B); exige sessão, valida a entrada e grava auditoria. Falha de leitura mostra "indisponível", nunca 0%.
- Migrations a partir de `0080`; teste SQL em transação desfeita, dados sintéticos; funções com `set search_path = ''`, sem `execute` para `public/anon/authenticated`, com `execute` para `painel_leitura`. Fuso `America/Sao_Paulo`.
- Não alterar a Mayara, a régua, a reativação nem o CRM. Commits com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Definições (decisões minhas)

- **Realizado do mês corrente:** *consultas* = eventos `consulta_marcada` com data no mês (datas aproximadas, ver 3A); *contratos* = contratos assinados no mês; *receita* = soma dos totais dos contratos assinados no mês (receita contratada, como no design).
- **Meta herdada:** sem meta definida para o mês, vale a mais recente de um mês anterior. Definir valor `0` remove a meta a partir do mês corrente.
- **Projeção:** realizado ÷ dias decorridos × dias do mês (só como indicação). **Dias restantes:** até o último dia do mês, contando hoje como dia corrido.
- **Limites:** consultas e contratos até 10.000; receita até R$ 100.000.000.

## Tasks

### Task 1: Metas no banco (0080)
**Interfaces:** `painel.metas(mes date, tipo text, valor numeric, atualizado_em)` (única `(mes, tipo)`, `tipo in ('consultas','contratos','receita')`), `painel.metas_log`, `painel.meta_definir(p_tipo text, p_valor numeric, p_quem text) returns void`, `painel.metas_mes() returns table(tipo text, meta numeric, atual numeric, percentual numeric, projecao numeric, dias_restantes integer, dias_no_mes integer)`.
- [ ] Teste SQL: define e lê; realizado de consultas/contratos/receita do mês e não de outro mês; herança do mês anterior; valor 0 remove; recusa tipo inválido, negativo e acima do limite; log só quando muda; dias restantes e fronteiras; `anon` sem `execute`. Rodar: erro. Migration, aplicar, `OK 0080`. **Commit.**

### Task 2: Quadro "Metas do mês" no painel
**Interfaces:** `lib/painel-dados.ts`: `MetaMes`, seção `metas: Carregado<MetaMes[]>`, `gravarMeta(tipo, valor, consulta?)`; `app/painel/actions.ts`: `definirMetaAction(formData)`; widget `metas`.
- [ ] Testes (`painel-dados.test.ts`, `actions.test.ts`, `page.test.ts`): chama a função certa; validação de tipo e valor antes do banco; ação exige sessão; quadro mostra percentual, realizado, meta e dias restantes e o formulário; sem meta mostra convite para definir; falha vira "indisponível" (nunca 0%). Implementar, `vitest`, `tsc`, `next build`. **Commit.**

### Task 3: Publicar e registrar
- [ ] Enviar ao GitHub, conferir `/api/saude` e `/painel`; registrar neste plano e no handoff.

## Registro de execução

