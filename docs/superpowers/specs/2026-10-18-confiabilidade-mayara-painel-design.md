# Confiabilidade da Mayara e do Painel — Design

## Objetivo

Corrigir os fluxos de continuidade e rastreabilidade da Mayara, melhorar a leitura comercial do painel e reduzir riscos operacionais, **sem alterar a seleção, cadência ou ativação da abordagem automática**.

## Escopo aprovado

1. Uma saída registrada como `abordagem_automatica` deve iniciar normalmente a régua de follow-up, sujeita às mesmas pausas, limites e respostas humanas das demais origens.
2. Todo envio de proposta deve registrar o histórico na sessão canônica retornada por `mayara.sessao_do_lead`, inclusive números com e sem nono dígito.
3. O painel deve deixar de apresentar contagens independentes como funil. Nesta entrega, a área passa a representar produção por período; funil por coorte é evolução posterior, pois exige vínculos históricos entre todas as etapas.
4. Login do painel deve usar sessão revogável no servidor: logout invalida o token, mesmo se ele tiver sido copiado.
5. A operação deve ter timeout explícito e saída segura para chamadas de modelo de linguagem, além de checklist verificável de migrations e workflows.
6. A atualização de dependências vulneráveis do painel será feita como tarefa isolada e controlada: atualizar para a versão segura compatível, executar testes, build e teste manual de login. Não usar atualização forçada.

## Fora de escopo

- Não desligar, pausar ou mudar o algoritmo, a cadência, a janela ou a ativação da abordagem automática.
- Não enviar mensagens reais, modificar workflows ativos no n8n ou aplicar migrations no Supabase nesta etapa de código.
- Não construir ainda o funil completo por coorte.

## Arquitetura

### Mayara: origem, propostas e sessão

A migration de correção ampliará a lista de origens aceitas por `mayara._ultima_saida` para incluir `abordagem_automatica`; assim, `followups_elegiveis` continua sendo a única fonte de decisão para a régua. A seleção, cadência e configuração da abordagem automática permanecem intocadas.

`mayara.confirmar_envio_proposta` deve resolver a chave de sessão por `mayara.sessao_do_lead(p.telefone, chave_sugerida)` antes de inserir no histórico. A proposta e a confirmação permanecem idempotentes.

### Painel: métrica e sessão

O cartão atual chamado Funil será renomeado para Produção no período, pois cada estágio é contado por sua própria data. A consulta permanece útil como visão de volume, mas não apresentará taxa de conversão ou semântica de coorte.

As sessões serão persistidas numa tabela própria com identificador aleatório, hash do token, emissão, expiração e revogação. O cookie continuará `httpOnly`, `secure` em produção e `sameSite=lax`; o token bruto nunca será persistido. `verifySession` validará assinatura, expiração e estado não revogado. Logout revogará a sessão antes de remover o cookie.

### Operação e release

O módulo que chama modelo livre receberá timeout configurável e retorno seguro que não envia conteúdo não validado. Um documento de release definirá a fonte canônica dos workflows como `docs/superpowers/specs/workflows`, com validação: migration aplicada, teste SQL correspondente, exportação/checagem do workflow e teste controlado antes de ativar mudanças.

## Dados e compatibilidade

- Sessões emitidas antes da migration não serão revogáveis; a implantação invalida-as uma vez, exigindo novo login no painel.
- Os comandos existentes de proposta e a abordagem automática não mudam de assinatura nem de comportamento.
- Nenhum dado de lead, conversa ou proposta é removido.

## Tratamento de falhas

- Falha de modelo ou timeout: registrar motivo e retornar resposta de contingência/encaminhamento, sem enviar texto inventado.
- Sessão ausente ou revogada: redirecionar ao login.
- Proposta não liberada: não pode ser selecionada pelo worker; o fluxo manual continua disponível.
- Divergência de workflow/migration: bloqueia ativação até revisão humana.

## Testes e aceitação

1. Uma saída `abordagem_automatica` sem resposta torna-se elegível no horário correto; uma resposta humana bloqueia a régua.
2. Envio de proposta para variante de telefone grava apenas na sessão canônica.
3. Token válido passa; token adulterado, expirado ou revogado falha; logout invalida seu token.
4. Painel rotula as quantidades como Produção no período, sem promessa de conversão.
5. Timeout de modelo retorna contingência previsível.
6. Suite de testes, testes do painel e build passam após cada conjunto de mudanças.

## Decisões

- A abordagem automática continua ativa e intocada, conforme instrução expressa do escritório.
- Não se deve contornar o controle de canal nesta entrega.
- Funil por coorte será especificado depois que os vínculos históricos de lead, consulta, proposta e contrato forem auditados.
