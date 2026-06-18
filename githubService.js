const { Octokit } = require('@octokit/rest');
const { createAppAuth } = require('@octokit/auth-app');
const fs = require('fs');
const { botMatchesLogin, filterDiff, isRetrospectiveComment, extractFollowUpItems, buildFollowUpBody } = require('./parsers');

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
  return extractFollowUpItems(botReviews);
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

async function createFollowUpIssue(installationId, owner, repo, pullNumber, { todos, mediums, blockers = [] }, prAuthor) {
  const octokit = getOctokit(installationId);
  await ensureLabel(octokit, owner, repo, 'technical-debt', 'e4e669', 'Unresolved TODOs that need follow-up');
  if (blockers.length > 0) {
    await ensureLabel(octokit, owner, repo, 'severity:high', 'b60205', 'Contains critical or high-severity blockers');
  }

  const body = buildFollowUpBody({ todos, mediums, blockers, pullNumber });
  const labels = ['technical-debt', ...(blockers.length > 0 ? ['severity:high'] : [])];

  try {
    await octokit.rest.issues.create({
      owner, repo,
      title: `Follow-up: unresolved items from PR #${pullNumber}`,
      body,
      labels,
      assignees: prAuthor ? [prAuthor] : [],
    });
  } catch (err) {
    if (err.status === 403) {
      console.error(`createFollowUpIssue 403: re-authorize the GitHub App's Issues permission for ${owner}/${repo}`);
    }
    throw err;
  }
}

async function postReviewComment(installationId, owner, repo, pullNumber, body) {
  const octokit = getOctokit(installationId);
  await octokit.rest.pulls.createReview({
    owner, repo, pull_number: pullNumber,
    body, event: 'COMMENT',
  });
}

async function getFileFromPR(installationId, owner, repo, pullNumber, filename) {
  const octokit = getOctokit(installationId);
  // Get PR head SHA
  const { data: pr } = await octokit.rest.pulls.get({ owner, repo, pull_number: pullNumber });
  const ref = pr.head.sha;
  try {
    const { data } = await octokit.rest.repos.getContent({ owner, repo, path: filename, ref });
    if (data.type !== 'file') return null;
    return Buffer.from(data.content, 'base64').toString('utf8');
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

async function createIssuesFromSpec(installationId, owner, repo, issues) {
  const octokit = getOctokit(installationId);
  const created = [];
  for (const issue of issues) {
    const labels = Array.isArray(issue.labels) ? issue.labels : [];
    for (const label of labels) {
      await ensureLabel(octokit, owner, repo, label, '0075ca', '').catch(() => {});
    }
    try {
      const { data } = await octokit.rest.issues.create({
        owner, repo,
        title: issue.title,
        body: issue.body || '',
        labels,
      });
      created.push({ number: data.number, url: data.html_url, title: data.title });
    } catch (err) {
      if (err.status === 403) {
        console.error(`createIssuesFromSpec 403: re-authorize the GitHub App's Issues permission for ${owner}/${repo}`);
      }
      throw err;
    }
  }
  return created;
}

module.exports = {
  getPRDiff, getHeadCommitMessage, getLinkedIssue, postReviewComment,
  getOpenIssueSummary, getAllBotReviews, getMergeFollowUpItems,
  createFollowUpIssue, getFileFromPR, createIssuesFromSpec,
};
