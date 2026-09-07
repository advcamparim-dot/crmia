// Suppress Vite config loader warning
process.env.VITE_CONFIG_NATIVE_IGNORE_WARNING = 'true';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
  },
});
