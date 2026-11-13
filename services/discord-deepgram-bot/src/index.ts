import {
  Client,
  Events,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type GuildTextBasedChannel,
} from "discord.js";

import { config } from "./config.js";
import { VoiceTranscriptionSession } from "./voice-transcription-session.js";

const commands = [
  new SlashCommandBuilder()
    .setName("transcribe")
    .setDescription("Join your voice channel and transcribe speech."),
  new SlashCommandBuilder()
    .setName("stop")
    .setDescription("Stop transcription and leave the voice channel."),
  new SlashCommandBuilder()
    .setName("help")
    .setDescription("Show the transcription bot commands."),
];

const client = new Client({
  intents: ["Guilds", "GuildVoiceStates"],
});
const sessions = new Map<string, VoiceTranscriptionSession>();
const startingGuilds = new Set<string>();
const rest = new REST({ version: "10" }).setToken(config.discordBotToken);

client.once(Events.ClientReady, async (readyClient) => {
  console.info(`Connected to Discord as ${readyClient.user.tag}.`);

  try {
    await rest.put(Routes.applicationCommands(readyClient.user.id), {
      body: commands.map((command) => command.toJSON()),
    });
    console.info("Registered /transcribe, /stop, and /help.");
  } catch (error) {
    console.error("Could not register Discord slash commands:", error);
  }

  const permissions =
    PermissionFlagsBits.ViewChannel |
    PermissionFlagsBits.SendMessages |
    PermissionFlagsBits.Connect;
  const invite = new URL("https://discord.com/oauth2/authorize");
  invite.searchParams.set("client_id", readyClient.user.id);
  invite.searchParams.set("scope", "bot applications.commands");
  invite.searchParams.set("permissions", permissions.toString());
  console.info(`Invite the bot to a server: ${invite.toString()}`);
});

client.on(Events.InteractionCreate, (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  void handleCommand(interaction);
});

async function handleCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({
      content: "Use this command in a Discord server.",
      ephemeral: true,
    });
    return;
  }

  if (interaction.commandName === "help") {
    await interaction.reply({
      content:
        "**Discord transcription commands**\n" +
        "`/transcribe` — join your current voice channel and start live transcription.\n" +
        "`/stop` — stop transcription and leave the voice channel.\n\n" +
        "When transcription starts, the bot posts a notice in this channel. Make sure everyone in voice knows their audio is being sent to Deepgram.",
      ephemeral: true,
    });
    return;
  }

  if (interaction.commandName === "transcribe") {
    await startTranscription(interaction);
    return;
  }

  if (interaction.commandName === "stop") {
    await stopTranscription(interaction);
  }
}

async function startTranscription(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const guild = interaction.guild;
  const guildId = interaction.guildId;
  if (!guild || !guildId) {
    await interaction.reply({
      content: "Use this command in a Discord server.",
      ephemeral: true,
    });
    return;
  }

  const existing = sessions.get(guildId);
  if (existing || startingGuilds.has(guildId)) {
    await interaction.reply({
      content: "Transcription is already active in this server. Use `/stop` first.",
      ephemeral: true,
    });
    return;
  }

  const channel = getTranscriptChannel(interaction);
  if (!channel) {
    await interaction.reply({
      content: "Run this command in a text channel where I can post transcripts.",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  startingGuilds.add(guildId);

  let session: VoiceTranscriptionSession | undefined;
  try {
    const member = await guild.members.fetch(interaction.user.id);
    const voiceChannel = member.voice.channel;
    if (!voiceChannel) {
      await interaction.editReply(
        "Join a voice channel first, then run `/transcribe`.",
      );
      return;
    }

    session = await VoiceTranscriptionSession.join({
      guild,
      voiceChannelId: voiceChannel.id,
      transcriptChannel: channel,
      deepgramApiKey: config.deepgramApiKey,
      botUserId: interaction.client.user!.id,
    });

    await channel.send(
      `Live transcription is starting for **${voiceChannel.name}**. ` +
        "Voice audio will be streamed to Deepgram and final transcripts will appear here. " +
        "Make sure everyone in voice is aware before speaking.",
    );
    session.startListening();
    sessions.set(guildId, session);
    await interaction.editReply(
      `Joined **${voiceChannel.name}**. Transcription is on; use \`/stop\` when finished.`,
    );
  } catch (error) {
    if (session) {
      await session.stop();
    }
    const message =
      error instanceof Error ? error.message : "unknown connection error";
    console.error(`Could not start transcription: ${message}`);
    await interaction.editReply(
      "I couldn’t join that voice channel. Check that I have permission to view and connect to it, then try again.",
    );
  } finally {
    startingGuilds.delete(guildId);
  }
}

async function stopTranscription(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({
      content: "Use this command in a Discord server.",
      ephemeral: true,
    });
    return;
  }

  const session = sessions.get(guildId);
  if (!session) {
    await interaction.reply({
      content: "Transcription is not active in this server.",
      ephemeral: true,
    });
    return;
  }

  sessions.delete(guildId);
  await session.stop();
  await session.announceStopped();
  await interaction.reply({
    content: "Transcription stopped; I left the voice channel.",
    ephemeral: true,
  });
}

function getTranscriptChannel(
  interaction: ChatInputCommandInteraction,
): GuildTextBasedChannel | null {
  const channel = interaction.channel;
  if (!channel?.isTextBased() || !("send" in channel)) return null;
  return channel as GuildTextBasedChannel;
}

client.on(Events.Error, (error) => {
  console.error("Discord client error:", error);
});

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

async function shutdown(): Promise<void> {
  console.info("Stopping transcription sessions.");
  const active = [...sessions.values()];
  sessions.clear();
  await Promise.all(active.map((session) => session.stop()));
  client.destroy();
  process.exit(0);
}

client.login(config.discordBotToken).catch((error: unknown) => {
  console.error(
    "Could not log in to Discord:",
    error instanceof Error ? error.message : "unknown error",
  );
  process.exitCode = 1;
});
