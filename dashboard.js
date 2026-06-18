const express = require('express');
const { generateSpecAndIssues } = require('./aiService');

const router = express.Router();

// Simple token-based auth for the dashboard.
// Set DASHBOARD_TOKEN in env. If not set, dashboard is disabled.
function authMiddleware(req, res, next) {
  const token = process.env.DASHBOARD_TOKEN;
  if (!token) return res.status(503).send('Dashboard disabled — set DASHBOARD_TOKEN to enable.');
  const provided = req.headers['x-dashboard-token'] || req.query.token;
  if (provided !== token) return res.status(401).send('Unauthorized');
  next();
}

router.use(authMiddleware);

// GET /dashboard — main UI
router.get('/', (_req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(HTML);
});

// POST /dashboard/generate — run spec generation from pasted requirements
router.post('/generate', express.json(), async (req, res) => {
  const { requirements } = req.body;
  if (!requirements || !requirements.trim()) {
    return res.status(400).json({ error: 'requirements text is required' });
  }
  try {
    const result = await generateSpecAndIssues(requirements);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /dashboard/status — env / config snapshot
router.get('/status', (_req, res) => {
  res.json({
    provider: process.env.AI_PROVIDER || 'anthropic',
    model: process.env.ANTHROPIC_MODEL || process.env.OPENAI_MODEL || process.env.GEMINI_MODEL || '(default)',
    appId: process.env.GITHUB_APP_ID || '(not set)',
    appSlug: process.env.GITHUB_APP_SLUG || '(not set)',
    privateKeySource: process.env.PRIVATE_KEY_CONTENTS ? 'env (PRIVATE_KEY_CONTENTS)' : `file (${process.env.PRIVATE_KEY_PATH})`,
    nodeVersion: process.version,
    uptime: Math.floor(process.uptime()) + 's',
  });
});

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>LeadBot Dashboard</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, sans-serif; background: #0d1117; color: #e6edf3; min-height: 100vh; }
  header { background: #161b22; border-bottom: 1px solid #30363d; padding: 16px 24px; display: flex; align-items: center; gap: 12px; }
  header h1 { font-size: 18px; font-weight: 600; }
  header .badge { font-size: 11px; background: #238636; color: #fff; padding: 2px 8px; border-radius: 12px; }
  main { max-width: 1000px; margin: 0 auto; padding: 24px; display: grid; gap: 20px; }
  .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 20px; }
  .card h2 { font-size: 14px; font-weight: 600; color: #7d8590; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 14px; }
  .status-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; }
  .stat { background: #0d1117; border: 1px solid #30363d; border-radius: 6px; padding: 10px 14px; }
  .stat .label { font-size: 11px; color: #7d8590; margin-bottom: 4px; }
  .stat .value { font-size: 13px; font-weight: 500; font-family: monospace; }
  textarea { width: 100%; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #e6edf3; font-family: monospace; font-size: 13px; padding: 12px; resize: vertical; min-height: 220px; outline: none; }
  textarea:focus { border-color: #388bfd; }
  .row { display: flex; gap: 10px; align-items: center; margin-top: 12px; }
  button { background: #238636; color: #fff; border: none; border-radius: 6px; padding: 8px 18px; font-size: 14px; font-weight: 500; cursor: pointer; }
  button:disabled { opacity: .5; cursor: not-allowed; }
  button.secondary { background: #21262d; border: 1px solid #30363d; }
  #status-msg { font-size: 13px; color: #7d8590; }
  .output-section { display: none; margin-top: 16px; }
  .output-section.visible { display: block; }
  .tabs { display: flex; gap: 2px; margin-bottom: 12px; }
  .tab { background: #21262d; border: 1px solid #30363d; border-radius: 6px 6px 0 0; padding: 6px 14px; font-size: 13px; cursor: pointer; border-bottom: none; }
  .tab.active { background: #0d1117; border-bottom-color: #0d1117; color: #58a6ff; }
  .tab-content { display: none; background: #0d1117; border: 1px solid #30363d; border-radius: 0 6px 6px 6px; padding: 14px; }
  .tab-content.active { display: block; }
  pre { white-space: pre-wrap; word-break: break-word; font-size: 12px; font-family: monospace; color: #e6edf3; max-height: 400px; overflow-y: auto; }
  .issue-list { list-style: none; display: grid; gap: 8px; }
  .issue-item { background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 10px 14px; }
  .issue-item .title { font-weight: 500; font-size: 14px; }
  .issue-item .meta { font-size: 12px; color: #7d8590; margin-top: 4px; }
  .issue-item .body-preview { font-size: 12px; color: #8b949e; margin-top: 6px; white-space: pre-wrap; }
  .label-tag { display: inline-block; background: #1f6feb33; color: #58a6ff; border: 1px solid #1f6feb66; border-radius: 12px; font-size: 11px; padding: 1px 8px; margin-right: 4px; }
  .copy-btn { font-size: 11px; background: #21262d; border: 1px solid #30363d; color: #8b949e; border-radius: 4px; padding: 2px 8px; cursor: pointer; float: right; }
  .error-box { background: #2d1b1b; border: 1px solid #6e3535; border-radius: 6px; padding: 12px; color: #f85149; font-size: 13px; margin-top: 12px; }
</style>
</head>
<body>
<header>
  <h1>🤖 LeadBot</h1>
  <span class="badge">Admin</span>
</header>
<main>

  <!-- Status card -->
  <div class="card" id="status-card">
    <h2>System Status</h2>
    <div class="status-grid" id="status-grid">
      <div class="stat"><div class="label">Loading…</div></div>
    </div>
  </div>

  <!-- Spec generator -->
  <div class="card">
    <h2>Requirements → Spec + Issues Preview</h2>
    <textarea id="req-input" placeholder="Paste your requirements.md content here…"></textarea>
    <div class="row">
      <button id="gen-btn" onclick="runGenerate()">Generate</button>
      <button class="secondary" onclick="document.getElementById('req-input').value=''; hideOutput()">Clear</button>
      <span id="status-msg"></span>
    </div>
    <div id="error-box" class="error-box" style="display:none"></div>

    <div class="output-section" id="output-section">
      <div class="tabs">
        <div class="tab active" onclick="switchTab('issues')">Issues (<span id="issue-count">0</span>)</div>
        <div class="tab" onclick="switchTab('spec')">OpenAPI YAML</div>
      </div>
      <div class="tab-content active" id="tab-issues">
        <ul class="issue-list" id="issue-list"></ul>
      </div>
      <div class="tab-content" id="tab-spec">
        <button class="copy-btn" onclick="copySpec()">Copy</button>
        <pre id="spec-output"></pre>
      </div>
    </div>
  </div>

</main>

<script>
const token = new URLSearchParams(location.search).get('token') || '';
const headers = { 'Content-Type': 'application/json', 'x-dashboard-token': token };

async function loadStatus() {
  try {
    const r = await fetch('/dashboard/status?token=' + token);
    const d = await r.json();
    document.getElementById('status-grid').innerHTML = Object.entries(d).map(([k, v]) =>
      '<div class="stat"><div class="label">' + k + '</div><div class="value">' + v + '</div></div>'
    ).join('');
  } catch (e) {
    document.getElementById('status-grid').innerHTML = '<div class="stat"><div class="label">Error loading status</div></div>';
  }
}

async function runGenerate() {
  const text = document.getElementById('req-input').value.trim();
  if (!text) return;
  const btn = document.getElementById('gen-btn');
  const msg = document.getElementById('status-msg');
  const errBox = document.getElementById('error-box');
  btn.disabled = true;
  msg.textContent = 'Generating…';
  errBox.style.display = 'none';
  hideOutput();

  try {
    const r = await fetch('/dashboard/generate?token=' + token, {
      method: 'POST', headers, body: JSON.stringify({ requirements: text })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || r.statusText);
    renderOutput(d);
    msg.textContent = 'Done — ' + (d.issues || []).length + ' issues generated.';
  } catch (e) {
    errBox.textContent = 'Error: ' + e.message;
    errBox.style.display = 'block';
    msg.textContent = '';
  } finally {
    btn.disabled = false;
  }
}

function renderOutput(d) {
  const issues = d.issues || [];
  document.getElementById('issue-count').textContent = issues.length;
  document.getElementById('issue-list').innerHTML = issues.map((iss, i) =>
    '<li class="issue-item">' +
    '<div class="title">#' + (i + 1) + ' ' + escHtml(iss.title) + '</div>' +
    '<div class="meta">' + (iss.labels || []).map(l => '<span class="label-tag">' + escHtml(l) + '</span>').join('') + '</div>' +
    (iss.body ? '<div class="body-preview">' + escHtml(iss.body.slice(0, 200)) + (iss.body.length > 200 ? '…' : '') + '</div>' : '') +
    '</li>'
  ).join('');
  document.getElementById('spec-output').textContent = d.openApiYaml || '';
  document.getElementById('output-section').classList.add('visible');
  switchTab('issues');
}

function hideOutput() {
  document.getElementById('output-section').classList.remove('visible');
}

function switchTab(name) {
  document.querySelectorAll('.tab').forEach((t, i) => t.classList.toggle('active', ['issues','spec'][i] === name));
  document.querySelectorAll('.tab-content').forEach((t, i) => t.classList.toggle('active', ['tab-issues','tab-spec'][i] === 'tab-' + name));
}

function copySpec() {
  navigator.clipboard.writeText(document.getElementById('spec-output').textContent);
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

loadStatus();
</script>
</body>
</html>`;

module.exports = router;
