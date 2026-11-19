import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'src/**/*.test.{ts,tsx}'],
    environment: 'node',
    env: { LOG_LEVEL: 'error' },
    testTimeout: 10_000,
  },
});
