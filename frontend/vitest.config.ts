import { defineConfig } from 'vitest/config';

// Pin the process time zone for every run: date-sensitive specs (e.g.
// localDateString) need a UTC+7 zone so local and UTC dates differ around
// midnight. Set on the main process so forks and threads workers inherit it
// regardless of pool type.
process.env.TZ = 'Asia/Ho_Chi_Minh';

export default defineConfig({
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.spec.{ts,tsx}'],
    restoreMocks: true,
  },
});
