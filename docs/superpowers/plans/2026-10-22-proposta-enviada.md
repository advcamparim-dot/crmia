# Abordagem para leads com Proposta Enviada: Plano de Execução

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline).

**Goal:** Marcar leads que receberam proposta (frase livre no WhatsApp de administrador), manter a Mayara fora da conversa deles, enviar no máximo 4 lembretes curtos (3º, 7º, 14º e 25º dia útil), avisar o administrador quando o lead responder e mostrar a etapa "Proposta enviada" no funil do painel.

**Decisões do Dr. Santo (22/10):** ritmo 3, 7, 14 e 25 dias úteis; qualquer resposta só gera alerta (sem resposta automática); os 8 leads atuais começam a contar de hoje (22/10).

**Architecture:** Tabela `mayara.proposta_enviada` (uma proposta ativa por lead) e funções de banco; o lead fica `bloqueado` em `leads_autorizados` (a Mayara não responde, não faz follow-up e a reativação o ignora). Um robô do n8n a cada 3 minutos envia o próximo lembrete devido e avisa o administrador de respostas novas. A ação `proposta_enviada` entra na Central (formulário fechado, confirmação por "sim"). Evento `proposta_enviada` alimenta o funil.

## Global Constraints

- Nada é registrado sem o "sim". O lembrete só sai no expediente do follow-up, com 25 minutos ou mais entre envios, no máximo 20 por dia, e nunca para quem respondeu, tem contrato ou saiu da lista. Sem valores, desconto, promessa ou urgência nos textos.
- Não alterar a régua normal, a reativação nem a abordagem automática (que já ignoram `bloqueado`). Migrations a partir de `0081`; testes SQL em transação desfeita, dados sintéticos (`+5511999991xxx` a `+5511999992xxx`), funções com `set search_path = ''`, sem `execute` para `public/anon/authenticated`. Commits com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Tasks

1. **Banco (0081):** `mayara.proposta_enviada`, textos, cadência na `regua_followup` (sequência `proposta`), `registrar_proposta`, `proposta_proximo_lembrete`, `proposta_lembrete_registrar`, `proposta_respostas_novas`; teste SQL.
2. **Central (0082):** ação `proposta_enviada` em `criar_acao_pendente`, `confirmar_acao_pendente`, `executar_livre`; chave `proposta_comando`; teste SQL e regressão `0077`.
3. **Interpretador e fluxo vivo:** `interpretar.mjs` aceita `proposta_enviada` (alvo e data opcional); testes; patch do `Central: Interpretar Livre`; prova com o modelo real.
4. **Funil do painel (0083):** evento `proposta_enviada`, etapa "Proposta enviada" em `funil_periodo` e `leads_por_etapa`; regressão `0075`; ajuste dos testes do painel.
5. **Robô n8n e os 8 leads:** worker `Proposta: Lembretes e Alertas`; registrar os 8 leads de hoje; prova do primeiro ciclo (sem enviar nada fora de hora).

## Registro de execução

