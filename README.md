# 🎙️ Google Meet AI Notetaker

An AI-powered Google Meet assistant. Give it a meeting link, let the bot join, capture the transcript, and generate an AI summary.

## ✨ Features

- **🤖 Automatic Join** — The bot joins a Google Meet call from a meeting link
- **📝 Live Transcript** — Real-time transcripts from Google Meet captions or Whisper
- **✨ AI Summary** — Meeting summary, key points, action items, and decisions with OpenAI GPT
- **🖥️ Mission Control UI** — Real-time WebSocket dashboard
- **⌨️ CLI Mode** — Manage meetings from the terminal without the web UI
- **🔌 Strategy Pattern** — Easily switch between caption scraping and Whisper transcription

## 🏗️ Architecture

```text
src/
├── config.ts                    # Application configuration
├── types.ts                     # Type definitions
├── index.ts                     # Web entry point
├── cli.ts                       # CLI entry point
├── server.ts                    # Express + Socket.IO server
├── bot/
│   ├── browser.ts               # Chrome lifecycle (SRP)
│   ├── page-actions.ts          # Puppeteer helpers (DRY)
│   ├── meet-navigator.ts        # Google Meet navigation (SRP)
│   └── meet-bot.ts              # Orchestrator
├── transcription/
│   ├── base-transcriber.ts      # Abstract interface (Strategy Pattern)
│   ├── caption-transcriber.ts   # Google Meet caption scraping
│   ├── whisper-transcriber.ts   # Whisper transcription from recorded audio
│   └── transcriber-factory.ts   # Factory
├── ai/
│   └── summarizer.ts            # OpenAI summary generation
└── session/
    └── meeting-session.ts       # Session state management
```

**Principles:**
- **SRP** — Each file has a single responsibility
- **DRY** — Shared patterns live in `page-actions.ts`; shared interfaces live in `base-transcriber.ts`
- **Strategy Pattern** — The transcription strategy is selected from `.env`
- **Factory Pattern** — `transcriber-factory.ts` creates the right implementation

## 🚀 Setup

```bash
# 1. Install dependencies
pnpm install
pnpm exec patchright install chromium

# 2. Create your .env file
cp .env.example .env
# Edit .env and add OPENAI_API_KEY

# 3A. Start with the web UI
pnpm dev

# 3B. Start with the CLI
pnpm cli --help
```

## ⚙️ Configuration

| Variable | Required | Description |
|---|---|---|
| `OPENAI_API_KEY` | ✅ | OpenAI API key for summaries and Whisper transcription |
| `TRANSCRIPTION_STRATEGY` | ❌ | `captions` (default) or `whisper` |
| `WHISPER_API_KEY` | 🔶 | Required only when using the `whisper` strategy if it differs from `OPENAI_API_KEY` |
| `WHISPER_BASE_URL` | ❌ | Optional OpenAI-compatible Whisper API base URL |
| `WHISPER_MODEL` | ❌ | Whisper model name |
| `BOT_NAME` | ❌ | Bot display name (default: `AI Notetaker`) |
| `CAPTION_LANGUAGE` | ❌ | Google Meet caption language (default: `English`) |
| `PORT` | ❌ | Server port (default: `3000`) |

## 📋 Usage

### Web UI

1. Start the server with `pnpm dev`
2. Open `http://localhost:3000`
3. Paste a Google Meet link
4. Click **Join Meeting**
5. The bot joins the meeting; the host admits it if required
6. Watch the live transcript stream in
7. After the meeting, click **AI Summary** to generate a summary

### CLI

```bash
# Start directly with a link
pnpm cli https://meet.google.com/xxx-xxxx-xxx

# Start with options
pnpm cli --meet https://meet.google.com/xxx-xxxx-xxx --name "AI Notetaker" --lang English --strategy captions

# Save outputs to a directory
pnpm cli https://meet.google.com/xxx-xxxx-xxx --save-dir ./outputs
```

Available commands while the CLI is running:
- `help`
- `status`
- `summary`
- `languages`
- `language <name>`
- `leave` / `exit` / `quit`

## 🎯 Transcription Strategies

### Caption Scraping (Default)
- Free; no extra API key required
- Uses Google Meet's built-in captions
- Automatically enables captions in the meeting

### Whisper
- Higher-quality transcript from recorded meeting audio
- Uses OpenAI-compatible Whisper APIs
- Can be configured with OpenAI or providers such as Groq

## ⚠️ Important Notes

- The bot uses **non-headless** Chrome because Google Meet requires it
- The meeting host may need to **admit** the bot
- Google Meet's DOM can change, so selectors may need updates
- For production use, a Google Workspace API integration is recommended
