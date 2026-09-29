// Bundles the server and the cleanup CLI into dist/ for the production image. One bundle per entry
// keeps node_modules out of the image (the workspace's shared package is TypeScript source, which
// Node cannot load from node_modules anyway).
import { build } from 'esbuild';

await build({
  entryPoints: { server: 'src/server.ts', 'cleanup-cli': 'src/cleanup-cli.ts' },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  logLevel: 'info',
  external: ['pg-native'], // optional native driver of pg, never used here
  // Some bundled CommonJS dependencies call require() for Node built-ins.
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
});
