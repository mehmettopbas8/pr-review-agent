require('dotenv').config();

const REQUIRED_VARS = ['GITHUB_WEBHOOK_SECRET', 'GITHUB_APP_ID'];
const missing = REQUIRED_VARS.filter(v => !process.env[v]);
if (missing.length > 0) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}
if (!process.env.PRIVATE_KEY_CONTENTS && !process.env.PRIVATE_KEY_PATH) {
  console.error('Missing required environment variable: PRIVATE_KEY_CONTENTS or PRIVATE_KEY_PATH');
  process.exit(1);
}

const express = require('express');
const { Webhooks } = require('@octokit/webhooks');
const {
  getPRDiff, getHeadCommitMessage, getLinkedIssue, postReviewComment,
  getOpenIssueSummary, getAllBotReviews, getMergeFollowUpItems,
  createFollowUpIssue, getFileFromPR, getPRHeadBranch, createIssuesFromSpec,
  commitFilesToBranch,
} = require('./githubService');
const { reviewDiff, summarizePR, generateSpecAndIssues, generateDiagrams } = require('./aiService');

const dashboard = require('./dashboard');

const app = express();
const webhooks = new Webhooks({ secret: process.env.GITHUB_WEBHOOK_SECRET });

// In-memory de-dupe sets.
// deliveryIds: prevents double-processing GitHub retried deliveries.
// specGeneratedForPR: prevents re-running spec generation on synchronize after opened.
const deliveryIds = new Set();
const specGeneratedForPR = new Set();

app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));
app.use('/dashboard', dashboard);

app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const signature = req.headers['x-hub-signature-256'];
  if (!signature || !(await webhooks.verify(req.body.toString(), signature))) {
    return res.status(401).send('Unauthorized');
  }

  const deliveryId = req.headers['x-github-delivery'];
  if (deliveryId && deliveryIds.has(deliveryId)) {
    return res.status(200).send('Duplicate delivery — ignored');
  }
  if (deliveryId) deliveryIds.add(deliveryId);

  const payload = JSON.parse(req.body);
  const action = payload.action;

  // Handle issue_comment events (slash command trigger)
  if (payload.comment && action === 'created') {
    res.status(200).send('Processing');
    await handleCommentEvent(payload).catch(err => console.error('Error processing comment:', err));
    return;
  }

  const isMerge = action === 'closed' && payload.pull_request && payload.pull_request.merged === true;

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

      const hasUnresolved = todos.length > 0 || mediums.length > 0 || blockers.length > 0;
      const [, retrospective] = await Promise.all([
        hasUnresolved
          ? createFollowUpIssue(installationId, owner, repo, pullNumber, { todos, mediums, blockers }, prAuthor).catch(err => {
              console.error('Failed to create follow-up issue:', err.message);
              return null;
            })
          : Promise.resolve(null),
        allReviews.length > 0
          ? summarizePR(allReviews).catch(err => {
              console.error('Failed to generate retrospective:', err.message);
              return null;
            })
          : Promise.resolve(null),
      ]);

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

    // Auto-detect requirements.md on opened events only (de-dupe: skip if already run)
    if (action === 'opened' && !specGeneratedForPR.has(pullNumber)) {
      const touchedRequirements = /^diff --git a\/requirements\.md /m.test(diff);
      if (touchedRequirements) {
        specGeneratedForPR.add(pullNumber);
        handleSpecGeneration(installationId, owner, repo, pullNumber).catch(err =>
          console.error('Spec generation failed:', err.message)
        );
      }
    }

    const openIssueSummary = botLogin
      ? await getOpenIssueSummary(installationId, owner, repo, pullNumber, botLogin, diff)
      : '';
    const review = await reviewDiff(diff, issue, openIssueSummary);
    await postReviewComment(installationId, owner, repo, pullNumber, review);
  } catch (err) {
    console.error('Error processing PR:', err);
  }
});

async function handleCommentEvent(payload) {
  const comment = payload.comment;
  const issue = payload.issue;
  // Only act on PR comments (not plain issues)
  if (!issue.pull_request) return;
  // Guard: don't respond to bot's own comments
  const botLogin = process.env.GITHUB_APP_SLUG ? `${process.env.GITHUB_APP_SLUG}[bot]` : null;
  if (botLogin && comment.user.login === botLogin) return;
  // Only react to the slash command
  if (!/^\s*\/leadbot\s+gen-spec\s*$/m.test(comment.body)) return;

  const installationId = payload.installation.id;
  const { name: repo, owner: { login: owner } } = issue.repository || payload.repository;
  const pullNumber = issue.number;

  await handleSpecGeneration(installationId, owner, repo, pullNumber);
}

async function handleSpecGeneration(installationId, owner, repo, pullNumber) {
  const requirementsText = await getFileFromPR(installationId, owner, repo, pullNumber, 'requirements.md');
  if (!requirementsText) {
    await postReviewComment(installationId, owner, repo, pullNumber,
      '⚠️ **LeadBot:** No `requirements.md` found at the PR head — nothing to generate.');
    return;
  }

  // Step 1: generate DFD diagrams and commit them to the PR branch
  let diagramSection = '';
  try {
    const branch = await getPRHeadBranch(installationId, owner, repo, pullNumber);

    const { level0Xml, level1Xml } = await generateDiagrams(requirementsText);
    await commitFilesToBranch(installationId, owner, repo, branch, [
      { path: 'docs/level0.drawio', content: level0Xml },
      { path: 'docs/level1.drawio', content: level1Xml },
    ], 'docs: add LeadBot-generated DFD diagrams (level0 + level1)');

    diagramSection = [
      '### DFD Diagrams',
      '',
      'Committed to this branch:',
      `- [\`docs/level0.drawio\`](../../blob/${branch}/docs/level0.drawio) — Context-Level DFD`,
      `- [\`docs/level1.drawio\`](../../blob/${branch}/docs/level1.drawio) — Level 1 DFD`,
      '',
    ].join('\n');
  } catch (err) {
    console.error('Diagram generation failed:', err.message);
    diagramSection = `> ⚠️ Diagram generation failed: ${err.message}\n\n`;
  }

  // Step 2: generate OpenAPI spec + issues
  let openApiYaml, issues;
  try {
    ({ openApiYaml, issues } = await generateSpecAndIssues(requirementsText));
  } catch (err) {
    await postReviewComment(installationId, owner, repo, pullNumber,
      `⚠️ **LeadBot:** Spec generation failed — ${err.message}`);
    return;
  }

  const created = await createIssuesFromSpec(installationId, owner, repo, issues);

  const issueLinks = created.map(i => `- [#${i.number} ${i.title}](${i.url})`).join('\n');
  const body = [
    '## LeadBot: Requirements → Diagrams + Spec + Issues',
    '',
    diagramSection,
    `### GitHub Issues (${created.length} created)`,
    '',
    issueLinks,
    '',
    '<details>',
    '<summary>Generated OpenAPI 3.1 Spec</summary>',
    '',
    '```yaml',
    openApiYaml,
    '```',
    '</details>',
  ].join('\n');

  await postReviewComment(installationId, owner, repo, pullNumber, body);
}

app.listen(process.env.PORT || 3000, () => {
  console.log(`Server running on port ${process.env.PORT || 3000}`);
});
