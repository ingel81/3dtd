import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.spec.ts'],
    exclude: ['node_modules', 'dist', 'src/app/app.spec.ts'],
    alias: {
      // Three.js braucht ggf. Mocking — aber erstmal schauen ob's ohne geht
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
