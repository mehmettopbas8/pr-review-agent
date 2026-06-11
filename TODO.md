# TODO

> Full day-by-day execution plan lives in **ROADMAP-2026-06-11.md**. This file is the running task list.

## Ship blockers (must land today)

### 1. Fix Follow-up Issue Template + 403 error
The follow-up issue gets created but the template is weak, and a 403 may still occur.
- [ ] Redesign `githubService.js → createFollowUpIssue()` body: extract a pure `buildFollowUpBody({todos, mediums, blockers, pullNumber})`, use `## ` severity sections, `- [ ]` checkboxes, a back-link to the PR, and a collapsed context block.
- [ ] 403 "Resource not accessible by integration" is a **permissions** issue, not code: the GitHub App needs `Issues: write` AND the installation must be **re-authorized** after the permission was added. Re-accept on the test repo.
- [ ] Add a friendly `err.status === 403` catch with an actionable log message.

### 2. Requirements → Issues + OpenAPI Spec generation
Given a `requirements.md`, generate a GitHub issue list and an OpenAPI YAML spec.
- [x] **Decision: trigger = BOTH** — `/leadbot gen-spec` PR comment *and* auto-detect when `requirements.md` is in the PR diff.
- [ ] `aiService.js`: add `generateSpecAndIssues(requirementsText)` (one model call → fenced ```yaml``` spec + ```json``` issue array) and a pure `parseSpecResponse(text)`.
- [ ] `githubService.js`: add `createIssuesFromSpec(...)` and a `requirements.md` fetch helper; post the spec as a collapsed PR comment.
- [ ] `index.js`: register the `issue_comment` (`created`) event for the slash command; add auto-detect in the `opened` path; share one `handleSpecGeneration()` between them; de-dupe so `synchronize` doesn't regenerate.

### 3. Remove Debug Logs (cleanup)
- [ ] Remove the three `[retro]` `console.log` lines in `index.js` (~L39, L49, L57). Keep the `console.error` handlers.

## Missing for a real ship (added during planning)

- [ ] **Tests** — none exist. Cover the regex-heavy parsing (`filterDiff`, `botMatchesLogin`, `isRetrospectiveComment`, merge follow-up regexes, `buildPRStats`, `parseSpecResponse`) with vitest; mock Octokit for service tests.
- [ ] **Env validation** at startup in `index.js` (fail fast if a critical var is missing).
- [ ] **`GET /health`** endpoint.
- [ ] **`.env.example`** documenting all vars (see ROADMAP audit table).
- [ ] **README.md** — App setup, permissions, env, usage, local dev, tests, limitations.
- [ ] **Dockerfile + .dockerignore + CI** (`.github/workflows/ci.yml` running `npm test`).
- [ ] **.gitignore** — stop committing `.idea/` and `.vs/`; ignore `.env`, `*.pem`.
- [ ] **Perf:** `getOctokit` reads the private key from disk on every call — read once at module load.
- [ ] **Idempotency:** GitHub retries deliveries; de-dupe on `x-github-delivery` to avoid double-posting.
