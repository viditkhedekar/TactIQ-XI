import { defineConfig } from "vitest/config";
import path from "node:path";

// Two suites: "unit" runs on every change, "sanity" runs long multi-season
// simulations and is opt-in via `npm run test:sanity`.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  test: {
    include: ["src/**/__tests__/**/*.test.ts"],
    exclude: ["**/node_modules/**", "src/**/__tests__/**/*.sanity.test.ts"],
    environment: "node",
  },
});
