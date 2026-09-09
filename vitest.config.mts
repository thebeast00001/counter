import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * Unit tests for the pure layer.
 *
 * The nine scripts in `scripts/` are the older half of this project's testing
 * and are not replaced by it: they import the real source and sweep it against
 * real fixtures, which is how the domain layer is kept honest end to end. What
 * they cannot do is exercise one function's edges cheaply — every one of them
 * runs the whole business — so the small pure functions that decide amounts,
 * matches and error handling were only covered where a sweep happened to reach
 * them.
 *
 * Node environment on purpose. Nothing under test may touch React Native, and a
 * test that needs a renderer is a test that has strayed out of the pure layer.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // The Expo/Metro tree is not resolvable here and nothing pure imports it.
    exclude: ['node_modules/**', 'android/**', 'ios/**'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
