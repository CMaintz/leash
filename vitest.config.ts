import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // cli.ts and its cli-* modules run in a child process in test/cli.test.ts, which v8
      // coverage can't see; those spawn tests are what cover them.
      exclude: ['src/cli.ts', 'src/cli-*.ts'],
    },
  },
});
