# TODO

## Tomorrow

### 1. Fix Follow-up Issue Template
The follow-up issue currently gets created but the template is not ideal.
- Redesign the body format in `githubService.js → createFollowUpIssue()`
- Make it cleaner and more actionable (clear sections, checkboxes, links back to the PR)
- The 403 "Resource not accessible by integration" error may also still occur — investigate whether GitHub App installation needs re-authorization after the Issues permission was added

### 2. Requirements → Issues + API Spec Generation
Given a requirements file, the bot should:
1. Parse requirements from the file (format TBD — likely markdown)
2. Generate a structured GitHub issue list from the requirements
3. Generate an OpenAPI YAML spec from the requirements
4. Post both as output (either as a PR comment or directly open the issues on GitHub)

Steps to implement:
- [ ] Decide the trigger: PR comment command (e.g. `/leadbot gen-spec`) or automatic when a `requirements.md` file is included in the PR diff
- [ ] Write the AI prompt in `aiService.js` — one call that returns both a YAML spec block and a JSON issue list
- [ ] Write a `createIssuesFromSpec(issues)` function in `githubService.js`
- [ ] Wire it up in `index.js` — detect the trigger, call AI, post issues

### 3. Remove Debug Logs (cleanup)
Remove the `[retro]` console.log lines added for debugging from `index.js` once everything is confirmed stable.
