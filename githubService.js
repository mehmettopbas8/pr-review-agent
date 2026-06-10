const { Octokit } = require('@octokit/rest');
const { createAppAuth } = require('@octokit/auth-app');
const fs = require('fs');

function getOctokit(installationId) {
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: process.env.GITHUB_APP_ID,
      privateKey: fs.readFileSync(process.env.PRIVATE_KEY_PATH, 'utf8'),
      installationId,
    },
  });
}

// Tolerant bot login matcher: handles "myapp[bot]", "myapp", "myapp-bot" variations
function botMatchesLogin(userLogin, botLogin) {
  if (!botLogin) return false;
  const normalize = s => s.toLowerCase().replace(/[[\]]/g, '').replace(/-bot$/, '');
  return normalize(userLogin) === normalize(botLogin);
}

const IGNORED_PATTERNS = [
  /^diff --git a\/(.*\/)?(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|.*\.lock)/,
  /^diff --git a\/.*\.(min\.js|min\.css|map)$/,
];

function filterDiff(rawDiff) {
  const files = rawDiff.split(/(?=^diff --git )/m);
  const filtered = files.filter(chunk => !IGNORED_PATTERNS.some(re => re.test(chunk)));
  const joined = filtered.join('');
  // Cap at ~80k chars to stay within model context
  return joined.length > 80000 ? joined.slice(0, 80000) + '\n\n[diff truncated]' : joined;
}

async function getPRDiff(installationId, owner, repo, pullNumber) {
  const octokit = getOctokit(installationId);
  const { data } = await octokit.rest.pulls.get({
    owner, repo, pull_number: pullNumber,
    mediaType: { format: 'diff' },
  });
  return filterDiff(data);
}

async function getHeadCommitMessage(installationId, owner, repo, pullNumber) {
  const octokit = getOctokit(installationId);
  const { data } = await octokit.rest.pulls.listCommits({ owner, repo, pull_number: pullNumber });
  if (data.length === 0) return '';
  return data[data.length - 1].commit.message;
}

// Extracts open issues from previous bot reviews and cross-checks against new diff.
// Returns a compact summary (~100 tokens) instead of sending full review text to AI.
async function getOpenIssueSummary(installationId, owner, repo, pullNumber, botLogin, filteredDiff) {
  const octokit = getOctokit(installationId);
  const { data } = await octokit.rest.pulls.listReviews({ owner, repo, pull_number: pullNumber });

  const botReviews = data
    .filter(r => botMatchesLogin(r.user.login, botLogin) && !isRetrospectiveComment(r.body))
    .map(r => r.body);
  if (botReviews.length === 0) return '';

  // Match numbered items regardless of bold/italic markdown wrapping around severity tags
  const issueLineRe = /^[\s>]*\**\d+\.\**\s+\**\[(Critical|High|Medium|Low|TODO before merge)\]\**[^\n]*/gm;
  // Extract file paths mentioned right after the issue line (backtick path or plain path pattern)
  const filePathRe = /`([^`]+\.[a-z]+)`|(\b[\w./-]+\.[a-z]{2,4}\b)/;

  const allIssues = [];
  for (const body of botReviews) {
    let match;
    issueLineRe.lastIndex = 0;
    while ((match = issueLineRe.exec(body)) !== null) {
      const severity = match[1];
      const line = match[0].trim();
      const pathMatch = line.match(filePathRe);
      const filePath = pathMatch ? (pathMatch[1] || pathMatch[2]) : null;
      allIssues.push({ severity, line: line.slice(0, 120), filePath });
    }
  }

  if (allIssues.length === 0) return '';

  // Determine which flagged files were touched in the new diff
  const touchedFiles = new Set(
    [...filteredDiff.matchAll(/^diff --git a\/.+ b\/(.+)$/gm)].map(m => m[1])
  );

  const open = [];
  const addressed = [];
  for (const issue of allIssues) {
    if (issue.filePath && touchedFiles.has(issue.filePath)) {
      addressed.push(issue);
    } else {
      open.push(issue);
    }
  }

  const lines = ['## Open Issues From Previous Review(s)'];
  if (open.length > 0) {
    lines.push('These issues were NOT touched in this push — check if they are still present:');
    open.forEach(i => lines.push(`- [${i.severity}] ${i.line}`));
  }
  if (addressed.length > 0) {
    lines.push('\nThese files were modified — verify the issues below are resolved:');
    addressed.forEach(i => lines.push(`- [${i.severity}] ${i.line}`));
  }
  lines.push('\nIf all issues above are resolved and no new ones exist, give LGTM.');

  return lines.join('\n');
}

async function getLinkedIssue(installationId, owner, repo, prBody) {
  const match = prBody && prBody.match(/(?:closes|fixes|resolves)\s+#(\d+)/i);
  if (!match) return null;
  const octokit = getOctokit(installationId);
  const { data } = await octokit.rest.issues.get({ owner, repo, issue_number: parseInt(match[1]) });
  return { number: data.number, title: data.title, body: data.body };
}

// Retrospective comments (merge summaries) are excluded — they confuse the AI when
// generating a new retrospective and don't contain reviewable issue data.
function isRetrospectiveComment(body) {
  return /^##\s+🏁\s+PR Retrospective/m.test(body) || /^🔀\s+\*\*Merge commit detected/m.test(body) || /^⛔\s+\*\*This PR is NOT ready/m.test(body);
}

async function getAllBotReviews(installationId, owner, repo, pullNumber, botLogin) {
  const octokit = getOctokit(installationId);
  const { data } = await octokit.rest.pulls.listReviews({ owner, repo, pull_number: pullNumber });
  return data
    .filter(r => botMatchesLogin(r.user.login, botLogin) && !isRetrospectiveComment(r.body))
    .map(r => r.body);
}

async function getMergeFollowUpItems(installationId, owner, repo, pullNumber, botLogin) {
  const octokit = getOctokit(installationId);
  const { data } = await octokit.rest.pulls.listReviews({ owner, repo, pull_number: pullNumber });

  const botReviews = data
    .filter(r => botMatchesLogin(r.user.login, botLogin) && !isRetrospectiveComment(r.body))
    .map(r => r.body);
  if (botReviews.length === 0) return { todos: [], mediums: [], blockers: [] };
  // Use the latest review that actually contains issue items; fall back to the last one.
  const hasIssues = body => /^[\s>]*\**\d+\.\**\s+\**\[(Critical|High|Medium|Low|TODO before merge)\]/m.test(body);
  const latestReview = [...botReviews].reverse().find(hasIssues) ?? botReviews[botReviews.length - 1];

  // Match numbered items regardless of bold/italic markdown wrapping around severity tags
  // Handles: "1. [High]", "1. **[High]**", "1. **[High]", "**1.** [High]"
  const todoRe = /^[\s>]*\**\d+\.\**\s+\**\[TODO before merge\]\**[^\n]*/gm;
  const mediumRe = /^[\s>]*\**\d+\.\**\s+\**\[(?:Medium|Low)\]\**[^\n]*/gm;
  const blockerRe = /^[\s>]*\**\d+\.\**\s+\**\[(?:Critical|High)\]\**[^\n]*/gm;
  const todos = [];
  const mediums = [];
  const blockers = [];

  let match;
  todoRe.lastIndex = 0;
  while ((match = todoRe.exec(latestReview)) !== null) todos.push(match[0].trim().slice(0, 150));
  mediumRe.lastIndex = 0;
  while ((match = mediumRe.exec(latestReview)) !== null) mediums.push(match[0].trim().slice(0, 150));
  blockerRe.lastIndex = 0;
  while ((match = blockerRe.exec(latestReview)) !== null) blockers.push(match[0].trim().slice(0, 150));

  return { todos: [...new Set(todos)], mediums: [...new Set(mediums)], blockers: [...new Set(blockers)] };
}

async function ensureLabel(octokit, owner, repo, name, color, description) {
  try {
    await octokit.rest.issues.getLabel({ owner, repo, name });
  } catch (err) {
    if (err.status === 404) {
      await octokit.rest.issues.createLabel({ owner, repo, name, color, description });
    } else {
      throw err;
    }
  }
}

async function createFollowUpIssue(installationId, owner, repo, pullNumber, { todos, mediums }, prAuthor) {
  const octokit = getOctokit(installationId);
  await ensureLabel(octokit, owner, repo, 'technical-debt', 'e4e669', 'Unresolved TODOs that need follow-up');

  const sections = [
    `These items were left unresolved when PR #${pullNumber} was merged. They should be addressed in a follow-up PR.`,
    '',
  ];

  if (todos.length > 0) {
    sections.push('## TODOs Before Merge', ...todos.map(t => `- ${t}`), '');
  }
  if (mediums.length > 0) {
    sections.push('## Medium / Low Issues', ...mediums.map(m => `- ${m}`), '');
  }

  sections.push(`_Automatically opened by the PR review bot when #${pullNumber} was merged._`);

  await octokit.rest.issues.create({
    owner,
    repo,
    title: `Follow-up: unresolved items from PR #${pullNumber}`,
    body: sections.join('\n'),
    labels: ['technical-debt'],
    assignees: prAuthor ? [prAuthor] : [],
  });
}

async function postReviewComment(installationId, owner, repo, pullNumber, body) {
  const octokit = getOctokit(installationId);
  await octokit.rest.pulls.createReview({
    owner, repo, pull_number: pullNumber,
    body, event: 'COMMENT',
  });
}

module.exports = { getPRDiff, getHeadCommitMessage, getLinkedIssue, postReviewComment, getOpenIssueSummary, getAllBotReviews, getMergeFollowUpItems, createFollowUpIssue };
