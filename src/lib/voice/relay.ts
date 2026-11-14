import http from "node:http";
import { GoogleGenAI, Modality, type Session } from "@google/genai";
import { WebSocketServer, type WebSocket } from "ws";
import { DEFAULT_LIVE_MODEL, LIVE_INPUT_AUDIO_MIME, LIVE_VIDEO_MIME, parseClientMessage, type RelayMessage } from "./protocol.ts";
import { VOICE_FUNCTION_DECLARATIONS } from "./tools.ts";
import { verifyTicket } from "./ticket.ts";

// Holds the Gemini Live session for each browser so GEMINI_API_KEY never leaves the server.
// Connection follows https://aistudio.google.com/docs/live-api/get-started-sdk (JavaScript, v1beta).

export type RelayOptions = {
  port: number;
  apiKey: string;
  secret: string;
  model?: string;
  host?: string;
  log?: (line: string) => void;
};

export function startVoiceRelay(options: RelayOptions) {
  const model = options.model?.trim() || DEFAULT_LIVE_MODEL;
  const log = options.log ?? (() => undefined);
  const ai = new GoogleGenAI({ apiKey: options.apiKey, httpOptions: { apiVersion: "v1beta" } });
  // An HTTP server answers Cloud Run's port check; WebSocket upgrades ride on the same listener.
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    response.end("ok");
  });
  const wss = new WebSocketServer({ server, maxPayload: 8 * 1024 * 1024 });
  const usedTickets = new Map<string, number>();
  server.listen(options.port, options.host);

  wss.on("connection", (socket, request) => {
    const url = new URL(request.url ?? "/", "http://relay");
    const ticket = url.searchParams.get("ticket") ?? "";
    const verified = verifyTicket(ticket, options.secret);
    pruneTickets(usedTickets);
    if (!verified || usedTickets.has(ticket)) {
      socket.close(4401, "This voice ticket is not valid. Reopen the voice control.");
      return;
    }
    usedTickets.set(ticket, verified.expiresAt);
    log(`voice session for user ${verified.userId} in project ${verified.projectId}`);

    let session: Session | null = null;
    let starting = false;
    let closed = false;

    const send = (message: RelayMessage) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
    };

    const shutdown = (reason: string) => {
      if (closed) return;
      closed = true;
      try {
        session?.close();
      } catch {
        // The upstream socket may already be gone.
      }
      send({ type: "closed", reason });
      if (socket.readyState === socket.OPEN) socket.close(1000, reason.slice(0, 120));
    };

    async function start(instructions: string) {
      starting = true;
      try {
        session = await ai.live.connect({
          model,
          config: {
            responseModalities: [Modality.AUDIO],
            systemInstruction: instructions,
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            tools: [{ functionDeclarations: VOICE_FUNCTION_DECLARATIONS }],
          },
          callbacks: {
            // The session accepts input only after the server confirms setup, so "ready" waits for it.
            onmessage: (message) => {
              if (message.setupComplete) send({ type: "ready" });
              send({ type: "message", message });
            },
            onerror: (event) => {
              log(`live error: ${event.message}`);
              send({ type: "error", message: event.message || "The Gemini Live connection failed." });
            },
            onclose: (event) => shutdown(event.reason || "Gemini Live closed the session."),
          },
        });
        if (closed) session.close();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not start Gemini Live.";
        log(`live connect failed: ${message}`);
        send({ type: "error", message });
        shutdown(message);
      } finally {
        starting = false;
      }
    }

    socket.on("message", (raw: Buffer) => {
      const message = parseClientMessage(raw.toString());
      if (!message) return;
      if (message.type === "start") {
        if (!session && !starting) void start(message.instructions);
        return;
      }
      if (!session) return;
      try {
        if (message.type === "audio") {
          session.sendRealtimeInput({ audio: { data: message.data, mimeType: LIVE_INPUT_AUDIO_MIME } });
        } else if (message.type === "audioStreamEnd") {
          session.sendRealtimeInput({ audioStreamEnd: true });
        } else if (message.type === "video") {
          session.sendRealtimeInput({ video: { data: message.data, mimeType: LIVE_VIDEO_MIME } });
        } else if (message.type === "text") {
          session.sendRealtimeInput({ text: message.text });
        } else if (message.type === "toolResponse") {
          session.sendToolResponse({ functionResponses: message.responses });
        }
      } catch (error) {
        send({ type: "error", message: error instanceof Error ? error.message : "Could not send to Gemini Live." });
      }
    });

    socket.on("close", () => {
      closed = true;
      try {
        session?.close();
      } catch {
        // Already closed upstream.
      }
    });
    socket.on("error", (error: Error) => log(`socket error: ${error.message}`));
  });

  return {
    wss,
    model,
    close: () =>
      new Promise<void>((resolve) => {
        for (const client of wss.clients as Set<WebSocket>) client.close(1001, "Relay stopping");
        wss.close(() => {
          server.close(() => resolve());
        });
      }),
  };
}

function pruneTickets(used: Map<string, number>) {
  const now = Date.now();
  for (const [ticket, expiresAt] of used) {
    if (expiresAt < now) used.delete(ticket);
  }
}
