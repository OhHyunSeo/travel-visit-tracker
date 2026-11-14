import { defineConfig } from 'vitest/config';
export default defineConfig({
  resolve: {
    extensions: ['.native.ts', '.native.tsx', '.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json'],
  },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
