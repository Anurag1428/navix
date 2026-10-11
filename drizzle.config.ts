import { defineConfig } from "drizzle-kit"
import { config } from "dotenv"

config({ path: ".env.local" })

const dbUrl = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL

if (!dbUrl) {
  throw new Error("DATABASE_URL or DATABASE_URL_UNPOOLED is not set in .env.local")
}

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./lib/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: dbUrl,
  },
})
