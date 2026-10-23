import { neon } from "@neondatabase/serverless"
import { drizzle } from "drizzle-orm/neon-http"
import { Agent, setGlobalDispatcher } from "undici"
import * as schema from "./schema"

// Prevent IPv6 timeout issues on networks where IPv6 is advertised but not routed to AWS
try {
  setGlobalDispatcher(
    new Agent({
      connect: {
        autoSelectFamily: false,
      },
    })
  )
} catch {}

const sql = neon(process.env.DATABASE_URL!)
export const db = drizzle(sql, { schema })
export * from "./schema"