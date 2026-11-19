import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': resolve(import.meta.dirname, 'src/web') } },
  test: {
    include: ['test/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
    environment: 'node',
    env: { LOG_LEVEL: 'error' },
    testTimeout: 10_000,
  },
});
