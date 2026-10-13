import {
  AirtableIntegrationError,
} from "./types.ts"
import type {
  AirtableConfig,
  AirtableRecord,
  JobApplicationFields,
} from "./types.ts"

const DEFAULT_TABLE_NAME = "Job Applications"
const AIRTABLE_API_BASE = "https://api.airtable.com/v0"

export function getAirtableConfig(): AirtableConfig {
  const personalAccessToken = process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN?.trim()
  const baseId = process.env.AIRTABLE_BASE_ID?.trim()
  const tableName =
    process.env.AIRTABLE_TABLE_NAME?.trim() || DEFAULT_TABLE_NAME

  if (!personalAccessToken) {
    throw new AirtableIntegrationError(
      "Airtable configuration missing: 'AIRTABLE_PERSONAL_ACCESS_TOKEN' environment variable is required. " +
        "Generate a Personal Access Token at https://airtable.com/create/tokens with 'data.records:read', " +
        "'data.records:write', and 'schema.bases:read' scopes, and add it to your server-side environment.",
      "CONFIG_MISSING"
    )
  }

  if (!baseId) {
    throw new AirtableIntegrationError(
      "Airtable configuration missing: 'AIRTABLE_BASE_ID' environment variable is required. " +
        "Provide your Airtable Base ID (starts with 'app...') in your server-side environment.",
      "CONFIG_MISSING"
    )
  }

  return {
    personalAccessToken,
    baseId,
    tableName,
  }
}

export function isAirtableConfigured(): boolean {
  return Boolean(
    process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN?.trim() &&
      process.env.AIRTABLE_BASE_ID?.trim()
  )
}

export interface AirtableRequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE"
  path?: string
  params?: Record<string, string | number | boolean | undefined>
  body?: unknown
  config?: AirtableConfig
  fetchFn?: typeof fetch
  maxRetries?: number
  baseDelayMs?: number
}

// In-memory request cache for record lookups within the same process session
const recordCache = new Map<string, { record: AirtableRecord; timestamp: number }>()
const CACHE_TTL_MS = 30_000

export function clearAirtableCache(): void {
  recordCache.clear()
}

export function getCachedRecord(id: string): AirtableRecord | null {
  const cached = recordCache.get(id)
  if (!cached) return null
  if (Date.now() - cached.timestamp > CACHE_TTL_MS) {
    recordCache.delete(id)
    return null
  }
  return cached.record
}

export function setCachedRecord(record: AirtableRecord): void {
  recordCache.set(record.id, { record, timestamp: Date.now() })
}

export async function airtableFetch<T = unknown>(
  options: AirtableRequestOptions
): Promise<T> {
  const config = options.config ?? getAirtableConfig()
  const fetchFn = options.fetchFn ?? fetch
  const method = options.method ?? "GET"
  const maxRetries = options.maxRetries ?? 3
  const baseDelayMs = options.baseDelayMs ?? 200

  const tableEncoded = encodeURIComponent(config.tableName)
  let endpoint = `${AIRTABLE_API_BASE}/${config.baseId}/${tableEncoded}`
  if (options.path) {
    endpoint = `${endpoint}${options.path.startsWith("/") ? "" : "/"}${options.path}`
  }

  if (options.params) {
    const searchParams = new URLSearchParams()
    for (const [key, val] of Object.entries(options.params)) {
      if (val !== undefined && val !== null) {
        searchParams.append(key, String(val))
      }
    }
    const queryString = searchParams.toString()
    if (queryString) {
      endpoint = `${endpoint}?${queryString}`
    }
  }

  let attempt = 0
  let lastError: Error | null = null

  while (attempt <= maxRetries) {
    try {
      const response = await fetchFn(endpoint, {
        method,
        headers: {
          Authorization: `Bearer ${config.personalAccessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
      })

      if (response.ok) {
        return (await response.json()) as T
      }

      // Handle specific HTTP error status codes
      const status = response.status
      let errorBody: any = null
      try {
        errorBody = await response.json()
      } catch {
        // Non-JSON response body
      }

      const errorMessage =
        errorBody?.error?.message ||
        errorBody?.error?.type ||
        response.statusText ||
        `HTTP Error ${status}`

      if (status === 401) {
        throw new AirtableIntegrationError(
          `Airtable authentication failed (401): The provided personal access token is invalid or expired. ${errorMessage}`,
          "UNAUTHORIZED",
          401,
          errorBody
        )
      }

      if (status === 403) {
        throw new AirtableIntegrationError(
          `Airtable permission denied (403): Your token lacks required permissions or does not have access to base '${config.baseId}'. ` +
            `Ensure the token includes 'data.records:read' and 'data.records:write' scopes. ${errorMessage}`,
          "FORBIDDEN",
          403,
          errorBody
        )
      }

      if (status === 404) {
        throw new AirtableIntegrationError(
          `Airtable resource not found (404): Check that base ID '${config.baseId}' and table '${config.tableName}' exist. ${errorMessage}`,
          "NOT_FOUND",
          404,
          errorBody
        )
      }

      if (status === 422) {
        throw new AirtableIntegrationError(
          `Airtable invalid field or payload (422): ${errorMessage}. ` +
            `Check that the schema fields (like 'Company', 'Job Title', 'Status') match the expected table properties.`,
          "INVALID_FIELD",
          422,
          errorBody
        )
      }

      // Rate limit (429) or transient server errors (500, 502, 503, 504) -> retry
      if (status === 429 || (status >= 500 && status <= 504)) {
        attempt++
        if (attempt > maxRetries) {
          const code = status === 429 ? "RATE_LIMITED" : "API_ERROR"
          throw new AirtableIntegrationError(
            `Airtable request failed after ${maxRetries} retries (${status}): ${errorMessage}`,
            code,
            status,
            errorBody
          )
        }

        // Check for Retry-After header
        const retryAfterHeader = response.headers.get("Retry-After")
        let delayMs = baseDelayMs * Math.pow(2, attempt - 1)
        if (retryAfterHeader) {
          const parsedSeconds = parseInt(retryAfterHeader, 10)
          if (!isNaN(parsedSeconds)) {
            delayMs = Math.max(delayMs, parsedSeconds * 1000)
          }
        }

        await new Promise((resolve) => setTimeout(resolve, delayMs))
        continue
      }

      throw new AirtableIntegrationError(
        `Airtable API error (${status}): ${errorMessage}`,
        "API_ERROR",
        status,
        errorBody
      )
    } catch (err) {
      if (err instanceof AirtableIntegrationError) {
        throw err
      }

      lastError = err instanceof Error ? err : new Error(String(err))
      attempt++

      if (attempt > maxRetries) {
        throw new AirtableIntegrationError(
          `Airtable network or connection error: ${lastError.message}`,
          "API_ERROR",
          undefined,
          lastError
        )
      }

      const delayMs = baseDelayMs * Math.pow(2, attempt - 1)
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }

  throw new AirtableIntegrationError(
    `Airtable request failed: ${lastError?.message || "Unknown error"}`,
    "API_ERROR"
  )
}
