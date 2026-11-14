// Turns microphone audio into 16-bit, 16kHz, little-endian mono PCM, which is what Gemini Live takes as input.
// The browser captures at its own rate (often 44.1 or 48kHz), so this resamples with linear interpolation.
// It posts roughly 100ms of audio at a time to keep latency low without flooding the socket.

const TARGET_RATE = 16000;
const CHUNK_SAMPLES = 1600;

class VoiceCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / TARGET_RATE;
    this.position = 0;
    this.carry = 0;
    this.pending = new Int16Array(CHUNK_SAMPLES);
    this.filled = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;

    // Source index -1 is the last sample of the previous block. The span between this block's final sample and the
    // next block's first is interpolated next time, through that carried sample.
    while (this.position < channel.length - 1) {
      const whole = Math.floor(this.position);
      const frac = this.position - whole;
      const a = whole < 0 ? this.carry : channel[whole];
      const b = channel[whole + 1];
      const value = a + (b - a) * frac;
      const clamped = Math.max(-1, Math.min(1, value));
      this.pending[this.filled++] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
      if (this.filled === CHUNK_SAMPLES) {
        const out = this.pending.slice(0);
        this.port.postMessage(out.buffer, [out.buffer]);
        this.filled = 0;
      }
      this.position += this.ratio;
    }

    this.position -= channel.length;
    this.carry = channel[channel.length - 1];
    return true;
  }
}

registerProcessor("voice-capture", VoiceCaptureProcessor);
