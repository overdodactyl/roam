// Bundle the extension into a single file for shipping.
//
// - `vscode` is external — it's provided by the host at runtime.
// - Node builtins (fs, path, child_process, http, crypto, os) resolve to
//   Node's own modules via `platform: 'node'`.
// - `format: 'cjs'` — VS Code loads extension entry points as CommonJS.
// - `target: 'node20'` matches our engines / CI Node version.
// - Minified. Sourcemaps are inline so stack traces from users are useful.

import { build } from 'esbuild';

const watch = process.argv.includes('--watch');
const production = process.env.NODE_ENV === 'production' || !watch;

const options = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'out/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  minify: production,
  // External sourcemap for prod (kept out of the vsix via .vscodeignore).
  // Inline in dev so F5 stacktraces resolve to source.
  sourcemap: production ? true : 'inline',
  logLevel: 'info',
};

if (watch) {
  const ctx = await (await import('esbuild')).context(options);
  await ctx.watch();
  // eslint-disable-next-line no-console
  console.log('esbuild: watching for changes…');
} else {
  await build(options);
}
