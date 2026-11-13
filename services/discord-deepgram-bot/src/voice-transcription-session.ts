import {
  EndBehaviorType,
  entersState,
  joinVoiceChannel,
  VoiceConnectionStatus,
  type AudioReceiveStream,
  type VoiceConnection,
} from "@discordjs/voice";
import {
  type Guild,
  type GuildTextBasedChannel,
} from "discord.js";
import type { Transform } from "node:stream";
import prism from "prism-media";

import { DeepgramLiveStream } from "./deepgram-live-stream.js";

interface ActiveSpeakerStream {
  audio: AudioReceiveStream;
  decoder: Transform;
}

export class VoiceTranscriptionSession {
  private readonly connection: VoiceConnection;
  private readonly activeStreams = new Map<string, ActiveSpeakerStream>();
  private readonly deepgramStreams = new Map<string, DeepgramLiveStream>();
  private readonly onSpeakingStart = (userId: string) => {
    void this.startSpeakerStream(userId);
  };
  private stopped = false;

  private constructor(
    private readonly guild: Guild,
    private readonly transcriptChannel: GuildTextBasedChannel,
    private readonly deepgramApiKey: string,
    private readonly botUserId: string,
    voiceChannelId: string,
  ) {
    this.connection = joinVoiceChannel({
      channelId: voiceChannelId,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: true,
    });
  }

  static async join({
    guild,
    voiceChannelId,
    transcriptChannel,
    deepgramApiKey,
    botUserId,
  }: {
    guild: Guild;
    voiceChannelId: string;
    transcriptChannel: GuildTextBasedChannel;
    deepgramApiKey: string;
    botUserId: string;
  }): Promise<VoiceTranscriptionSession> {
    const session = new VoiceTranscriptionSession(
      guild,
      transcriptChannel,
      deepgramApiKey,
      botUserId,
      voiceChannelId,
    );

    try {
      await entersState(session.connection, VoiceConnectionStatus.Ready, 20_000);
      return session;
    } catch (error) {
      session.connection.destroy();
      throw error;
    }
  }

  startListening(): void {
    if (this.stopped) {
      throw new Error("This transcription session has already stopped.");
    }
    this.connection.receiver.speaking.on("start", this.onSpeakingStart);
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.connection.receiver.speaking.removeListener(
      "start",
      this.onSpeakingStart,
    );

    for (const stream of this.activeStreams.values()) {
      stream.audio.destroy();
      stream.decoder.destroy();
    }
    this.activeStreams.clear();

    for (const stream of this.deepgramStreams.values()) {
      stream.close();
    }
    this.deepgramStreams.clear();
    this.connection.destroy();
  }

  private async startSpeakerStream(userId: string): Promise<void> {
    if (this.stopped || userId === this.botUserId || this.activeStreams.has(userId)) {
      return;
    }

    try {
      const audio = this.connection.receiver.subscribe(userId, {
        end: {
          behavior: EndBehaviorType.AfterSilence,
          duration: 1_100,
        },
      });
      const decoder = new prism.opus.Decoder({
        rate: 48_000,
        channels: 2,
        frameSize: 960,
      });

      const speaker = this.guild.members.cache.get(userId);
      const speakerName = speaker?.displayName ?? `Speaker ${userId.slice(-4)}`;
      const deepgram = this.getDeepgramStream(userId, speakerName);

      this.activeStreams.set(userId, { audio, decoder });

      audio.pipe(decoder);
      decoder.on("data", (pcm: Buffer) => deepgram.sendAudio(pcm));
      decoder.once("end", () => {
        deepgram.finalizeUtterance();
        this.activeStreams.delete(userId);
      });

      audio.once("error", (error) => {
        console.warn(`Discord audio stream ended unexpectedly: ${error.message}`);
        audio.destroy();
        decoder.destroy();
        this.activeStreams.delete(userId);
      });
      decoder.once("error", (error) => {
        console.warn(`Could not decode Discord voice audio: ${error.message}`);
        audio.destroy();
        decoder.destroy();
        this.activeStreams.delete(userId);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      console.warn(`Could not start a speaker audio stream: ${message}`);
    }
  }

  private getDeepgramStream(
    userId: string,
    speakerName: string,
  ): DeepgramLiveStream {
    const existing = this.deepgramStreams.get(userId);
    if (existing) return existing;

    const stream = new DeepgramLiveStream(
      this.deepgramApiKey,
      (transcript) => {
        void this.sendTranscript(speakerName, transcript);
      },
      (error) => {
        console.warn(`Deepgram stream issue for ${speakerName}: ${error.message}`);
      },
    );
    this.deepgramStreams.set(userId, stream);
    return stream;
  }

  private async sendTranscript(
    speakerName: string,
    transcript: string,
  ): Promise<void> {
    if (this.stopped) return;
    const content = `**${speakerName}:** ${transcript}`;

    try {
      if (content.length <= 1_900) {
        await this.transcriptChannel.send({ content });
        return;
      }

      for (let offset = 0; offset < content.length; offset += 1_900) {
        await this.transcriptChannel.send({
          content: content.slice(offset, offset + 1_900),
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      console.warn(`Could not post a transcript to Discord: ${message}`);
    }
  }

  async announceStopped(): Promise<void> {
    try {
      await this.transcriptChannel.send("Transcription has stopped.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      console.warn(`Could not post the stop notice to Discord: ${message}`);
    }
  }
}
