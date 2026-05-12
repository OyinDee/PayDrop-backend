import "dotenv/config";
import { defineConfig, env } from "prisma/config";

/**
 * Prisma 7+ requires database URLs here (not in schema.prisma).
 * Loads DATABASE_URL from .env via dotenv/config above.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: env("DATABASE_URL"),
  },
});
