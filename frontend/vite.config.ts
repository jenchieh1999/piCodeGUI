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
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('react-dom') || id.includes('react/')) return 'vendor-react';
          if (id.includes('zustand')) return 'vendor-state';
          if (id.includes('lucide-react')) return 'vendor-icons';
          if (id.includes('@xterm')) return 'vendor-terminal';
          if (id.includes('@radix-ui')) return 'vendor-radix';
          if (id.includes('react-virtuoso')) return 'vendor-virtuoso';
          if (id.includes('marked') || id.includes('dompurify')) return 'vendor-markdown';
          return undefined;
        },
      },
    },
  },
});
