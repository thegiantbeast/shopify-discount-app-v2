import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["app/tests/**/*.test.{js,jsx}"],
    exclude: ["app/tests/e2e/**", "node_modules"],
    setupFiles: ["./app/tests/setup.js"],
    coverage: {
      provider: "v8",
      include: [
        "app/utils/**",
        "app/routes/api.*.jsx",
        "app/routes/webhooks.*.jsx",
      ],
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 50,
        statements: 60,
      },
    },
  },
});
