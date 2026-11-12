import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // The live smoke test runs only through `npm run test:smoke` (vitest.smoke.config.ts).
    exclude: ['test/**/*.smoke.test.ts', 'node_modules/**'],
    environment: 'node',
    testTimeout: 15_000,
  },
});
