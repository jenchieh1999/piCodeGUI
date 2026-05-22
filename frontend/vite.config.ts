import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  server: {
    port: 1420,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:1421',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://127.0.0.1:1421',
        ws: true,
      },
    },
  },
  clearScreen: false,
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: process.env.TAURI_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_DEBUG,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replace(/\\/g, '/');
          if (!normalizedId.includes('node_modules')) return undefined;
          if (normalizedId.includes('react-dom') || normalizedId.includes('react/')) return 'vendor-react';
          if (normalizedId.includes('zustand')) return 'vendor-state';
          if (normalizedId.includes('lucide-react')) return 'vendor-icons';
          if (normalizedId.includes('@xterm')) return 'vendor-terminal';
          if (normalizedId.includes('@codemirror/lang-javascript')) return 'codemirror-lang-javascript';
          if (normalizedId.includes('@codemirror/lang-json')) return 'codemirror-lang-json';
          if (normalizedId.includes('@codemirror/lang-html')) return 'codemirror-lang-html';
          if (normalizedId.includes('@codemirror/lang-css')) return 'codemirror-lang-css';
          if (normalizedId.includes('@codemirror/lang-markdown')) return 'codemirror-lang-markdown';
          if (normalizedId.includes('@codemirror/lang-python')) return 'codemirror-lang-python';
          if (normalizedId.includes('@codemirror/lang-sql')) return 'codemirror-lang-sql';
          if (normalizedId.includes('@codemirror/lang-xml')) return 'codemirror-lang-xml';
          if (normalizedId.includes('@codemirror/lang-yaml')) return 'codemirror-lang-yaml';
          if (normalizedId.includes('@codemirror/lang-java')) return 'codemirror-lang-java';
          if (normalizedId.includes('@codemirror/lang-cpp')) return 'codemirror-lang-cpp';
          if (normalizedId.includes('@codemirror/lang-php')) return 'codemirror-lang-php';
          if (normalizedId.includes('@codemirror/lang-rust')) return 'codemirror-lang-rust';
          if (normalizedId.includes('@codemirror/legacy-modes')) return 'codemirror-legacy-modes';
          if (normalizedId.includes('@codemirror')) return 'vendor-codemirror-core';
          if (normalizedId.includes('@radix-ui')) return 'vendor-radix';
          if (normalizedId.includes('react-virtuoso')) return 'vendor-virtuoso';
          if (normalizedId.includes('marked') || normalizedId.includes('dompurify')) return 'vendor-markdown';
          return undefined;
        },
      },
    },
  },
});
