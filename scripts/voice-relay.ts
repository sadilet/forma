// Starts the Gemini Live voice relay: npm run voice:relay
// It reads .env.local, so it uses the same GEMINI_API_KEY and SESSION_SECRET as the web app.

import { DEFAULT_LIVE_MODEL, DEFAULT_RELAY_PORT } from "../src/lib/voice/protocol.ts";
import { startVoiceRelay } from "../src/lib/voice/relay.ts";
import { sessionSecret } from "../src/lib/voice/ticket.ts";

const apiKey = process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim() || "";
if (!apiKey) {
  console.error("Voice relay cannot start. Add GEMINI_API_KEY to .env.local.");
  process.exit(1);
}

// Cloud Run sets PORT. Locally VOICE_RELAY_PORT (default 8787) keeps the old habit.
const port = Number(process.env.PORT) || Number(process.env.VOICE_RELAY_PORT) || DEFAULT_RELAY_PORT;
const model = process.env.GEMINI_LIVE_MODEL?.trim() || DEFAULT_LIVE_MODEL;
const relay = startVoiceRelay({
  port,
  apiKey,
  model,
  secret: sessionSecret(),
  host: process.env.VOICE_RELAY_HOST?.trim() || "0.0.0.0",
  log: (line) => console.log(`[voice] ${line}`),
});

console.log(`Voice relay listening on port ${port}. Model ${model}.`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`Got ${signal}. Closing voice sessions…`);
    void relay.close().then(() => process.exit(0));
  });
}
