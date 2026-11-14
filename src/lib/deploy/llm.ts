import type { GoogleGenAI } from "@google/genai";

// The model the app builder talks to. It reads the same keys as the rest of Forma (GEMINI_API_KEY or
// OPENAI_API_KEY, AI_PROVIDER), but it is its own small client: the worker runs as a plain Node process,
// where the app's "@/" imports and "server-only" do not exist.

export type LlmMessage = { role: "user" | "assistant"; content: string };

export type LlmRequest = {
  system: string;
  messages: LlmMessage[];
  signal?: AbortSignal;
};

export type LlmResult = {
  text: string;
  // The model ran out of room and stopped in the middle of its answer.
  truncated: boolean;
};

export type Llm = {
  provider: "gemini" | "openai";
  model: string;
  complete(request: LlmRequest): Promise<LlmResult>;
};

type Env = Record<string, string | undefined>;

const CALL_TIMEOUT_MS = 8 * 60_000;
const GEMINI_MAX_TOKENS = 60_000;
const OPENAI_MAX_TOKENS = 32_000;
const TEMPERATURE = 0.3;

export const AI_SETUP_HINT = "Add GEMINI_API_KEY (or OPENAI_API_KEY) to .env.local and restart the worker.";

// Returns null when no key is configured, so the caller can explain what to add.
export function loadLlm(env: Env = process.env): Llm | null {
  const geminiKey = (env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY ?? "").trim();
  const openaiKey = (env.OPENAI_API_KEY ?? "").trim();
  const choice = (env.AI_PROVIDER ?? "").trim().toLowerCase();
  const override = (env.DEPLOY_MODEL ?? "").trim();
  const maxTokens = Number(env.DEPLOY_MAX_OUTPUT_TOKENS);

  const wantsOpenAI = choice === "openai" || (choice !== "gemini" && choice !== "google" && !geminiKey);
  if (wantsOpenAI) {
    if (!openaiKey) return null;
    return openAiLlm(openaiKey, override || (env.OPENAI_MODEL ?? "").trim() || "gpt-4.1-mini", positive(maxTokens) ?? OPENAI_MAX_TOKENS);
  }
  if (!geminiKey) return null;
  return geminiLlm(geminiKey, override || (env.GEMINI_MODEL ?? "").trim() || "gemini-2.5-flash", positive(maxTokens) ?? GEMINI_MAX_TOKENS);
}

function positive(value: number) {
  return Number.isInteger(value) && value > 0 ? value : null;
}

function withTimeout(signal: AbortSignal | undefined) {
  const timeout = AbortSignal.timeout(CALL_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function geminiLlm(apiKey: string, model: string, maxOutputTokens: number): Llm {
  let client: GoogleGenAI | undefined;
  return {
    provider: "gemini",
    model,
    complete: (request) =>
      withRetry(async () => {
        if (!client) {
          const { GoogleGenAI } = await import("@google/genai");
          client = new GoogleGenAI({ apiKey });
        }
        const response = await client.models.generateContent({
          model,
          contents: toGeminiContents(request.messages),
          config: {
            systemInstruction: request.system,
            temperature: TEMPERATURE,
            maxOutputTokens,
            abortSignal: withTimeout(request.signal),
          },
        });
        return {
          text: response.text ?? "",
          truncated: response.candidates?.[0]?.finishReason === "MAX_TOKENS",
        };
      }, request.signal),
  };
}

function toGeminiContents(messages: LlmMessage[]) {
  return messages.map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: message.content }],
  }));
}

function openAiLlm(apiKey: string, model: string, maxTokens: number): Llm {
  return {
    provider: "openai",
    model,
    complete: (request) =>
      withRetry(async () => {
        const { default: OpenAI } = await import("openai");
        const client = new OpenAI({ apiKey });
        const completion = await client.chat.completions.create(
          {
            model,
            temperature: TEMPERATURE,
            max_completion_tokens: maxTokens,
            messages: [{ role: "system", content: request.system }, ...request.messages],
          },
          { signal: withTimeout(request.signal) },
        );
        const choice = completion.choices[0];
        return { text: choice?.message.content ?? "", truncated: choice?.finish_reason === "length" };
      }, request.signal),
  };
}

const TRANSIENT = /\b(408|429|500|502|503|504)\b|overloaded|unavailable|resource_exhausted|rate limit|timed? ?out|econnreset|fetch failed/i;

export function isTransient(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const status = (error as { status?: unknown }).status;
  if (typeof status === "number") return [408, 429, 500, 502, 503, 504].includes(status);
  return TRANSIENT.test(error.message);
}

// A busy model answers 429 or 503 now and then. Wait a little and ask again before giving up.
export async function withRetry<T>(
  run: () => Promise<T>,
  signal?: AbortSignal,
  options: { waits?: number[]; sleep?: (ms: number, signal?: AbortSignal) => Promise<void> } = {},
): Promise<T> {
  const waits = options.waits ?? [4000, 12000];
  const sleep = options.sleep ?? defaultSleep;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (signal?.aborted || attempt >= waits.length || !isTransient(error)) throw error;
      await sleep(waits[attempt], signal);
    }
  }
}

function defaultSleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}
