import "server-only";

import { GoogleGenAI, type Content } from "@google/genai";
import { zodResponseFormat } from "openai/helpers/zod";
import type { z } from "zod";
import { getModel, getOpenAI } from "@/lib/ai/openai";

export type ChatTurn = { role: "user" | "assistant"; content: string };

type JsonRequest<T> = {
  schema: z.ZodType<T>;
  schemaName: string;
  system: string;
  prompt: string;
  temperature: number;
};

type TextRequest = {
  system: string;
  messages: ChatTurn[];
  temperature: number;
};

export type Architect = {
  provider: "gemini" | "openai";
  completeJson<T>(request: JsonRequest<T>): Promise<T>;
  streamText(request: TextRequest): Promise<AsyncGenerator<string>>;
};

export function loadArchitect(): { architect: Architect } | { error: string } {
  const geminiKey = process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim() || "";
  const choice = requestedProvider();

  if (choice === "openai") {
    if (!getOpenAI()) {
      return {
        error: "OpenAI is not configured. Add OPENAI_API_KEY to .env.local and restart the server.",
      };
    }
    return { architect: openAIArchitect() };
  }

  if (choice === "gemini") {
    if (!geminiKey) {
      return {
        error: "Gemini is not configured. Add GEMINI_API_KEY to .env.local and restart the server.",
      };
    }
    return { architect: geminiArchitect(geminiKey) };
  }

  if (geminiKey) return { architect: geminiArchitect(geminiKey) };
  if (getOpenAI()) return { architect: openAIArchitect() };
  return {
    error:
      "AI is not configured. Add GEMINI_API_KEY or OPENAI_API_KEY to .env.local and restart the server.",
  };
}

export function textStreamResponse(chunks: AsyncIterable<string>) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const text of chunks) {
          if (text) controller.enqueue(encoder.encode(text));
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}

function requestedProvider(): "gemini" | "openai" | null {
  const value = process.env.AI_PROVIDER?.trim().toLowerCase();
  if (value === "gemini" || value === "google") return "gemini";
  if (value === "openai") return "openai";
  return null;
}

function geminiModel() {
  return process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";
}

function geminiArchitect(apiKey: string): Architect {
  const client = new GoogleGenAI({ apiKey });
  return {
    provider: "gemini",
    async completeJson(request) {
      const response = await client.models.generateContent({
        model: geminiModel(),
        contents: request.prompt,
        config: {
          systemInstruction: request.system,
          temperature: request.temperature,
          maxOutputTokens: 4096,
          responseMimeType: "application/json",
          responseJsonSchema: geminiJsonSchema(request.schema),
        },
      });
      return parseModelJson(request.schema, response.text);
    },
    async streamText(request) {
      const response = await client.models.generateContentStream({
        model: geminiModel(),
        contents: toGeminiContents(request.messages),
        config: {
          systemInstruction: request.system,
          temperature: request.temperature,
          maxOutputTokens: 2048,
        },
      });
      return (async function* () {
        for await (const chunk of response) {
          const text = chunk.text;
          if (text) yield text;
        }
      })();
    },
  };
}

function openAIArchitect(): Architect {
  const client = getOpenAI();
  if (!client) throw new Error("OpenAI is not configured.");
  return {
    provider: "openai",
    async completeJson(request) {
      const completion = await client.chat.completions.parse({
        model: getModel(),
        temperature: request.temperature,
        messages: [
          { role: "system", content: request.system },
          { role: "user", content: request.prompt },
        ],
        response_format: zodResponseFormat(request.schema, request.schemaName),
      });
      const parsed = completion.choices[0]?.message.parsed;
      if (!parsed) throw new Error("The architect returned an empty response.");
      return request.schema.parse(parsed);
    },
    async streamText(request) {
      const completion = await client.chat.completions.create({
        model: getModel(),
        temperature: request.temperature,
        stream: true,
        messages: [
          { role: "system", content: request.system },
          ...request.messages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
        ],
      });
      return (async function* () {
        for await (const part of completion) {
          const text = part.choices[0]?.delta?.content ?? "";
          if (text) yield text;
        }
      })();
    },
  };
}

function toGeminiContents(messages: ChatTurn[]): Content[] {
  const contents: Content[] = [];
  for (const message of messages) {
    const role = message.role === "assistant" ? "model" : "user";
    const previous = contents.at(-1);
    const previousText = previous?.parts?.[0];
    if (previous && previous.role === role && previousText && "text" in previousText && previousText.text) {
      previousText.text = `${previousText.text}\n\n${message.content}`;
      continue;
    }
    contents.push({ role, parts: [{ text: message.content }] });
  }
  if (contents[0]?.role === "model") {
    contents.unshift({ role: "user", parts: [{ text: "Continue the design review." }] });
  }
  return contents;
}

function geminiJsonSchema(schema: z.ZodType) {
  return sanitizeJsonSchema(schema.toJSONSchema());
}

function sanitizeJsonSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeJsonSchema);
  if (!value || typeof value !== "object") return value;
  const record = { ...(value as Record<string, unknown>) };
  delete record.$schema;
  if (Array.isArray(record.type) && record.type.includes("null")) {
    const rest = record.type.filter((item) => item !== "null");
    const withoutType = { ...record };
    delete withoutType.type;
    const concrete =
      rest.length === 1
        ? sanitizeJsonSchema({ ...withoutType, type: rest[0] })
        : sanitizeJsonSchema({ ...withoutType, type: rest });
    return { anyOf: [concrete, { type: "null" }] };
  }
  for (const key of Object.keys(record)) record[key] = sanitizeJsonSchema(record[key]);
  return record;
}

function parseModelJson<T>(schema: z.ZodType<T>, text: string | undefined): T {
  const raw = text?.trim() ?? "";
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return schema.parse(JSON.parse(cleaned));
  } catch {
    throw new Error("The architect returned a response that did not match the expected structure.");
  }
}
