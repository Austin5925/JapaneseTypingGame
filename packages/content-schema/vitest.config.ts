import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@kana-typing/content-schema',
    environment: 'node',
    include: ['test/**/*.test.ts'],
    globals: false,
  },
});
