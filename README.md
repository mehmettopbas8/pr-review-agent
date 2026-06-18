# LeadBot

A self-hosted GitHub App that automates the work of a tech lead — AI-powered PR reviews, API spec generation from requirements, and structured issue creation. Works with Anthropic Claude, OpenAI, or Google Gemini.

## What It Does

| Event | Action |
|---|---|
| PR opened / new push | Full AI review — finds bugs, security issues, TODOs, and code quality problems |
| PR opened with `requirements.md` | Generates GitHub issues + collapsed OpenAPI 3.1 spec (auto-trigger, once per PR) |
| Comment `/leadbot gen-spec` on a PR | Same spec generation, on-demand |
| Merge commit pushed to branch | Reminds you of any open Critical/High/Medium/Low issues before you merge |
| PR merged | Posts a PR retrospective + opens a `technical-debt` follow-up issue for unresolved items |

### Review Severity Levels

- **[Critical]** — crashes, broken exports, data loss
- **[High]** — security vulnerabilities, missing auth checks, business logic errors
- **[Medium]** — race conditions, missing validations, minor code quality
- **[Low]** — style issues, naming inconsistencies, non-critical suggestions
- **[TODO before merge]** — intentional stubs/WIP that must be finished before merging

### Verdict

Every review ends with one of:
- `Verdict: Changes Requested` — Critical or High issues found
- `Verdict: Approve with Suggestions` — only Medium/Low/TODO issues
- `Verdict: LGTM ✅` — nothing found

---

## Architecture

```
GitHub PR event
      │
      ▼
POST /webhook  (your server)
      │
      ├─ Verify webhook signature
      ├─ Detect event type (opened / synchronize / merged)
      │
      ├─ [opened / synchronize]
      │     ├─ Fetch PR diff (lock files and minified files excluded)
      │     ├─ Fetch linked issue via "Closes #N" in PR body
      │     ├─ Summarize open issues from previous bot reviews
      │     └─ Send to AI provider → post review comment
      │
      ├─ [synchronize — merge commit detected]
      │     └─ Post pre-merge warning with open Critical/High/Medium/Low items
      │
      └─ [closed + merged]
            ├─ Build PR stats locally (rounds, severities, resolved vs persistent)
            ├─ Send compact stats to AI provider → generate retrospective
            ├─ Open follow-up issue with unresolved TODOs + Medium/Low items
            └─ Post final comment with retrospective + unresolved items
```

---

## Supported AI Providers

Set `AI_PROVIDER` in your `.env` to switch providers. Only install the SDK for the one you use.

| `AI_PROVIDER` | SDK to install | Default model |
|---|---|---|
| `anthropic` (default) | `npm install @anthropic-ai/sdk` | `claude-opus-4-8` |
| `openai` | `npm install openai` | `gpt-4o` |
| `gemini` | `npm install @google/genai` | `gemini-2.0-flash` |

Override the model with the provider-specific variable: `ANTHROPIC_MODEL`, `OPENAI_MODEL`, or `GEMINI_MODEL`.

---

## Prerequisites

- [Node.js](https://nodejs.org/) v18+
- A [GitHub App](https://github.com/settings/apps/new) installed on your repository
- An API key for your chosen AI provider
- [ngrok](https://ngrok.com/download) (for local development) or any public HTTPS server

---

## Setup

### 1. Clone and install

```bash
git clone https://github.com/YOUR_USERNAME/leadbot.git
cd leadbot
npm install
```

### 2. Create a GitHub App

1. Go to **GitHub → Settings → Developer settings → GitHub Apps → New GitHub App**
2. Fill in:
   - **GitHub App name**: anything you like (e.g. `my-pr-reviewer`)
   - **Homepage URL**: your server URL or `http://localhost:3000`
   - **Webhook URL**: `https://YOUR-PUBLIC-URL/webhook` (update after ngrok step)
   - **Webhook secret**: choose a strong random string — you'll need it in `.env`
3. **Permissions → Repository permissions**:
   - `Contents`: Read
   - `Issues`: Read & Write
   - `Pull requests`: Read & Write
4. **Subscribe to events**: check `Pull request`
5. Click **Create GitHub App**
6. On the app page, scroll down → **Generate a private key** → save the `.pem` file into this project folder

### 3. Configure environment variables

Create a `.env` file in the project root:

```env
GITHUB_APP_ID=123456
GITHUB_APP_SLUG=my-pr-reviewer
GITHUB_WEBHOOK_SECRET=your-webhook-secret
PRIVATE_KEY_PATH=./private-key.pem

# AI provider — choose one: anthropic (default), openai, gemini
AI_PROVIDER=anthropic

# Add the key for your chosen provider:
ANTHROPIC_API_KEY=sk-ant-...
# ANTHROPIC_MODEL=claude-opus-4-8    # optional — defaults to claude-opus-4-8

# OPENAI_API_KEY=sk-...
# OPENAI_MODEL=gpt-4o                # optional

# GEMINI_API_KEY=...
# GEMINI_MODEL=gemini-2.0-flash      # optional

PORT=3000
```

| Variable | Where to find it |
|---|---|
| `GITHUB_APP_ID` | GitHub App settings page → App ID |
| `GITHUB_APP_SLUG` | GitHub App settings page → the slug in the app URL (e.g. `my-pr-reviewer`) |
| `GITHUB_WEBHOOK_SECRET` | The secret you chose when creating the app |
| `PRIVATE_KEY_PATH` | Path to the `.pem` file you downloaded |
| `AI_PROVIDER` | `anthropic` (default), `openai`, or `gemini` |
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com/) |
| `ANTHROPIC_MODEL` | Optional — defaults to `claude-opus-4-8` |
| `OPENAI_API_KEY` | [platform.openai.com](https://platform.openai.com/) |
| `OPENAI_MODEL` | Optional — defaults to `gpt-4o` |
| `GEMINI_API_KEY` | [aistudio.google.com](https://aistudio.google.com/) |
| `GEMINI_MODEL` | Optional — defaults to `gemini-2.0-flash` |

### 4. Expose your local server (development)

```bash
ngrok http 3000
```

Copy the `https://` forwarding URL and set it as the **Webhook URL** in your GitHub App settings:

```
https://YOUR-NGROK-URL/webhook
```

For production, deploy to any Node.js host (Railway, Render, Fly.io, etc.) and use that URL instead.

### 5. Install the app on your repository

1. GitHub App settings → **Install App**
2. Select the repository you want to review
3. Click **Install**

### 6. Start the server

```bash
npm start
```

```
Server running on port 3000
```

### 7. Open a pull request

Create a branch, push some code, open a PR. Within seconds you should see a review comment from the bot.

**Tip:** Link an issue in your PR body for richer context:
```
Closes #42
```

---

## Spec Generation

LeadBot can read a `requirements.md` file from a PR and produce:
- A structured OpenAPI 3.1 YAML spec (collapsed in the review comment)
- Individual GitHub issues for each endpoint / feature described

**Auto-trigger:** when a PR is opened and contains a `requirements.md` in its diff, LeadBot generates the spec automatically (once per PR).

**Manual trigger:** post the comment `/leadbot gen-spec` on any PR to run spec generation on demand, even if there is no `requirements.md`.

The spec is posted as a collapsible `<details>` block in the review comment so it doesn't clutter the timeline.

---

## Health Check

```
GET /health
```

Returns `{"status":"ok"}` with HTTP 200. Use this to verify the server is running.

---

## Running Tests

```bash
npm test
```

Runs the Vitest test suite (41 tests across `parsers.test.js` and `githubService.test.js`). No external credentials needed — GitHub API calls are intercepted via a test seam.

```bash
npm run test:watch   # re-run on file changes
```

---

## Docker

### Build and run

```bash
docker build -t leadbot .
docker run -p 3000:3000 --env-file .env leadbot
```

### Environment variables in Docker

Pass the `.env` file with `--env-file`, or set each variable individually with `-e`:

```bash
docker run -p 3000:3000 \
  -e GITHUB_APP_ID=123456 \
  -e GITHUB_APP_SLUG=my-pr-reviewer \
  -e GITHUB_WEBHOOK_SECRET=secret \
  -e PRIVATE_KEY_PATH=/run/secrets/leadbot.pem \
  -v /path/to/leadbot.pem:/run/secrets/leadbot.pem:ro \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  leadbot
```

---

## Project Structure

| File | Role |
|---|---|
| `index.js` | Express server, webhook verification, event routing |
| `githubService.js` | GitHub API calls — fetch diff, post comments, manage issues |
| `aiService.js` | AI logic — code review prompt, retrospective, spec generation |
| `parsers.js` | Pure parsing helpers — no side effects, fully tested |
| `providers.js` | Multi-provider AI abstraction (Anthropic / OpenAI / Gemini) |
| `parsers.test.js` | Unit tests for all pure functions in parsers.js |
| `githubService.test.js` | Integration-style tests for GitHub service functions |
| `.env` | Your secrets (never commit this) |
| `private-key.pem` | GitHub App private key (never commit this) |

---

## Keeping the Server Running

### Local / VPS — PM2 (recommended)

PM2 keeps the process alive after crashes and restarts it on reboot.

```bash
npm install -g pm2
pm2 start index.js --name leadbot
pm2 save            # persist across reboots
pm2 startup         # generate the startup command for your OS (follow the printed instruction)
```

Useful PM2 commands:

```bash
pm2 logs leadbot   # live logs
pm2 restart leadbot
pm2 stop leadbot
pm2 status
```

### Cloud Deployment

Any Node.js host works (Railway, Render, Fly.io, etc.). Key things to set up:

1. Set all environment variables from the `.env` section above
2. Upload `private-key.pem` securely — paste its contents as a multi-line env var `PRIVATE_KEY_CONTENTS` and update `githubService.js` line 11:

```js
privateKey: process.env.PRIVATE_KEY_CONTENTS || fs.readFileSync(process.env.PRIVATE_KEY_PATH, 'utf8'),
```

3. Point the GitHub App webhook URL to `https://YOUR-DOMAIN/webhook`
4. Run `npm start`

---

## Troubleshooting

| Problem | Fix |
|---|---|
| No comment posted | Check server logs. Verify ngrok is running and webhook URL is up to date |
| `401 Unauthorized` | Webhook secret in `.env` doesn't match GitHub App settings |
| `500` errors | Check `PRIVATE_KEY_PATH` — make sure the `.pem` file exists |
| Bot not detected on re-review | `GITHUB_APP_SLUG` must match exactly (check the URL slug of your app) |
| Merge warning not firing | The push must contain a commit whose message starts with `Merge branch` |
| Follow-up issue not opening | `GITHUB_APP_SLUG` missing from `.env` — bot can't identify its own comments |
| `LGTM` every time | Diff may be too clean — try a PR with real logic changes |

---

## Known Limitations

- **Diff truncation** — diffs larger than ~80 000 characters are sent to the AI as-is; very large PRs may exceed provider context limits.
- **In-memory delivery de-duplication** — GitHub retries webhook deliveries on failure. LeadBot de-dupes by delivery ID in memory, so a server restart during a retry window could result in a duplicate comment.
- **Spec generation is fire-and-forget** — if the AI response is malformed YAML the error is logged but no fallback is posted to the PR.

## Roadmap

- **Cross-repo support** — target a different repository for issue creation (e.g. open backend issues from a frontend PR)
- **Per-PR mode control** — use GitHub labels (`leadbot:review-only`, `leadbot:spec-gen`, `leadbot:skip`) to override behavior without touching config
- **Follow-up issue template redesign** — cleaner, more actionable format
- **Persistent delivery de-duplication** — use Redis or a small SQLite file so restarts don't break idempotency

---

## Security

- Never commit `.env` or `private-key.pem` — add them to `.gitignore`
- All webhook requests are verified using HMAC-SHA256 signature before processing
- The bot only reads and writes to repositories where the GitHub App is explicitly installed
