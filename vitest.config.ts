import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    environmentOptions: { happyDOM: { url: 'http://127.0.0.1:3311' } },
    include: ['tests/**/*.test.{ts,tsx}'],
    setupFiles: ['tests/setup.ts'],
    testTimeout: 40_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    reporters: 'verbose',
  },
});
