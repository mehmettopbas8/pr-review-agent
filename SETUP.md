# PR Review Agent — Setup & Testing Guide

## How It Works

```
GitHub PR opened/updated
        │
        ▼
POST /webhook  (your server)
        │
        ├─ Verify webhook signature
        ├─ Parse PR body for linked issue (e.g. "Closes #42")
        │
        ├─ githubService: fetch PR diff (patch format)
        ├─ githubService: fetch linked issue title + body (if found)
        │
        ├─ aiService: send issue context + diff to Claude
        │
        └─ githubService: post Claude's review as a PR Review Comment
```

---

## Step 1 — Install Dependencies

Open a terminal in this folder and run:

```bash
npm install
```

---

## Step 2 — Expose Your Local Server with ngrok

GitHub needs a public URL to send webhooks to your machine.

1. Download ngrok: https://ngrok.com/download
2. Run it:

```bash
ngrok http 3000
```

3. Copy the **Forwarding** URL it gives you, e.g.:

```
https://a1b2-123-456-789.ngrok-free.app
```

Keep this terminal open — closing it kills the tunnel.

---

## Step 3 — Configure the GitHub App Webhook URL

1. Go to: https://github.com/settings/apps
2. Click your app → **Edit**
3. Under **Webhook URL**, paste:

```
https://YOUR-NGROK-URL/webhook
```

4. Make sure **Webhook secret** matches what's in your `.env`:

```
<your-webhook-secret>
```

5. Under **Subscribe to events**, make sure **Pull requests** is checked.
6. Save changes.

---

## Step 4 — Install the App on Your Repository

1. In your GitHub App settings → **Install App**
2. Select the repository you want to test on
3. Click **Install**

---

## Step 5 — Start the Server

```bash
node index.js
```

You should see:

```
Server running on port 3000
```

---

## Step 6 — Open a Test Pull Request

1. Go to your test repository on GitHub
2. Create a new branch, make some changes, push it
3. Open a Pull Request
4. In the PR description, optionally link an issue:

```
Closes #1
```

5. Watch your terminal — the agent will log any errors
6. Within a few seconds, Claude's review will appear as a **Review Comment** on the PR

---

## Troubleshooting

| Problem | Fix |
|---|---|
| No comment posted | Check terminal for errors. Verify ngrok is running and the webhook URL is updated. |
| 401 Unauthorized | Webhook secret in `.env` doesn't match GitHub App settings |
| 500 from GitHub | Check `PRIVATE_KEY_PATH` — make sure `private-key.pem` is in this folder |
| `LGTM` every time | The diff may be too small or clean — try a more complex PR |
| Issue not fetched | Make sure PR body contains `Closes #N`, `Fixes #N`, or `Resolves #N` |

---

## File Overview

| File | Role |
|---|---|
| `index.js` | Express server, webhook verification, orchestration |
| `githubService.js` | Fetches PR diff, linked issue, posts review comment |
| `aiService.js` | Sends diff + issue context to Claude, returns review |
| `.env` | Your secrets and config |
| `private-key.pem` | GitHub App private key for Octokit auth |
