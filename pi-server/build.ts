// ============================================================
// Pi Agent Server - Build Script
// Compiles the server into a standalone bundle
// ============================================================

import { build } from 'esbuild';

async function main() {
  await build({
    entryPoints: ['./index.ts'],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    outfile: './dist/server.js',
    external: [
      '@earendil-works/pi-coding-agent',
      '@earendil-works/pi-ai',
      '@earendil-works/pi-agent-core',
      '@earendil-works/pi-tui',
    ],
    sourcemap: true,
    minify: false,
  });

  console.log('✅ Server built to dist/server.js');
}

main().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
