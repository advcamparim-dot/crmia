# Runbook: canal WhatsApp do escritório (Evolution)

Sem senhas, tokens nem dados de clientes. Atualizado em 14/10/2026.

## O que o sistema faz sozinho (com `canal_vigia = 'true'`)
- **Vigia (`Canal: Vigia`)**: a cada 2 minutos lê o estado da instância `escritorio` na Evolution.
- **Piscada curta** (`connecting` por até 6 minutos): não faz nada, só espera.
- **Queda (`close`)**: tenta reiniciar a instância até 3 vezes, com 4 minutos entre as tentativas.
- **Sem sucesso**: avisa por e-mail e cria uma tarefa no CRM; repete o aviso (e-mail) a cada 60 minutos, até 12 vezes.
- **Evolution inalcançável** (a própria API não responde): alerta depois de 6 minutos, sem tentar reiniciar.
- **Ao voltar (`open`)**: recupera as mensagens do período (`Canal: Recuperar`) e repete essa checagem a cada 15 minutos como rede de segurança.
- **Resposta feita pelo celular**: o lead é assumido (a Mayara para) e o texto vai para a memória dela como "Mensagem enviada por uma pessoa do escritório: ...". Devolver o lead é decisão sua (`/devolver`).

## Quando chegar o alerta
1. Abra o painel da Evolution, instância `escritorio`, e use **Conectar** para ler o QR no celular do escritório.
2. Confira no celular se algum lead ficou sem resposta durante a queda: mensagens recebidas com a conexão caída podem não ser reentregues.
3. Depois que o canal voltar a `open`, o sistema recupera sozinho o que a Evolution ainda tiver.

## Conferências úteis (SQL)
```sql
select estado, queda_desde, tentativas_restart, sincronizado_ate from mayara.canal_estado where canal_id = 'escritorio';
select direcao, origem, visto_em from mayara.mensagens_canal_vistas order by visto_em desc limit 20;
```

## Chaves
- Desligar o vigia: `update mayara.config set valor = 'false' where chave = 'canal_vigia';` (o webhook continua funcionando como antes).
- Reter todas as respostas automáticas: `respostas_retidas = 'true'` (mensagens ficam guardadas em `mayara.eventos_adiados`); liberar: `'false'`.
- Destino dos alertas: `alerta_email_destino` em `mayara.config`.

## Checklist de causa raiz das quedas (Evolution no Coolify)
- Logs do contêiner em torno do horário da queda: o código da desconexão indica a causa (401 desvinculado; 440 sessão substituída).
- Segunda instância ou contêiner usando o mesmo número.
- Variável `DEL_INSTANCE`: deve ficar `false` (um valor numérico apaga instâncias desconectadas após N minutos).
- Volume persistente da instância e reinício do contêiner (memória).
- Versão da imagem e da versão do WhatsApp Web (`CONFIG_SESSION_PHONE_VERSION`).

## Limites e riscos
- A Evolution não oficial pode ser desvinculada pelo WhatsApp; o caminho de fundo é a API oficial da Meta (decisão pendente).
- O `PUT /instance/restart/escritorio` ainda não foi exercitado em produção (ver ensaio de reinício no plano).
