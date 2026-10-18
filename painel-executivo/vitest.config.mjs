import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // O tsconfig usa jsx: preserve (para o Next); nos testes o esbuild transforma o JSX.
  oxc: { jsx: { runtime: 'automatic' } },
  resolve: { alias: { '@': path.resolve(import.meta.dirname, '.') } },
  test: {
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
  },
});
