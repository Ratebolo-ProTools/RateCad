import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: { environment: 'node' },
  resolve: {
    alias: {
      '@ratecad/commands': path.resolve(root, '../commands/src'),
      '@ratecad/core': path.resolve(root, '../core/src'),
      '@ratecad/geometry': path.resolve(root, '../geometry/src'),
      '@ratecad/viewport': path.resolve(root, '../viewport/src'),
    },
  },
});
