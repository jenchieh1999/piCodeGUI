// ============================================================
// Pi Agent Server - Build Script
// Compiles the server into a standalone Node bundle.
// ============================================================

import { build } from 'esbuild';

async function main() {
  await build({
    entryPoints: ['./index.ts'],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    outfile: './dist/server.cjs',
    external: [
      '@earendil-works/pi-coding-agent',
      '@homebridge/node-pty-prebuilt-multiarch',
      '@mariozechner/clipboard',
    ],
    sourcemap: true,
    minify: false,
  });

  console.log('Server built to dist/server.cjs');
}

main().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
