// Bundle the server into dist/ so the runtime image needs no node_modules.
import { build } from 'esbuild';

await build({
  entryPoints: {
    server: 'src/server/main.ts',
    healthcheck: 'src/server/healthcheck.ts',
    validate: 'src/server/validate-cli.ts',
  },
  outdir: 'dist',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  minify: true,
  sourcemap: false,
  legalComments: 'linked',
  // Some CommonJS dependencies call require(); give ESM output a working one.
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  logLevel: 'info',
});
