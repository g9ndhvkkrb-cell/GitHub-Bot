# Discord + Deepgram voice transcription

This service listens only after `/transcribe` is used. It posts a notice in the
command channel, streams voice audio to Deepgram, and posts final transcripts
with the Discord speaker's display name. `/stop` ends the session and leaves
the voice channel.

## Required secrets

The project must have these Replit Secrets:

- `DISCORD_BOT_TOKEN` — the bot token from the Discord Developer Portal
- `DEEPGRAM_API_KEY` — an API key from Deepgram

The Replit Discord account connection is not a bot token and is not used by
this service.

## Add the bot to a server

1. Create a Discord application and bot in the Discord Developer Portal, then
   save its bot token as `DISCORD_BOT_TOKEN`.
2. Start the `Discord transcription bot` workflow. Its logs include an OAuth
   invite link for that bot.
3. Open the invite link and add the bot to the target server. The link requests
   `View Channel`, `Send Messages`, and `Connect`, plus the
   `applications.commands` scope.
4. In a text channel, use `/transcribe` while you are in a voice channel. Use
   `/stop` to finish.

The bot does not need the privileged Message Content intent. It registers
application slash commands when it starts; Discord may take a short time to
show newly registered global commands.

## Audio and privacy

The bot does not save audio or transcripts to local files. Voice audio is sent
over a secure connection to Deepgram for transcription, and transcripts are
posted in the Discord channel where `/transcribe` was used. Deepgram usage may
be billed to the account that owns the API key. Everyone in the voice channel
should be told before transcription begins.
