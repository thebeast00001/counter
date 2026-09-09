/**
 * Teaches plain Node the project's `@/` path alias.
 *
 * Metro resolves `@/…` from tsconfig, but the audit scripts run under bare Node,
 * which does not read tsconfig. Registering a resolve hook lets those scripts
 * import real source files instead of keeping their own copies — which is the
 * point, since a copy drifts and stops auditing anything.
 *
 *   node --experimental-strip-types --import ./scripts/ts-alias.mjs <script>
 */
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SRC = path.resolve(import.meta.dirname, '..', 'src');

/** TypeScript source omits the extension; Node requires one. */
function withExtension(base) {
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
    if (existsSync(candidate)) return candidate;
  }
  return base;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/')) {
      const resolved = withExtension(path.join(SRC, specifier.slice(2)));
      return nextResolve(pathToFileURL(resolved).href, context);
    }
    return nextResolve(specifier, context);
  },
});
