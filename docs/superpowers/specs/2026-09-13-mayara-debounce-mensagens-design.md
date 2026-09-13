# Mayara — Debounce de Mensagens na Ponte (Design + Implementação)

**Data:** 2026-09-13
**Sub-projeto novo**, aplicado direto na Ponte de produção (`Mayara — Ponte WhatsApp`, id `B1xdt1WotCQE3NOb`) — não existe uma Ponte de teste separada, é infraestrutura compartilhada por qualquer conversa (humana ou IA).

## Problema

Testando manualmente, o usuário observou que quando o lead manda várias mensagens seguidas no WhatsApp (comum — as pessoas picam o pensamento em várias mensagens curtas em vez de uma só), a Mayara respondia **uma mensagem de cada vez**, imediatamente, em vez de esperar e responder a ideia completa de uma vez. Isso soa robótico e pode gerar respostas fora de contexto (respondendo à primeira parte antes de saber o resto).

## Desenho

**Debounce de 15 segundos:** quando uma mensagem chega, ela entra numa fila (buffer). A execução espera 15 segundos e então verifica: chegou alguma mensagem mais nova desse mesmo lead nesse meio tempo?
- **Se sim** → essa execução para ali mesmo, sem fazer nada — a mensagem mais nova é quem vai cuidar de responder.
- **Se não** → essa é a última mensagem da rajada: busca todas as mensagens acumuladas no buffer (na ordem que chegaram), junta tudo numa string só (uma por linha), marca como processadas, e segue o fluxo normal da Ponte com esse texto combinado.

Tempo de espera escolhido pelo usuário: **15 segundos** (compensa rajadas mais longas, ainda que a resposta demore um pouco mais pra chegar).

## Schema (Supabase)

```sql
create table mayara.mensagens_buffer (
  id bigserial primary key,
  session_key text not null,
  mensagem text not null,
  recebido_em timestamptz not null default now(),
  processado boolean not null default false
);

create index idx_mensagens_buffer_pendentes
  on mayara.mensagens_buffer (session_key, recebido_em)
  where not processado;
```

Aplicado via `supabase/migrations/0005_mayara_debounce_mensagens.sql`.

## Arquitetura na Ponte

Inserido entre `Registrar Recebido` (dedup já existente) e `Obter Lock de Sessão` (lock já existente) — nenhum dos dois mecanismos de segurança pré-existentes foi alterado, só um novo trecho no meio:

```
Registrar Recebido
  → Inserir no Buffer (Postgres: grava sessionKey + mensagem, retorna o id da própria linha)
  → Aguardar Debounce (Wait, 15 segundos)
  → Sou a Mais Recente? (Postgres: existe alguma linha desse sessionKey com id maior que o meu, ainda não processada?)
  → E a Mais Recente? (IF)
      false → (fim da execução, silenciosamente)
      true  → Buscar e Marcar Buffer Processado (Postgres: pega todas as pendentes desse sessionKey, marca como processadas, tudo numa UPDATE...RETURNING atômica — mesmo padrão já usado no worker de follow-up)
            → Combinar Mensagens (Code: ordena por recebido_em, junta com quebra de linha)
            → Obter Lock de Sessão (fluxo original continua daqui, sem mudança)
```

`Chamar Mayara` (o node que invoca o Núcleo) foi atualizado pra usar `mensagemCombinada` no lugar da mensagem única original (`$("Entrada").item.json.message`).

## Testado

Usuário mandou 4 mensagens reais em sequência rápida pelo número de teste autorizado (+5514997022609): "Bom dia tudo bem?", "Tenho uma dívida com o Bradesco", "Estou com medo de bloquearem minhas contas", "O que devo fazer?". Resultado:
- 4 execuções da Ponte disparadas (uma por mensagem, como esperado — cada webhook do WhatsApp é uma execução independente).
- As 3 primeiras pararam sozinhas em "E a Mais Recente?" (branch falso), sem responder nada.
- Só a 4ª (a mensagem mais recente de fato) seguiu adiante, com a mensagem combinada:
  ```
  Bom dia tudo bem ?
  Tenho uma dívida com o Bradesco
  Estou com medo de bloquearem minhas contas
  O que devo fazer ?
  ```
- Fluxo completo depois disso funcionou normal (chamou o Núcleo, respondeu, atualizou status, liberou o lock).

**Nota sobre o conteúdo da resposta:** a resposta da Mayara nesse teste teve o mesmo problema já conhecido de opinião jurídica espontânea ("cláusulas abusivas", detalhes sobre bloqueio de conta) — isso é porque a Ponte ainda chama o **Núcleo de produção** (prompt antigo, não corrigido), não o draft. O debounce em si funcionou perfeitamente; a qualidade do conteúdo é um problema separado, já resolvido no draft, que só se aplica quando a Ponte apontar pra lá.

## Limitações conhecidas, aceitas por ora

- **Sem teste de concorrência real** (duas mensagens chegando no exato mesmo instante) — o padrão SQL (`id > $meu_id`) é correto por construção, mas não foi forçado num cenário de corrida de verdade.
- **Aumenta o tempo de resposta em pelo menos 15 segundos**, mesmo pra quem manda só uma mensagem — trade-off aceito conscientemente pelo usuário em troca de não responder mensagem picada.
- **Buffer não tem limpeza automática de linhas antigas** — como as linhas ficam marcadas `processado = true` depois de usadas, não crescem indefinidamente em termos de "pendentes", mas o histórico completo se acumula na tabela. Mesmo padrão de retenção que as outras tabelas da Mayara (nenhuma tem rotina de limpeza automática hoje, exceto a tabela de mensagens/locks da própria Ponte, que tem retenção de 30 dias). Vale considerar adicionar essa tabela na rotina de retenção existente (`WhatsApp — Retenção Operacional 30 dias`) numa próxima iteração.
