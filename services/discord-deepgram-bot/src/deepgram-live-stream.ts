import WebSocket from "ws";

interface DeepgramResult {
  type?: string;
  is_final?: boolean;
  channel?: {
    alternatives?: Array<{
      transcript?: string;
    }>;
  };
}

type TranscriptHandler = (transcript: string) => void;
type ErrorHandler = (error: Error) => void;

const MAX_BUFFERED_AUDIO_BYTES = 2 * 1024 * 1024;

export class DeepgramLiveStream {
  private readonly socket: WebSocket;
  private readonly pendingAudio: Buffer[] = [];
  private pendingAudioBytes = 0;
  private keepAliveTimer: NodeJS.Timeout | undefined;
  private closeTimer: NodeJS.Timeout | undefined;
  private closed = false;
  private lastAudioAt = Date.now();

  constructor(
    apiKey: string,
    private readonly onTranscript: TranscriptHandler,
    private readonly onError: ErrorHandler,
  ) {
    const query = new URLSearchParams({
      model: "nova-3",
      language: "en",
      encoding: "linear16",
      sample_rate: "48000",
      channels: "2",
      interim_results: "false",
      smart_format: "true",
      mip_opt_out: "true",
    });

    this.socket = new WebSocket(
      `wss://api.deepgram.com/v1/listen?${query.toString()}`,
      {
        headers: {
          Authorization: `Token ${apiKey}`,
        },
        handshakeTimeout: 10_000,
      },
    );

    this.socket.on("open", () => {
      this.flushPendingAudio();
      this.keepAliveTimer = setInterval(() => {
        if (
          this.socket.readyState === WebSocket.OPEN &&
          Date.now() - this.lastAudioAt > 5_000
        ) {
          this.socket.send(JSON.stringify({ type: "KeepAlive" }));
        }
      }, 8_000);
      this.keepAliveTimer.unref();
    });

    this.socket.on("message", (raw) => {
      try {
        const message = JSON.parse(raw.toString()) as DeepgramResult;
        if (message.type !== "Results" || !message.is_final) return;

        const transcript = message.channel?.alternatives?.[0]?.transcript?.trim();
        if (transcript) this.onTranscript(transcript);
      } catch (error) {
        this.onError(
          error instanceof Error
            ? error
            : new Error("Could not read a Deepgram response."),
        );
      }
    });

    this.socket.on("error", (error) => {
      this.onError(error);
    });

    this.socket.on("close", () => {
      this.closed = true;
      this.clearTimers();
    });
  }

  sendAudio(audio: Buffer): void {
    if (this.closed) return;
    this.lastAudioAt = Date.now();

    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(audio);
      return;
    }

    if (this.pendingAudioBytes + audio.length > MAX_BUFFERED_AUDIO_BYTES) {
      this.onError(new Error("Deepgram connection is slow; audio buffer is full."));
      return;
    }

    this.pendingAudio.push(audio);
    this.pendingAudioBytes += audio.length;
  }

  finalizeUtterance(): void {
    if (this.socket.readyState === WebSocket.OPEN && !this.closed) {
      this.socket.send(JSON.stringify({ type: "Finalize" }));
    }
  }

  close(): void {
    if (this.closed) return;
    this.clearTimers();

    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: "CloseStream" }));
      this.closeTimer = setTimeout(() => this.socket.terminate(), 3_000);
      this.closeTimer.unref();
      return;
    }

    if (this.socket.readyState === WebSocket.CONNECTING) {
      this.socket.terminate();
    }
  }

  private flushPendingAudio(): void {
    while (
      this.pendingAudio.length > 0 &&
      this.socket.readyState === WebSocket.OPEN
    ) {
      const audio = this.pendingAudio.shift();
      if (!audio) continue;
      this.pendingAudioBytes -= audio.length;
      this.socket.send(audio);
    }
  }

  private clearTimers(): void {
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
    if (this.closeTimer) clearTimeout(this.closeTimer);
    this.keepAliveTimer = undefined;
    this.closeTimer = undefined;
  }
}
