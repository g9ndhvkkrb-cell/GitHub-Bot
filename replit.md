# Discord Deepgram Transcription Bot

A Discord voice bot that joins a channel on command, streams speech to Deepgram for live transcription, and posts attributed transcripts back to Discord.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/discord-deepgram-bot run dev` — run the Discord transcription bot
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required secrets: `DISCORD_BOT_TOKEN`, `DEEPGRAM_API_KEY`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `services/discord-deepgram-bot` — Discord gateway, voice receive, and Deepgram streaming transcription
- `artifacts/api-server` — shared API service
- `artifacts/mockup-sandbox` — canvas component preview service

## Architecture decisions

- Uses the Discord bot token rather than the Replit Discord user OAuth connection; the bot must join voice channels as a bot account.
- Streams decoded voice audio directly to Deepgram over a secure WebSocket; audio is not written to local files.
- Transcription starts only after `/transcribe` and stops on `/stop`, with a visible notice posted to Discord.

## Product

- `/transcribe` joins the invoking user's voice channel and posts speaker-attributed Deepgram transcripts.
- `/stop` ends the voice session and closes active Deepgram streams.
- `/help` lists the bot commands.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
