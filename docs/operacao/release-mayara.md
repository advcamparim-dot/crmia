# Release da Mayara

## Fonte canônica

Os exports em `docs/superpowers/specs/workflows/` são a fonte canônica versionada dos workflows. Pastas locais de backup, downloads e cópias antigas não são fonte de deploy.

## Timeout do n8n

O n8n define timeout de execução pela instância, não pelo JSON de um workflow. Antes de uma publicação, configurar no ambiente da instância:

```text
EXECUTIONS_TIMEOUT=90
EXECUTIONS_TIMEOUT_MAX=120
```

Esses valores são em segundos. Eles devem primeiro ser aplicados em ambiente de teste ou em janela supervisionada: o timeout global pode cancelar qualquer workflow que ultrapasse o limite. O workflow de linguagem livre já trata erro com saída segura; um timeout deve produzir essa saída/alerta, nunca uma mensagem improvisada ao lead.

## Checklist de publicação

1. Conferir que a migration possui teste SQL em `supabase/tests/` e executar o arquivo inteiro em transação revertida.
2. Aplicar a migration somente depois do teste verde e confirmar as permissões/RLS descritas nela.
3. Gerar o workflow por seu script fonte, quando houver, e validar o JSON com `jq -e .`.
4. Obter o workflow ativo do n8n e comparar nome, nós, conexões, credenciais por referência e configuração de erro com o export versionado.
5. Executar teste controlado com lead fictício/autorizado. Não usar número real nem enviar mensagem de produção para testar.
6. Consultar a execução no n8n: sucesso, erro tratado ou timeout precisam aparecer de forma explícita.
7. Só então ativar a alteração. Guardar ID da execução e data no handoff.

## Contingência

- Falha ou timeout de modelo: revisar a execução e encaminhar o caso para humano; não repetir automaticamente conteúdo não validado.
- Divergência entre workflow ativo e export: pausar a publicação, corrigir a fonte versionada e repetir a comparação.
- Falha de migration: não prosseguir para workflow; reverter pela estratégia aprovada para a migration específica.
