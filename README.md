# deepreach

AI-powered cold outreach for job seekers. Find companies, discover contacts, and generate personalized emails — all from the command line.

Built on [LangGraph](https://github.com/langchain-ai/langgraphjs) with Claude, Apollo.io, and Tavily.

## Getting Started

### 1. Get your API keys

| Key | What it does | Get it here |
|-----|-------------|-------------|
| `ANTHROPIC_API_KEY` | Powers the AI (Claude) | [console.anthropic.com](https://console.anthropic.com/settings/keys) |
| `APOLLO_API_KEY` | Finds contacts and work emails at companies | [docs.apollo.io](https://docs.apollo.io/reference/introduction) |
| `TAVILY_API_KEY` | Web search for company/contact research | [app.tavily.com](https://app.tavily.com/home) |

### 2. Initialize and run

```bash
npx deepreach               # one-time setup (profile, resume, API keys)
npx deepreach run            # find companies, contacts, and draft emails
npx deepreach run run0001    # resume an interrupted run (processes non-SUCCESS companies only)
npx deepreach send run0001   # review and send the drafts
```

The setup wizard walks you through your profile, target roles/industries, resume, and API keys. Everything is saved to a `.deepreach/` directory in your workspace.

## Commands

| Command | Description |
|---------|-------------|
| `deepreach` | Interactive setup wizard (same as `deepreach init`) |
| `deepreach run [run-id]` | Start a new run, or resume an existing run by ID |
| `deepreach send <run-id>` | Send emails from a previous run |
| `deepreach edit <target>` | Edit config (`profile`, `preferences`, `resume`, `env`) |

Run any command with `--help` for all available options.

## Rate Limit Tuning

If you hit Anthropic 429 errors (input tokens/minute), lower fan-out with these optional env vars in `.env`:

| Variable | Default | What it controls |
|---------|---------|------------------|
| `DEEPREACH_MODEL_MAX_CONCURRENCY` | `2` | Max concurrent Claude calls from the LangChain model client |
| `DEEPREACH_MODEL_MAX_RETRIES` | `10` | Retry attempts for transient model errors (including rate limits) |
| `DEEPREACH_RATE_LIMIT_BACKOFF_MS` | `15000` | Base cooldown (ms) before retrying after a 429/rate-limit error |
| `DEEPREACH_RATE_LIMIT_BACKOFF_JITTER_MS` | `5000` | Extra random cooldown (ms) added to spread retries |
| `DEEPREACH_COMPANY_CONCURRENCY` | `2` | Max companies processed in parallel by the orchestrator |
| `DEEPREACH_CONTACT_CONCURRENCY` | `2` | Max contacts personalized in parallel per company |

## How It Works

1. **Finds companies** matching your preferences via web search
2. **Shows you the list** for approval (you can reject and give feedback)
3. **Processes each company** in parallel — researches the company, finds contacts via Apollo.io, and drafts personalized emails using your resume and their background
4. **Saves drafts** to `runs/<run-id>/drafts.json` for review before sending

Previously contacted companies are tracked in `storage/contacted.json` and automatically skipped.

## Gmail Setup (for sending)

Only needed if you want to send emails with `deepreach send`.

1. Enable **2-Step Verification** on your Google Account
2. Generate an App Password at [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
3. Add `GMAIL_USER` and `GMAIL_APP_PASSWORD` via `npx deepreach edit env`

## Workspace Structure

```
my-outreach/
├── .deepreach/              # config (created by init)
│   ├── profile.json
│   ├── preferences.json
│   └── resume/
│       ├── resume.pdf       # attached to emails
│       └── resume.md        # AI reads this for personalization
├── .env                     # API keys (gitignored)
├── runs/                    # one folder per run
│   └── run0001/
│       ├── config.json
│       ├── companies.json
│       ├── contacts/
│       └── drafts.json
└── storage/                 # persistent across runs
    ├── contacted.json
    └── suppression_list.json
```

## Requirements

- Node.js >= 18
- API keys: Anthropic, Apollo.io, Tavily
- Gmail App Password (only for sending)

## License

MIT
