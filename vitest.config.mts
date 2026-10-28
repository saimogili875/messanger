// vitest.config.ts
// Configuration for Vitest test runner targeting the test database.

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    env: {
      NODE_ENV: "test",
    },
    testTimeout: 20000,
    globals: true,
  },
});
