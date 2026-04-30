import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@kana-typing/game-runtime',
    environment: 'jsdom',
    include: ['test/**/*.test.ts'],
    globals: false,
  },
});
