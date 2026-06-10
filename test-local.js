// Local test — mocks GitHub & AI, prints what the bot would post for each scenario
// Run: node test-local.js

const postedComments = [];

// --- Mocks ---
jest_mock_githubService = {
  getPRDiff: async () => `diff --git a/app.js b/app.js\n+console.log('hello')`,
  getHeadCommitMessage: async () => 'fix: update logic',
  getLinkedIssue: async () => null,
  getOpenIssueSummary: async () => '',
  getAllBotReviews: async (_, __, ___, ____, scenario) => {
    if (scenario === 'no-prior-reviews') return [];
    if (scenario === 'has-reviews') return ['1. [High] Missing auth check in app.js\n**Verdict: Changes Requested**'];
    return [];
  },
  getMergeFollowUpItems: async (_, __, ___, ____, scenario) => {
    if (scenario === 'no-prior-reviews') return { todos: [], mediums: [], blockers: [] };
    if (scenario === 'has-unresolved') return {
      todos: ['1. [TODO before merge] Add DB migration'],
      mediums: [],
      blockers: ['1. [High] Missing auth check in app.js'],
    };
    return { todos: [], mediums: [], blockers: [] };
  },
  createFollowUpIssue: async () => {},
  postReviewComment: async (_, __, ___, ____, body) => {
    postedComments.push(body);
    console.log('\n--- POSTED COMMENT ---\n' + body + '\n---\n');
  },
};

jest_mock_aiService = {
  reviewDiff: async () => '1. [High] Missing input validation\n**Verdict: Changes Requested** — please fix.',
  summarizePR: async () => 'Great work overall. One round of review needed.',
};

// --- Inline handler logic (mirrors index.js) ---
async function runScenario(label, action, merged, botLoginOverride) {
  console.log(`\n========== SCENARIO: ${label} ==========`);
  const installationId = 1;
  const owner = 'test-owner';
  const repo = 'test-repo';
  const pullNumber = 42;
  const prAuthor = 'alice';
  const prBody = '';
  const botLogin = botLoginOverride || 'claude-pr-reviewer-agent[bot]';

  const isMerge = action === 'closed' && merged === true;

  if (action !== 'opened' && action !== 'synchronize' && !isMerge) {
    console.log('-> IGNORED (not opened/synchronize/merge)');
    return;
  }

  const gh = jest_mock_githubService;
  const ai = jest_mock_aiService;

  // Pass botLogin as scenario key hack for test
  const scenarioKey = botLoginOverride;

  if (isMerge) {
    if (!botLogin) { console.log('-> SKIP (no botLogin)'); return; }
    const [{ todos, mediums, blockers }, allReviews] = await Promise.all([
      gh.getMergeFollowUpItems(installationId, owner, repo, pullNumber, scenarioKey),
      gh.getAllBotReviews(installationId, owner, repo, pullNumber, scenarioKey),
    ]);

    const hasUnresolved = todos.length > 0 || mediums.length > 0 || blockers.length > 0;
    const [, retrospective] = await Promise.all([
      hasUnresolved
        ? gh.createFollowUpIssue(installationId, owner, repo, pullNumber, { todos, mediums }, prAuthor).catch(() => null)
        : Promise.resolve(null),
      allReviews.length > 0 ? ai.summarizePR(allReviews) : Promise.resolve(null),
    ]);

    const lines = ['## 🏁 PR Retrospective', ''];
    if (retrospective) lines.push(retrospective, '');
    if (hasUnresolved) {
      lines.push('---', '', '⚠️ **Unresolved items:**', '');
      if (blockers.length > 0) lines.push('**Critical / High:**', ...blockers.map(b => `- ${b}`), '');
      if (todos.length > 0) lines.push('**TODOs:**', ...todos.map(t => `- ${t}`), '');
      if (mediums.length > 0) lines.push('**Medium / Low:**', ...mediums.map(m => `- ${m}`), '');
    }

    // Guard: skip if nothing to say
    if (!retrospective && !hasUnresolved) { console.log('-> SKIP (nothing to post)'); return; }
    await gh.postReviewComment(installationId, owner, repo, pullNumber, lines.join('\n'));
    return;
  }

  // opened / synchronize
  const [diff, issue] = await Promise.all([
    gh.getPRDiff(installationId, owner, repo, pullNumber),
    gh.getLinkedIssue(installationId, owner, repo, prBody),
  ]);
  const openIssueSummary = await gh.getOpenIssueSummary(installationId, owner, repo, pullNumber, botLogin, diff);
  const review = await ai.reviewDiff(diff, issue, openIssueSummary);
  await gh.postReviewComment(installationId, owner, repo, pullNumber, review);
}

(async () => {
  await runScenario('PR opened (normal)', 'opened', false, 'no-prior-reviews');
  await runScenario('PR merged — no prior reviews (BUG: posts empty retrospective)', 'closed', true, 'no-prior-reviews');
  await runScenario('PR merged — has prior reviews', 'closed', true, 'has-reviews');
  await runScenario('PR merged — has unresolved items', 'closed', true, 'has-unresolved');

  console.log(`\n========== SUMMARY ==========`);
  console.log(`Total comments posted: ${postedComments.length}`);
  const emptyRetros = postedComments.filter(c => c.trim() === '## 🏁 PR Retrospective');
  if (emptyRetros.length > 0) {
    console.log(`⚠️  DETECTED: ${emptyRetros.length} empty retrospective(s) posted — this is the bug`);
  } else {
    console.log('✅ No empty retrospectives posted');
  }
})();
