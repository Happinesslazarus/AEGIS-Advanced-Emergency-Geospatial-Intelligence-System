import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/__tests__/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'lcov'],
      reportsDirectory: 'coverage',
      include: [
        'src/components/citizen/**/*.{ts,tsx}',
        'src/components/shared/**/*.{ts,tsx}',
        'src/hooks/**/*.ts',
        'src/utils/**/*.ts',
        'src/data/**/*.ts',
      ],
      exclude: ['src/__tests__/**', 'src/**/*.d.ts'],
    },
  },
})
