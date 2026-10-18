# Atualização de Segurança do Painel — Plano

**Objetivo:** remover as vulnerabilidades de produção apontadas por `npm audit` sem usar atualização forçada nem misturar a mudança com regras comerciais.

## Evidência em 18/10/2026

- `npm audit --omit=dev --json`: 1 crítica (`next`) e 2 altas (`postcss`, `source-map-js`).
- O audit aponta `next@16.4.2` como correção disponível.
- A imagem atual usa Node 20; Next 16 exige Node 20.9 ou superior. A versão alvo de Next aceita React 18.2 ou React 19, portanto React 18 pode permanecer nesta atualização.

## Passos

1. Criar worktree exclusivo e registrar a saída do audit antes da alteração.
2. Confirmar no build que a imagem Node efetiva é ao menos 20.9; trocar `node:20-alpine` por tag com versão mínima explícita se a imagem em uso não atender.
3. Atualizar somente `next` e `eslint-config-next` para `16.4.2`, mantendo `react` e `react-dom` em 18 nesta primeira passagem:

   ```bash
   npm install next@16.4.2
   npm install -D eslint-config-next@16.4.2
   ```

4. Executar os codemods/ajustes exigidos pela documentação do Next 16, especialmente porque `next lint` foi removido nessa versão.
5. Rodar `npm exec vitest run`, `npm run build`, `npm audit --omit=dev --json` e o container local do Dockerfile.
6. Fazer smoke test de `/login`, login, logout, `/painel-executivo` e healthcheck. Não usar senha real em logs ou commits.
7. Só após testes e revisão independente, publicar em janela monitorada e confirmar o healthcheck no Coolify.

## Restrições

- Proibido `npm audit fix --force`.
- Não alterar a abordagem automática nem migrations da Mayara nesta atualização.
- Se Next 16 exigir alteração de API ou falhar no build, parar, registrar o erro e abrir plano de migração específico; não reduzir cobertura nem remover testes para forçar aprovação.
