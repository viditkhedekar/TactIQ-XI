import { defineConfig } from "vitest/config";
import path from "node:path";

// Long-running realism checks: many simulated seasons per assertion.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  test: {
    include: ["src/**/__tests__/**/*.sanity.test.ts"],
    environment: "node",
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});
