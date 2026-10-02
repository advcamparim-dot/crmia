# Mayara no número do escritório (coexistência) — design

Data: 2026-10-02
Status: rascunho para revisão do usuário
Relacionados: `2026-09-21-mayara-banco-leads-autorizados-design.md` (base de leads e portão), plano `2026-09-21-mayara-banco-leads-autorizados.md` (Task 7 e Task 10)

## Objetivo

Conectar a Mayara ao número do WhatsApp do escritório, que hoje está no app WhatsApp Business no celular e já recebe mensagens de clientes, **sem tirar o número do app**. A equipe continua atendendo pelo app como hoje. A Mayara só responde a números da base `mayara.leads_autorizados`, que no início tem apenas o número de teste do usuário.

Fora do escopo: o canal de comando pelo número do usuário (parte B, desenho separado), a transcrição de áudio e a abertura para leads reais (Task 10 do plano de leads).

## Decisões já tomadas com o usuário

1. **Coexistência da Meta**: o número fica no app e na Cloud API ao mesmo tempo.
2. **Caminho Tech Provider**: o próprio app da Meta do escritório vira Tech Provider. Sem BSP e sem troca de API (`graph.facebook.com` continua).
3. **Número fora da base = silêncio total**: a Mayara não responde, não alerta e não registra. A equipe atende pelo app.

## Fatos da Meta que restringem o desenho

- A coexistência só pode ser conectada por Solution Partner ou Tech Provider, pelo cadastro incorporado (Embedded Signup). O app precisa estar na versão 2.24.17+ e o número precisa ter pelo menos 7 dias de uso no app. O Brasil é suportado desde abril de 2026.
- As mensagens ficam espelhadas: o que a equipe manda pelo app chega como webhook `smb_message_echoes`. O histórico de até 180 dias chega pelo webhook `history`, e os contatos pelo `smb_app_state_sync`, depois de uma chamada de sincronização que tem de acontecer nas primeiras 24 horas.
- No app deixam de funcionar: mensagens temporárias, visualização única e localização em tempo real (1:1), listas de transmissão, sincronização de grupos. Os aparelhos companheiros (WhatsApp Web) são desconectados na conexão e precisam ser pareados de novo.
- O app precisa ser aberto ao menos a cada 13 dias. O limite de envio é de 20 mensagens/s. Não há selo azul.
- A tentativa de "Adicionar número" pelo painel do app (sem coexistência) migraria o número para fora do app. **Esse caminho é proibido** neste projeto.

## Estado atual que o desenho precisa considerar

- O Gateway (`FV0PEtEcTFbuoRaO`) lê `value.messages[0]`. Eventos sem `messages` (status, e, por construção, `smb_message_echoes`, `history`, `smb_app_state_sync`) saem como `EVENTO_SEM_MENSAGEM` e são ignorados.
- O Gateway monta o `sessionKey` com o `phone_number_id` do próprio evento, e a Ponte e os workers de follow-up e lembretes enviam pela Graph API usando o `phone_number_id` da sessão. Esses pontos **não precisam mudar** com o número novo.
- O id `1365007506685934` está fixo em dois workflows: `Mayara — Alertar Escritório [Sub-workflow]` (`FWSC1k1CBMWBtsNs`) e `Receber Lead do Formulário` (`u7BM28YtcvFetEAz`, inativo), e nos testes SQL (só como dado fictício).
- Hoje áudio, imagem e documento de **qualquer** número passam pelo desvio "requer humano" e criam uma Task de prioridade alta no EspoCRM, sem passar pela lista fixa.
- As sessões existentes em `mayara.session_state` têm o id antigo na chave. Com o número novo, as conversas do número de teste começam do zero (aceitável: são de teste).

## Componentes

### 1. Pré-requisito: portão no Gateway (Task 7, revista)

A Task 7 do plano de leads entra **antes** da conexão, com duas mudanças decorrentes da decisão 3:

- O portão fica logo depois de `Normalizar e Filtrar Evento` e antes de `Evento Autorizado?`, para cobrir também o desvio "requer humano".
- Evento sem telefone (status e eventos da coexistência) segue o caminho de hoje, sem consulta.
- Número com `motivo_bloqueio` diferente de nulo: **fim silencioso**. Os nodes `Registrar Não Cadastrado`, `Avisar?` e `Alertar Não Cadastrado` do plano original saem do escopo.
- Falha na consulta ao banco: fail-closed com alerta ao escritório (`Alertar Falha do Portão`), como no plano.
- A lista fixa no código continua até a Task 10 (modo interseção).

### 2. Página "Conectar WhatsApp" (cadastro incorporado)

Hospedada no próprio n8n, sem infraestrutura nova:

- `GET https://n8n.camparimadvogados.com.br/webhook/conectar-whatsapp` devolve uma página HTML com o SDK JS da Meta e o botão de cadastro incorporado, com o `config_id` da configuração criada no painel e o modo de coexistência (`featureType` de onboarding de usuários do app; nome exato conferido na documentação na implementação).
- A página recebe do fluxo da Meta o `code`, o `waba_id` e o `phone_number_id` e faz `POST` para `.../webhook/conectar-whatsapp/concluir`, protegido por um segredo de uso único (mesmo padrão do token do formulário: só o hash SHA-256 em `mayara.config`).
- O domínio `n8n.camparimadvogados.com.br` é registrado como domínio permitido no Login do Facebook para Empresas.
- A página é de uso único. Depois da conexão, o workflow é desativado.

### 3. Workflow "Concluir Conexão do WhatsApp"

Recebe o `POST` da página e, em ordem, para no primeiro erro e alerta o escritório:

1. Troca o `code` por token (`GET /oauth/access_token` com app id e app secret guardados em credencial do n8n, nunca no código).
2. Assina o app nos webhooks da WABA nova (`POST /{waba_id}/subscribed_apps`).
3. Dispara a sincronização de contatos e de histórico (`POST /{phone_number_id}/smb_app_data`, os dois tipos), dentro da janela de 24 horas.
4. Grava `waba_id` e `phone_number_id` em `mayara.config` (`whatsapp_waba_id`, `whatsapp_phone_number_id`).
5. Responde à página com sucesso ou com o passo que falhou.

O token devolvido pela troca não é usado para enviar mensagens: o envio continua com a credencial atual (`Bearer Auth account`), depois que o usuário atribui a WABA nova ao usuário do sistema dessa credencial nas configurações do negócio. Assim nenhuma credencial nova entra nos workflows de envio.

### 4. Troca do número nos workflows

- `Mayara — Alertar Escritório` e `Receber Lead do Formulário`: o id fixo é trocado pelo novo. (Ler de `mayara.config` em cada execução foi descartado: custa uma consulta por alerta para um valor que muda uma vez.)
- O webhook do app (o mesmo Gateway) já recebe os eventos da WABA nova depois do passo 3.2. Nenhuma URL muda.
- O número antigo `1365007506685934` fica sem uso. Desligar ou manter é decisão do usuário, depois do teste.

## Fluxo de dados depois da conexão

- **Número da base escreve** → Meta → Gateway → portão libera → Ponte → Mayara → resposta pela Graph API → aparece também no app do escritório.
- **Qualquer outro número escreve** → Gateway → portão: fim silencioso. A equipe vê e responde pelo app, e a resposta dela chega ao Gateway como eco e é ignorada.
- **Equipe responde ao número de teste pelo app** → eco ignorado. A Mayara não vê a mensagem da equipe (limitação aceita nesta fase; anotada para a parte B).

## Erros e riscos

| Risco | Tratamento |
|---|---|
| Eco ou histórico acordar a Mayara | Teste específico com payload de `smb_message_echoes` e `history` no Gateway antes da conexão: devem sair como `EVENTO_SEM_MENSAGEM`. |
| Cliente real cair na Mayara | O portão (componente 1) é pré-requisito e é verificado em produção antes da conexão. |
| Falha no meio do cadastro incorporado | O workflow para no passo que falhou e alerta. A conexão pode ser refeita pela mesma página. |
| Perder a janela de 24 h da sincronização | A sincronização roda no mesmo workflow, logo após a conexão. |
| Coexistência cair por app parado | Lembrete operacional ao usuário (abrir o app a cada 13 dias). |
| Alertas pararem ao trocar o número | O sub-workflow de alerta é trocado no mesmo passo e testado com uma mensagem ao número do escritório. |

## Testes

1. Gateway com payloads sintéticos (sem envio): eco, histórico, status e mensagem de número fora da base, todos sem chamar a Ponte.
2. Depois da conexão:
   - o número de teste escreve e a Mayara responde, com a resposta visível no app;
   - um segundo número escreve, a Mayara fica em silêncio e a mensagem aparece no app;
   - a equipe responde pelo app e a Mayara não reage.
3. Um alerta de teste chega pelo número novo.
4. O follow-up e o lembrete do número de teste saem pelo número novo (próxima execução dos workers).

## Ordem de execução

1. Usuário: verificação da empresa → Tech Provider (acesso avançado às permissões do WhatsApp) → configuração do cadastro incorporado (`config_id`).
2. Task 7 revista (componente 1), já testável com o número atual.
3. Componentes 2 e 3, inativos até o usuário ter o `config_id`.
4. Usuário conecta pela página (QR code no celular do escritório) e atribui a WABA ao usuário do sistema.
5. Componente 4 e testes.
