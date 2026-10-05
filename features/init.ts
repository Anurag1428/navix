import { tasks } from "@trigger.dev/sdk";
import * as Sentry from "@sentry/node";

// Initialize Sentry for the Trigger.dev background worker
Sentry.init({
  defaultIntegrations: false,
  dsn: "https://2a77547c761ee9d66c9702236eddb3b6@o4510209048838144.ingest.de.sentry.io/4512198943637584",
  // Update this to match the environment you want to track errors for
  environment: process.env.NODE_ENV === "production" ? "production" : "development",
  tracesSampleRate: 1.0,
});

// Register a global onFailure hook to capture errors
tasks.onFailure(({ payload, error, ctx }) => {
  // Check if error is an AI quota or rate-limit error, which are business events we don't want in Sentry
  const isQuotaError = 
    error instanceof Error && 
    (error.message.includes("429") || 
     error.message.toLowerCase().includes("quota") ||
     error.message.toLowerCase().includes("rate limit") ||
     error.name === "AI_APICallError" ||
     error.message.includes("usage period has expired"));

  if (isQuotaError) {
    console.log("Skipping Sentry capture for expected quota/rate-limit error.");
    return;
  }

  Sentry.captureException(error, {
    extra: {
      payload,
      ctx,
    },
  });
});
