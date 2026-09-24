import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  plugins: [
    // Markdown as text, like the ".md" loader of the Angular build (CHANGELOG.md)
    {
      name: 'markdown-as-text',
      enforce: 'pre',
      transform(code, id) {
        return id.endsWith('.md') ? { code: `export default ${JSON.stringify(code)};`, map: null } : null;
      },
    },
  ],
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.spec.ts', 'tools/**/*.spec.ts', 'coop-server/**/*.spec.ts'],
    exclude: ['node_modules', 'dist'],
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
