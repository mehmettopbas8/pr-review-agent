require('dotenv').config();

const REQUIRED_VARS = ['GITHUB_WEBHOOK_SECRET', 'GITHUB_APP_ID', 'PRIVATE_KEY_PATH'];
const missing = REQUIRED_VARS.filter(v => !process.env[v]);
if (missing.length > 0) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

const express = require('express');
const { Webhooks } = require('@octokit/webhooks');
const { getPRDiff, getHeadCommitMessage, getLinkedIssue, postReviewComment, getOpenIssueSummary, getAllBotReviews, getMergeFollowUpItems, createFollowUpIssue } = require('./githubService');
const { reviewDiff, summarizePR } = require('./aiService');

const app = express();
const webhooks = new Webhooks({ secret: process.env.GITHUB_WEBHOOK_SECRET });

app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));

app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const signature = req.headers['x-hub-signature-256'];
  if (!signature || !(await webhooks.verify(req.body.toString(), signature))) {
    return res.status(401).send('Unauthorized');
  }

  const payload = JSON.parse(req.body);
  const action = payload.action;

  const isMerge = action === 'closed' && payload.pull_request.merged === true;

  if (action !== 'opened' && action !== 'synchronize' && !isMerge) {
    return res.status(200).send('Ignored');
  }

  res.status(200).send('Processing');

  try {
    const { number: pullNumber, body: prBody, user: { login: prAuthor }, base: { repo: { name: repo, owner: { login: owner } } } } = payload.pull_request;
    const installationId = payload.installation.id;
    const botLogin = process.env.GITHUB_APP_SLUG ? `${process.env.GITHUB_APP_SLUG}[bot]` : null;

    if (isMerge) {
      if (!botLogin) return;
      const [{ todos, mediums, blockers }, allReviews] = await Promise.all([
        getMergeFollowUpItems(installationId, owner, repo, pullNumber, botLogin),
        getAllBotReviews(installationId, owner, repo, pullNumber, botLogin),
      ]);

      console.log(`[retro] allReviews count: ${allReviews.length}`);
      const hasUnresolved = todos.length > 0 || mediums.length > 0 || blockers.length > 0;
      const [followUpIssue, retrospective] = await Promise.all([
        hasUnresolved
          ? createFollowUpIssue(installationId, owner, repo, pullNumber, { todos, mediums }, prAuthor).catch(err => {
              console.error('Failed to create follow-up issue:', err.message);
              return null;
            })
          : Promise.resolve(null),
        allReviews.length > 0 ? summarizePR(allReviews).then(r => {
          console.log(`[retro] summarizePR result length: ${r ? r.length : 'null'}, preview: ${r ? r.slice(0, 80) : 'null'}`);
          return r;
        }).catch(err => {
          console.error('Failed to generate retrospective:', err.message);
          return null;
        }) : Promise.resolve(null),
      ]);

      console.log(`[retro] retrospective truthy: ${!!retrospective}, hasUnresolved: ${hasUnresolved}`);
      // Skip posting if there is nothing to say
      if (!retrospective && !hasUnresolved) return;

      const lines = ['## 🏁 PR Retrospective', ''];
      if (retrospective) lines.push(retrospective, '');

      if (hasUnresolved) {
        lines.push('---', '', '⚠️ **Unresolved items — tracked in the follow-up issue:**', '');
        if (blockers.length > 0) lines.push('**Critical / High:**', ...blockers.map(b => `- ${b}`), '');
        if (todos.length > 0) lines.push('**TODOs Before Merge:**', ...todos.map(t => `- ${t}`), '');
        if (mediums.length > 0) lines.push('**Medium / Low:**', ...mediums.map(m => `- ${m}`), '');
      }

      await postReviewComment(installationId, owner, repo, pullNumber, lines.join('\n'));
      return;
    }

    if (action === 'synchronize' && botLogin) {
      const headMessage = await getHeadCommitMessage(installationId, owner, repo, pullNumber);
      if (/^merge branch/i.test(headMessage)) {
        const { todos, mediums, blockers } = await getMergeFollowUpItems(installationId, owner, repo, pullNumber, botLogin);
        if (blockers.length > 0 || todos.length > 0 || mediums.length > 0) {
          const lines = [];
          if (blockers.length > 0) {
            lines.push('⛔ **This PR is NOT ready to merge — unresolved Critical/High issues:**', '');
            lines.push(...blockers.map(b => `- ${b}`), '');
          } else {
            lines.push('🔀 **Merge commit detected — don\'t forget before merging this PR:**', '');
          }
          if (todos.length > 0) lines.push('**TODOs Before Merge:**', ...todos.map(t => `- ${t}`), '');
          if (mediums.length > 0) lines.push('**Medium / Low Issues:**', ...mediums.map(m => `- ${m}`), '');
          await postReviewComment(installationId, owner, repo, pullNumber, lines.join('\n'));
          return;
        }
      }
    }

    const [diff, issue] = await Promise.all([
      getPRDiff(installationId, owner, repo, pullNumber),
      getLinkedIssue(installationId, owner, repo, prBody),
    ]);
    // getOpenIssueSummary needs the filtered diff, so runs after
    const openIssueSummary = botLogin
      ? await getOpenIssueSummary(installationId, owner, repo, pullNumber, botLogin, diff)
      : '';
    const review = await reviewDiff(diff, issue, openIssueSummary);
    await postReviewComment(installationId, owner, repo, pullNumber, review);
  } catch (err) {
    console.error('Error processing PR:', err);
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log(`Server running on port ${process.env.PORT || 3000}`);
});
