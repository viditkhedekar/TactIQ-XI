import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Next reads .env.local, so the CLI tooling has to as well or the two disagree
// about which database they are pointing at.
config({ path: ".env.local" });
config({ path: ".env" });

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
});
