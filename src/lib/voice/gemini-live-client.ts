"use client";

import {
  LIVE_MIN_FRAME_INTERVAL_MS,
  sampleRateOf,
  type ClientMessage,
  type RelayMessage,
} from "@/lib/voice/protocol";

// Browser side of Gemini Live. It talks to the voice relay (which holds the API key and the Live session),
// streams microphone audio in, plays model audio out, and runs the tools the model asks for.
// Message shapes follow https://aistudio.google.com/docs/live-api/get-started-sdk

export type VoiceState = "idle" | "listening" | "speaking";
export type ConnectionState = "off" | "connecting" | "live" | "error";

export type ToolCall = { id?: string; name: string; args: Record<string, unknown> };
export type ToolRunner = (call: ToolCall) => Promise<Record<string, unknown>>;

export type LiveClientEvents = {
  onConnection: (state: ConnectionState, detail?: string) => void;
  onVoiceState: (state: VoiceState) => void;
  // A finished spoken turn, ready to be saved to the conversation.
  onTranscript: (role: "user" | "assistant", text: string) => void;
  onToolCall: ToolRunner;
};

export type LiveSessionTicket = {
  ticket: string;
  relayUrl: string | null;
  relayPort: number;
};

// Used only when the model does not state a rate on an audio chunk. The Live API reports it as `rate=` in the mime type.
const FALLBACK_OUTPUT_RATE = 24000;

type ServerMessage = {
  setupComplete?: unknown;
  toolCall?: { functionCalls?: { id?: string; name?: string; args?: Record<string, unknown> }[] };
  serverContent?: {
    modelTurn?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] };
    interrupted?: boolean;
    turnComplete?: boolean;
    inputTranscription?: { text?: string };
    outputTranscription?: { text?: string };
  };
};

export class GeminiLiveClient {
  private socket: WebSocket | null = null;
  private micContext: AudioContext | null = null;
  private micStream: MediaStream | null = null;
  private micNode: AudioWorkletNode | null = null;
  private playContext: AudioContext | null = null;
  private playhead = 0;
  private playing = new Set<AudioBufferSourceNode>();
  private userText = "";
  private assistantText = "";
  private lastFrameAt = 0;
  private ready = false;
  private stopped = false;
  private speakingTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly events: LiveClientEvents) {}

  get isReady() {
    return this.ready;
  }

  async start(ticket: LiveSessionTicket, instructions: string) {
    this.stopped = false;
    this.events.onConnection("connecting");
    // Both contexts are created inside the user's click so the browser allows audio.
    this.playContext = new AudioContext();
    await this.playContext.resume();
    this.micStream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    await this.openSocket(ticket, instructions);
    await this.startMicrophone();
  }

  private openSocket(ticket: LiveSessionTicket, instructions: string) {
    return new Promise<void>((resolve, reject) => {
      const url = `${relayBase(ticket)}/?ticket=${encodeURIComponent(ticket.ticket)}`;
      const socket = new WebSocket(url);
      this.socket = socket;
      let settled = false;
      const fail = (message: string) => {
        if (settled) return;
        settled = true;
        reject(new Error(message));
      };
      socket.onopen = () => this.send({ type: "start", instructions });
      socket.onerror = () => fail("Could not reach the voice relay. Start it with `npm run voice:relay`.");
      socket.onclose = (event) => {
        fail(event.reason || "The voice relay closed the connection.");
        if (!this.stopped) this.finish(event.reason || undefined);
      };
      socket.onmessage = (event) => {
        let relay: RelayMessage;
        try {
          relay = JSON.parse(String(event.data)) as RelayMessage;
        } catch {
          return;
        }
        if (relay.type === "ready") {
          this.ready = true;
          this.events.onConnection("live");
          this.events.onVoiceState("listening");
          if (!settled) {
            settled = true;
            resolve();
          }
        } else if (relay.type === "message") {
          void this.handle(relay.message as ServerMessage);
        } else if (relay.type === "error") {
          fail(relay.message);
          this.events.onConnection("error", relay.message);
        } else if (relay.type === "closed") {
          fail(relay.reason);
        }
      };
    });
  }

  private async startMicrophone() {
    if (!this.micStream) return;
    this.micContext = new AudioContext();
    await this.micContext.audioWorklet.addModule("/voice-capture-worklet.js");
    const source = this.micContext.createMediaStreamSource(this.micStream);
    const node = new AudioWorkletNode(this.micContext, "voice-capture");
    node.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      if (!this.ready) return;
      this.send({ type: "audio", data: toBase64(new Uint8Array(event.data)) });
    };
    source.connect(node);
    this.micNode = node;
  }

  // The docs cap video at one frame per second. Frames sent faster than that are dropped.
  sendFrame(jpegBase64: string) {
    if (!this.ready) return false;
    const now = Date.now();
    if (now - this.lastFrameAt < LIVE_MIN_FRAME_INTERVAL_MS) return false;
    this.lastFrameAt = now;
    this.send({ type: "video", data: jpegBase64 });
    return true;
  }

  sendText(text: string) {
    if (this.ready) this.send({ type: "text", text });
  }

  stop() {
    this.stopped = true;
    this.finish();
  }

  private finish(reason?: string) {
    const wasLive = this.ready;
    this.ready = false;
    this.flushTranscripts();
    this.clearPlayback();
    if (this.speakingTimer) clearTimeout(this.speakingTimer);
    this.micNode?.port.close();
    this.micNode?.disconnect();
    this.micNode = null;
    this.micStream?.getTracks().forEach((track) => track.stop());
    this.micStream = null;
    void this.micContext?.close();
    this.micContext = null;
    void this.playContext?.close();
    this.playContext = null;
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState <= WebSocket.OPEN) socket.close(1000);
    this.events.onVoiceState("idle");
    this.events.onConnection(reason && wasLive ? "error" : "off", reason);
  }

  private send(message: ClientMessage) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  private async handle(message: ServerMessage) {
    const content = message.serverContent;

    if (content?.interrupted) {
      // Barge-in: the person spoke over the model, so drop whatever audio is still queued.
      this.clearPlayback();
      this.events.onVoiceState("listening");
    }

    for (const part of content?.modelTurn?.parts ?? []) {
      const inline = part.inlineData;
      if (inline?.data) this.play(inline.data, inline.mimeType);
    }

    if (content?.inputTranscription?.text) {
      // A new user turn means the previous assistant answer is complete.
      if (this.assistantText) this.flush("assistant");
      this.userText += content.inputTranscription.text;
    }
    if (content?.outputTranscription?.text) {
      if (this.userText) this.flush("user");
      this.assistantText += content.outputTranscription.text;
    }
    if (content?.turnComplete) this.flushTranscripts();

    const calls = message.toolCall?.functionCalls;
    if (calls?.length) {
      const responses = await Promise.all(
        calls.map(async (call) => {
          const name = call.name ?? "";
          try {
            const result = await this.events.onToolCall({ id: call.id, name, args: call.args ?? {} });
            return { id: call.id, name, response: { result } };
          } catch (error) {
            return {
              id: call.id,
              name,
              response: { error: error instanceof Error ? error.message : "That tool failed." },
            };
          }
        }),
      );
      this.send({ type: "toolResponse", responses });
    }
  }

  private play(base64: string, mimeType: string | undefined) {
    const context = this.playContext;
    if (!context) return;
    const bytes = fromBase64(base64);
    const samples = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
    if (samples.length === 0) return;
    const rate = sampleRateOf(mimeType) ?? FALLBACK_OUTPUT_RATE;
    const buffer = context.createBuffer(1, samples.length, rate);
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < samples.length; index += 1) channel[index] = samples[index] / 0x8000;

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    const startAt = Math.max(context.currentTime + 0.02, this.playhead);
    source.start(startAt);
    this.playhead = startAt + buffer.duration;
    this.playing.add(source);
    this.events.onVoiceState("speaking");
    source.onended = () => {
      this.playing.delete(source);
      if (this.playing.size === 0 && this.ready) {
        if (this.speakingTimer) clearTimeout(this.speakingTimer);
        // Short grace period so a gap between chunks does not flicker the indicator.
        this.speakingTimer = setTimeout(() => {
          if (this.playing.size === 0 && this.ready) this.events.onVoiceState("listening");
        }, 250);
      }
    };
  }

  private clearPlayback() {
    for (const source of this.playing) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // Already finished.
      }
    }
    this.playing.clear();
    this.playhead = 0;
  }

  private flush(role: "user" | "assistant") {
    const text = (role === "user" ? this.userText : this.assistantText).trim();
    if (role === "user") this.userText = "";
    else this.assistantText = "";
    if (text) this.events.onTranscript(role, text);
  }

  private flushTranscripts() {
    this.flush("user");
    this.flush("assistant");
  }
}

function relayBase(ticket: LiveSessionTicket) {
  if (ticket.relayUrl) return ticket.relayUrl.replace(/\/$/, "");
  const secure = window.location.protocol === "https:";
  return `${secure ? "wss" : "ws"}://${window.location.hostname}:${ticket.relayPort}`;
}

function toBase64(bytes: Uint8Array) {
  let binary = "";
  const step = 0x8000;
  for (let index = 0; index < bytes.length; index += step) {
    binary += String.fromCharCode(...bytes.subarray(index, index + step));
  }
  return btoa(binary);
}

function fromBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
