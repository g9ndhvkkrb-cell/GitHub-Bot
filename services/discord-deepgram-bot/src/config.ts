function requireSecret(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required secret: ${name}`);
  }
  return value;
}

export const config = {
  discordBotToken: requireSecret("DISCORD_BOT_TOKEN"),
  deepgramApiKey: requireSecret("DEEPGRAM_API_KEY"),
};
