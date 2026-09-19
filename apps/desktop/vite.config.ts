import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const root = path.dirname(fileURLToPath(import.meta.url));

function pkg(name: string): string {
  return path.resolve(root, `../../packages/${name}/src`);
}

export default defineConfig({
  plugins: [react()],
  root,
  base: './',
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@ratecad/core': pkg('core'),
      '@ratecad/geometry': pkg('geometry'),
      '@ratecad/commands': pkg('commands'),
      '@ratecad/tools': pkg('tools'),
      '@ratecad/viewport': pkg('viewport'),
      '@ratecad/io': pkg('io'),
      '@ratecad/ai': pkg('ai'),
    },
  },
});
