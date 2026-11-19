import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // each db test file starts its own in-memory Postgres, two at a time is enough
    maxWorkers: 2,
  },
})
