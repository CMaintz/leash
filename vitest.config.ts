import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // provider.ts is a thin fetch wrapper exercised via mocks; cli.ts is glue.
      exclude: ['src/cli.ts'],
    },
  },
});
