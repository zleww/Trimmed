import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // each db test file starts its own in-memory Postgres, two at a time is enough
    maxWorkers: 2,
    // a fresh in-memory Postgres per test is slow on a busy laptop; 5 s (the default) was too tight
    testTimeout: 30000,
    hookTimeout: 30000,
  },
})
