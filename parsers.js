// Pure, side-effect-free parsing helpers extracted from githubService.js and aiService.js.
// All functions here are synchronous and take/return plain values — no Octokit, no network.

function botMatchesLogin(userLogin, botLogin) {
  if (!botLogin) return false;
  const normalize = s => s.toLowerCase().replace(/\[bot\]$/, '').replace(/-bot$/, '');
  return normalize(userLogin) === normalize(botLogin);
}

const IGNORED_PATTERNS = [
  /^diff --git a\/(.*\/)?(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|.*\.lock)/,
  /^diff --git a\/.*\.(min\.js|min\.css|map)$/m,
];

function filterDiff(rawDiff) {
  const files = rawDiff.split(/(?=^diff --git )/m);
  const filtered = files.filter(chunk => !IGNORED_PATTERNS.some(re => re.test(chunk)));
  const joined = filtered.join('');
  return joined.length > 80000 ? joined.slice(0, 80000) + '\n\n[diff truncated]' : joined;
}

function isRetrospectiveComment(body) {
  return (
    /^##\s+🏁\s+PR Retrospective/m.test(body) ||
    /^🔀\s+\*\*Merge commit detected/m.test(body) ||
    /^⛔\s+\*\*This PR is NOT ready/m.test(body)
  );
}

// Extracts todos/mediums/blockers from the latest bot review body that has issue items.
function extractFollowUpItems(botReviews) {
  if (botReviews.length === 0) return { todos: [], mediums: [], blockers: [] };

  const hasIssues = body => /^[\s>]*\**\d+\.\**\s+\**\[(Critical|High|Medium|Low|TODO before merge)\]/m.test(body);
  const latestReview = [...botReviews].reverse().find(hasIssues) ?? botReviews[botReviews.length - 1];

  const todoRe = /^[\s>]*\**\d+\.\**\s+\**\[TODO before merge\]\**[^\n]*/gm;
  const mediumRe = /^[\s>]*\**\d+\.\**\s+\**\[(?:Medium|Low)\]\**[^\n]*/gm;
  const blockerRe = /^[\s>]*\**\d+\.\**\s+\**\[(?:Critical|High)\]\**[^\n]*/gm;

  const extract = re => {
    const items = [];
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(latestReview)) !== null) items.push(m[0].trim().slice(0, 150));
    return [...new Set(items)];
  };

  return { todos: extract(todoRe), mediums: extract(mediumRe), blockers: extract(blockerRe) };
}

// Builds the body text for a follow-up issue. Pure — returns a string.
function buildFollowUpBody({ todos, mediums, blockers, pullNumber }) {
  const lines = [
    `These items were left unresolved when PR #${pullNumber} was merged. Address them in a follow-up PR.`,
    '',
  ];

  if (blockers.length > 0) {
    lines.push('## Critical / High', '');
    blockers.forEach(b => lines.push(`- [ ] ${b}`));
    lines.push('');
  }
  if (todos.length > 0) {
    lines.push('## TODOs Before Merge', '');
    todos.forEach(t => lines.push(`- [ ] ${t}`));
    lines.push('');
  }
  if (mediums.length > 0) {
    lines.push('## Medium / Low', '');
    mediums.forEach(m => lines.push(`- [ ] ${m}`));
    lines.push('');
  }

  lines.push(
    '<details>',
    '<summary>Context</summary>',
    '',
    `Auto-generated when PR #${pullNumber} was merged.`,
    '</details>',
    '',
    `_Automatically opened by the PR review bot when [#${pullNumber}](#${pullNumber}) was merged._`,
  );

  return lines.join('\n');
}

// Parses AI response that contains a fenced ```yaml and ```json block.
function parseSpecResponse(text) {
  const yamlMatch = text.match(/```yaml\s*([\s\S]*?)```/i);
  const jsonMatch = text.match(/```json\s*([\s\S]*?)```/i);
  if (!yamlMatch) throw new Error('parseSpecResponse: missing ```yaml block in AI response');
  if (!jsonMatch) throw new Error('parseSpecResponse: missing ```json block in AI response');
  const openApiYaml = yamlMatch[1].trim();
  let issues;
  try {
    issues = JSON.parse(jsonMatch[1].trim());
  } catch (e) {
    throw new Error(`parseSpecResponse: invalid JSON in issues block — ${e.message}`);
  }
  if (!Array.isArray(issues)) throw new Error('parseSpecResponse: issues block must be a JSON array');
  return { openApiYaml, issues };
}

// Builds PR stats from an array of review body strings.
function buildPRStats(reviews) {
  const severityRe = /^[\s>]*\**\d+\.\**\s+\**\[(Critical|High|Medium|Low|TODO before merge)\]\**\s*([^\n]*)/gm;
  const verdictRe = /\*\*Verdict:\s*([^*]+)\*\*/;

  const rounds = reviews.map((body, i) => {
    const issues = [];
    let match;
    severityRe.lastIndex = 0;
    while ((match = severityRe.exec(body)) !== null) {
      issues.push({ severity: match[1], summary: match[2].slice(0, 80) });
    }
    const verdictMatch = body.match(verdictRe);
    return { round: i + 1, issues, verdict: verdictMatch ? verdictMatch[1].trim() : 'Unknown' };
  });

  const resolved = [];
  const persistent = [];
  if (rounds.length > 1) {
    const lastKeys = new Set(rounds[rounds.length - 1].issues.map(i => i.summary));
    for (const issue of rounds[0].issues) {
      (lastKeys.has(issue.summary) ? persistent : resolved).push(issue);
    }
  }

  return { rounds, resolved, persistent };
}

// Given bot review bodies and a filtered diff, returns a formatted open-issue summary string.
// Pure — all inputs are plain strings/arrays.
function buildOpenIssueSummary(botReviewBodies, filteredDiff) {
  const issueLineRe = /^[\s>]*\**\d+\.\**\s+\**\[(Critical|High|Medium|Low|TODO before merge)\]\**[^\n]*/gm;
  const filePathRe = /`([^`]+\.[a-z]+)`|(\b[\w./-]+\.[a-z]{2,4}\b)/;

  const allIssues = [];
  for (const body of botReviewBodies) {
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

module.exports = {
  botMatchesLogin,
  filterDiff,
  isRetrospectiveComment,
  extractFollowUpItems,
  buildFollowUpBody,
  parseSpecResponse,
  buildPRStats,
  buildOpenIssueSummary,
};
