import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@cakal/core/investment-research': resolve(__dirname, 'packages/core/investment-research/src/index.ts'),
      '@cakal/shared-types': resolve(__dirname, 'packages/shared-types/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.mjs'],
    reporters: 'default',
    coverage: {
      enabled: false,
    },
  },
});
