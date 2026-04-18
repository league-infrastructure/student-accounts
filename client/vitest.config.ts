import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const clientNodeModules = path.resolve(__dirname, 'node_modules');

export default defineConfig({
  plugins: [react()],
  server: {
    fs: {
      allow: [repoRoot],
    },
  },
  resolve: {
    // Force all bare-specifier resolution to use client/node_modules
    // so test files outside client/ find the same React instance.
    alias: {
      react: path.resolve(clientNodeModules, 'react'),
      'react-dom': path.resolve(clientNodeModules, 'react-dom'),
      'react-router-dom': path.resolve(clientNodeModules, 'react-router-dom'),
      'react-router': path.resolve(clientNodeModules, 'react-router'),
      '@testing-library/react': path.resolve(clientNodeModules, '@testing-library/react'),
      '@testing-library/jest-dom': path.resolve(clientNodeModules, '@testing-library/jest-dom'),
      '@tanstack/react-query': path.resolve(clientNodeModules, '@tanstack/react-query'),
      '@testing-library/user-event': path.resolve(clientNodeModules, '@testing-library/user-event'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: [path.resolve(repoRoot, 'tests/client/**/*.test.tsx')],
    setupFiles: [path.resolve(__dirname, 'vitest.setup.ts')],
  },
});
