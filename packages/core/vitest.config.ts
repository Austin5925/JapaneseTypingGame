import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@kana-typing/core',
    environment: 'node',
    include: ['test/**/*.test.ts'],
    globals: false,
  },
});
