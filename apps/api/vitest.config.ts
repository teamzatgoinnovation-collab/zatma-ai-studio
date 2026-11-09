import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC emits decorator metadata, which NestJS dependency injection relies on.
const plugins = [swc.vite({ module: { type: 'es6' }, jsc: { target: 'es2023' } })];

export default defineConfig({
  test: {
    projects: [
      {
        plugins,
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          environment: 'node',
          setupFiles: ['./test/setup-env.ts'],
        },
      },
      {
        plugins,
        test: {
          name: 'e2e',
          include: ['test/**/*.e2e-spec.ts'],
          environment: 'node',
          setupFiles: ['./test/setup-env.ts'],
          globalSetup: ['./test/global-setup.ts'],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
