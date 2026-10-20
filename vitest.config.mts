import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: {
    projects: [
      { test: { name: 'unit', include: ['tests/unit/**/*.test.{ts,tsx}'] } },
      {
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          testTimeout: 15000,
        },
      },
    ],
  },
})
