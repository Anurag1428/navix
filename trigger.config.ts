import { defineConfig } from "@trigger.dev/sdk";
import { esbuildPlugin } from "@trigger.dev/build/extensions";
import { sentryEsbuildPlugin } from "@sentry/esbuild-plugin";
// Load env vars if they aren't loaded by default
import { config } from "dotenv";
config({ path: ".env.sentry-build-plugin" });

export default defineConfig({
  project: "proj_tehcuffkgcidyoyafhaz",
  runtime: "node",
  logLevel: "log",
  // The max compute seconds a task is allowed to run. If the task run exceeds this duration, it will be stopped.
  // You can override this on an individual task.
  // See https://trigger.dev/docs/runs/max-duration
  maxDuration: 3600,
  retries: {
    enabledInDev: true,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      factor: 2,
      randomize: true,
    },
  },
  // dirs: ["./src/trigger"],
  dirs: ["features"],
  build: {
    external: ["@browserbasehq/stagehand"],
    extensions: [
      esbuildPlugin(
        sentryEsbuildPlugin({
          org: "individual-wrs",
          project: "navix",
          // The token is in .env.sentry-build-plugin
          authToken: process.env.SENTRY_AUTH_TOKEN,
        }),
        { placement: "last", target: "deploy" }
      ),
    ],
  },
});