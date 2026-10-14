# Contrato observado da API da Evolution v2.3.7

Observado em 14/10/2026 por uma sonda agendada (workflow temporário, já apagado). Só a estrutura dos campos foi lida; nenhum texto de mensagem.

## GET /instance/connectionState/escritorio
Resposta com o canal fechado:
```json
{ "instance": { "instanceName": "escritorio", "state": "close" } }
```
O estado fica em `instance.state` (`open`, `connecting`, `close`). `vigia.mjs` (`estadoReal`) lê esse campo.

## POST /chat/findMessages/escritorio
Corpo enviado: `{ "where": { "messageTimestamp": { "gte": <epoch s>, "lte": <epoch s> } }, "page": 1, "offset": 5 }`. A API aceitou o corpo (HTTP 200).
Resposta:
```json
{ "messages": { "total": 0, "pages": 0, "currentPage": 1, "records": [] } }
```
Os registros ficam em `messages.records`. `recuperar.mjs` (`extrairRegistros`) também aceita array direto e `{ records }`.

## Ainda não confirmado (canal fechado durante a sonda)
- Forma de cada registro (`key.id`, `key.fromMe`, `key.remoteJid`, `messageTimestamp`, `message`): esperada igual à do webhook `messages.upsert`. O normalizador reaproveita `normalizarEvolution`.
- Se o filtro `messageTimestamp.gte/lte` realmente filtra. Mitigação já no código: `prepararLote` descarta qualquer registro fora da janela e o limite por execução é de 100 mensagens.
- Se `PUT /instance/restart/escritorio` é o método correto na v2.3.7. Não foi executado. Será conferido no ensaio de reinício (Task 7) e, se falhar, o `Reiniciar Instancia` usa o método que a Evolution indicar.
