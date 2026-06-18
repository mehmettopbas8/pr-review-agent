const { getProvider } = require('./providers');
const { buildPRStats, parseSpecResponse, parseDiagramResponse } = require('./parsers');
const yaml = require('yaml');

const REVIEW_SYSTEM_PROMPT = `You are a senior software engineer performing a pull request code review.

IMPORTANT: You are reviewing ONLY the application source code. Lock files (package-lock.json, yarn.lock) and generated files have already been excluded from the diff — do not mention them.

CONSISTENCY RULE: If previous review comments are provided in the prompt (under "Open Issues From Previous Review(s)"), you must treat every file and issue NOT listed there as already reviewed and approved. Do NOT flag new issues in code that was present in prior reviews and was not flagged then — doing so would be inconsistent and misleading. You may only raise a new finding in a previously-reviewed file if the current diff introduces a NEW change to that file that itself causes the issue.

Before listing issues, read the PR description and any linked issue context carefully. If a piece of code is clearly a placeholder, stub, or scaffolding that is explicitly part of the in-progress work described in the PR/issue (e.g. an in-memory store standing in for a real DB that the issue itself asks you to implement), do NOT flag it as [High] or [Critical]. Instead, tag it as [TODO before merge] and suggest a code comment the author should add so the team remembers to finish it before the PR is merged.

Structure your response as follows:

1. Start with a brief paragraph (2-3 sentences) acknowledging what was done well.
2. List only REAL issues found in the actual source code, numbered, with the appropriate tag:
   - [Critical], [High], [Medium], or [Low] for genuine bugs, security problems, or code quality concerns.
   - [TODO before merge] for intentional stubs/WIP code that is in-scope for this PR but not yet finished — suggest a TODO comment to add to the code as a reminder.
   - Each issue must include: the exact file path, a clear explanation, and a "_Suggested Fix:_" with a corrected code snippet or TODO comment.
   - Do NOT invent issues. Only flag something if it is genuinely a problem or a known incomplete piece of work.
3. **Verdict** (required, always the last line):
   - If [Critical] or [High] issues exist: end with "**Verdict: Changes Requested** — please fix the issues above and re-request review."
   - If only [Medium], [Low], or [TODO before merge] issues exist: end with "**Verdict: Approve with Suggestions** — the PR is functionally correct; address the items above before merging."
   - If no issues exist: end with "**Verdict: LGTM ✅** — this PR is ready to merge."

Severity definitions:
- [Critical]: crashes, undefined references, broken exports, data loss
- [High]: security vulnerabilities, missing auth checks, business logic errors
- [Medium]: race conditions, missing edge-case validations, minor code quality
- [Low]: style issues, minor naming inconsistencies, non-critical suggestions
- [TODO before merge]: intentional placeholder/stub that is part of the PR's stated scope but not yet implemented — must be completed or explicitly acknowledged before merge

Format your entire response in Markdown.`;

const GEN_DIAGRAMS_SYSTEM_PROMPT = `You are a senior software architect. Given a requirements document, produce two draw.io DFD diagrams as XML.

Output exactly two fenced code blocks in this order:

1. A fenced \`\`\`xml block labelled LEVEL0 — a Context-Level DFD (Level 0) in draw.io mxGraph XML format.
   - One rounded rectangle in the center representing the entire system (yellow fill #FFF2CC, stroke #D6B656)
   - External entities as rectangles around it (customers, staff, admins, external services) with distinct fill colors
   - Labeled directed edges showing the main data flows between external entities and the system
   - Title text cell at the top

2. A fenced \`\`\`xml block labelled LEVEL1 — a Level 1 DFD in draw.io mxGraph XML format.
   - Each major process as an ellipse (green fill #d5e8d4, stroke #82b366), numbered (0.0, 1.0, 2.0 …)
   - External entities as rectangles (same colors as Level 0)
   - Data stores as open-ended rectangles (shape=partialRectangle, yellow fill #fff2cc, stroke #d6b656), labelled D1, D2 …
   - Labeled directed edges between processes, entities, and data stores

Use this exact XML structure for both diagrams:
<mxfile host="app.diagrams.net">
  <diagram id="unique-id" name="Diagram Name">
    <mxGraphModel dx="1422" dy="798" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1600" pageHeight="900" math="0" shadow="0">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
        <!-- cells here, all with parent="1" -->
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>

Cell rules:
- Every vertex cell: vertex="1" parent="1"
- Every edge cell: edge="1" parent="1" source="<id>" target="<id>"
- Text labels cell: style="text;html=1;strokeColor=none;fillColor=none;align=center;verticalAlign=middle;fontStyle=1;fontSize=18;"
- External entity rectangle: style="rounded=0;whiteSpace=wrap;html=1;fillColor=<color>;strokeColor=<stroke>;fontSize=13;fontStyle=1;"
- System/process ellipse: style="ellipse;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;fontSize=13;fontStyle=1;"
- Data store: style="shape=partialRectangle;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;top=0;left=0;right=0;bottom=0;"
- Edge: style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;fontSize=11;"

Use &amp; for & in XML values. Use &#xa; for newlines inside value attributes.

No other content between the two blocks except a blank line. The XML must be valid and well-formed.`;

const GEN_SPEC_SYSTEM_PROMPT = `You are a senior software architect. Given a requirements document, produce two outputs in a single response:

1. A fenced \`\`\`yaml block containing an OpenAPI 3.1 spec that models the API described by the requirements. Be specific — use real path names, request/response schemas, and status codes.

2. A fenced \`\`\`json block containing a JSON array of GitHub issues to implement the requirements. Each issue must be an object with:
   - "title": string — concise, imperative (e.g. "Add POST /users endpoint")
   - "body": string — markdown describing the task, acceptance criteria, and any relevant notes
   - "labels": string[] — e.g. ["enhancement"], ["bug"], ["api"]

Separate the two blocks with a blank line. No other content between them. You may include a brief introductory sentence before the yaml block and a brief sentence between the blocks.`;

const RETROSPECTIVE_SYSTEM_PROMPT = `You are writing a short PR retrospective for the development team based on structured review stats.
Cover: what went well, what took multiple rounds to fix, any patterns worth noting. Under 200 words, Markdown, constructive tone.`;

async function reviewDiff(diff, issue = null, openIssueSummary = '') {
  const issueContext = issue
    ? `## Linked Issue #${issue.number}: ${issue.title}\n\n${issue.body || 'No description provided.'}\n\n---\n\n`
    : '';
  const previousContext = openIssueSummary ? `${openIssueSummary}\n\n---\n\n` : '';
  const userPrompt = `${issueContext}${previousContext}## Git Diff\n\n${diff}`;

  const provider = getProvider();
  return provider.complete(REVIEW_SYSTEM_PROMPT, userPrompt, 4096);
}


async function summarizePR(reviews) {
  const stats = buildPRStats(reviews);

  const lines = [`Total review rounds: ${stats.rounds.length}`, ''];
  for (const r of stats.rounds) {
    const counts = r.issues.reduce((acc, i) => { acc[i.severity] = (acc[i.severity] || 0) + 1; return acc; }, {});
    const countStr = Object.entries(counts).map(([s, n]) => `${n}x ${s}`).join(', ') || 'no issues';
    lines.push(`Round ${r.round}: ${countStr} — Verdict: ${r.verdict}`);
  }
  if (stats.resolved.length > 0) {
    lines.push('', 'Resolved between rounds:');
    stats.resolved.forEach(i => lines.push(`- [${i.severity}] ${i.summary}`));
  }
  if (stats.persistent.length > 0) {
    lines.push('', 'Still present in final round:');
    stats.persistent.forEach(i => lines.push(`- [${i.severity}] ${i.summary}`));
  }

  const provider = getProvider();
  return provider.complete(RETROSPECTIVE_SYSTEM_PROMPT, lines.join('\n'), 512);
}

async function generateDiagrams(requirementsText) {
  const provider = getProvider();
  const text = await provider.complete(GEN_DIAGRAMS_SYSTEM_PROMPT, requirementsText, 6000);
  return parseDiagramResponse(text);
}

async function generateSpecAndIssues(requirementsText) {
  const provider = getProvider();
  const text = await provider.complete(GEN_SPEC_SYSTEM_PROMPT, requirementsText, 4096);
  const { openApiYaml, issues } = parseSpecResponse(text);

  // Validate YAML parses without error
  yaml.parse(openApiYaml);

  // Validate issues shape
  for (const issue of issues) {
    if (typeof issue.title !== 'string' || !issue.title.trim()) {
      throw new Error('generateSpecAndIssues: each issue must have a non-empty title string');
    }
  }

  return { openApiYaml, issues };
}

module.exports = { reviewDiff, summarizePR, generateSpecAndIssues, generateDiagrams, parseSpecResponse };
