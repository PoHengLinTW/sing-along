/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:3100' } },
  test: {
    environment: 'jsdom',
    globals: false,
    testTimeout: 15_000,
    setupFiles: ['./src/test/setup.ts'],
  },
});
