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
    // A test that hangs still fails; one that reads every source file, packs a few MB or runs a wave bit
    // for bit took 2 to 5 s alone and ran past vitest's default of 5 s when the whole suite loaded the
    // machine (asset-paths, resync, lockstep, plinth braces). Wall-clock budgets: src/test/perf-budget.ts
    testTimeout: 30_000,
    hookTimeout: 30_000,
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
