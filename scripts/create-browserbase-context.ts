import { Browserbase } from "@browserbasehq/sdk";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const apiKey = process.env.BROWSERBASE_API_KEY;
const projectId = process.env.BROWSERBASE_PROJECT_ID;

if (!apiKey || !projectId) {
  console.error("❌ Missing BROWSERBASE_API_KEY or BROWSERBASE_PROJECT_ID in .env.local");
  process.exit(1);
}

const bb = new Browserbase({ apiKey });

async function run() {
  console.log("=========================================");
  console.log("Creating new Browserbase Context...");
  
  // 1. Create a persistent context
  const context = await bb.contexts.create({ projectId });
  console.log(`\n✅ Context Created!`);
  console.log(`ID: ${context.id}`);
  console.log(`-> Add this line to your .env.local:\n   BROWSERBASE_CONTEXT_ID=${context.id}`);
  
  // 2. Start a session to let the user log in
  console.log("\nStarting a live session so you can log in manually...");
  const session = await bb.sessions.create({
    projectId,
    browserSettings: {
      context: { id: context.id, persist: true },
    },
    keepAlive: true, // Keep it open for you to log in
  });

  const debug = await bb.sessions.debug(session.id);
  const liveUrl = debug.debuggerFullscreenUrl;
  
  console.log(`\n👉 OPEN THIS URL TO LOG IN: ${liveUrl}`);
  console.log("=========================================");
  console.log("Instructions:");
  console.log("1. Open the URL above in your normal browser.");
  console.log("2. Navigate to LinkedIn (or whatever site you need).");
  console.log("3. Log in with your credentials and solve any captchas manually.");
  console.log("4. Once logged in, close the tab.");
  console.log("The login session (cookies/storage) is automatically saved to the Context!");
  console.log("Future agent runs will start fully authenticated.");
}

run().catch(console.error);
