import { Router } from 'express';
import { getEvents, isNatsConnected } from './nats-monitor.js';

export const natsRouter = Router();

natsRouter.get('/nats/events', (_req, res) => {
  const after = parseInt((_req.query.after as string) || '0', 10);
  const subject = _req.query.subject as string | undefined;
  res.json(getEvents(after, subject));
});

natsRouter.get('/nats/health', (_req, res) => {
  res.json({ connected: isNatsConnected() });
});

natsRouter.get('/nats', (_req, res) => {
  res.type('html').send(HTML);
});

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>NATS Live Monitor</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace;
         background: #0d1117; color: #c9d1d9; padding: 16px; }
  .header { display: flex; align-items: center; gap: 16px; margin-bottom: 12px; flex-wrap: wrap; }
  h1 { font-size: 1.2rem; color: #58a6ff; }
  .status { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
  .status.on { background: #3fb950; }
  .status.off { background: #f85149; }
  .controls { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  input[type="text"] { background: #161b22; color: #c9d1d9; border: 1px solid #30363d;
    border-radius: 4px; padding: 6px 10px; font-size: 0.8rem; width: 240px; outline: none; }
  input:focus { border-color: #58a6ff; }
  button { background: #30363d; color: #c9d1d9; border: none; border-radius: 4px;
    padding: 6px 14px; font-size: 0.8rem; cursor: pointer; }
  button:hover { background: #484f58; }
  button.active { background: #238636; color: #fff; }
  .count { font-size: 0.75rem; color: #8b949e; }
  #feed { flex: 1; overflow-y: auto; border: 1px solid #21262d; border-radius: 6px;
    background: #0d1117; height: calc(100vh - 80px); }
  .entry { padding: 8px 12px; border-bottom: 1px solid #161b22; cursor: pointer;
    font-size: 0.8rem; }
  .entry:hover { background: #161b22; }
  .entry-header { display: flex; gap: 12px; align-items: baseline; }
  .time { color: #484f58; min-width: 80px; }
  .subject { font-weight: 600; }
  .subject.project { color: #79c0ff; }
  .subject.ai { color: #d2a8ff; }
  .subject.media { color: #ffa657; }
  .subject.workflow { color: #7ee787; }
  .payload { display: none; margin-top: 6px; padding: 8px; background: #161b22;
    border-radius: 4px; white-space: pre-wrap; word-break: break-all; font-size: 0.75rem;
    color: #8b949e; max-height: 400px; overflow-y: auto; }
  .entry.open .payload { display: block; }
  .nav { font-size: 0.75rem; color: #8b949e; margin-bottom: 8px; }
  .nav a { color: #58a6ff; text-decoration: none; }
  .nav a:hover { text-decoration: underline; }
</style>
</head>
<body>
<div class="nav"><a href="/bull">Bull Dashboard</a> | <strong>NATS Monitor</strong></div>
<div class="header">
  <h1>NATS Live Monitor</h1>
  <span id="indicator" class="status off"></span>
  <div class="controls">
    <input type="text" id="filter" placeholder="Filter subject (e.g. visiobook.ai.*)">
    <input type="text" id="search" placeholder="Search payloads...">
    <button id="pauseBtn" onclick="togglePause()">Pause</button>
    <button onclick="clearFeed()">Clear</button>
    <span id="count" class="count">0 events</span>
  </div>
</div>
<div id="feed"></div>
<script>
let lastId = 0;
let paused = false;
let allEntries = [];

function subjectClass(s) {
  if (s.startsWith('visiobook.ai.')) return 'ai';
  if (s.startsWith('visiobook.project.')) return 'project';
  if (s.startsWith('visiobook.media.')) return 'media';
  if (s.startsWith('visiobook.workflow.')) return 'workflow';
  return '';
}

function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function renderEntry(ev) {
  const time = new Date(ev.ts).toLocaleTimeString();
  const cls = subjectClass(ev.subject);
  const payload = typeof ev.data === 'string' ? ev.data : JSON.stringify(ev.data, null, 2);
  return '<div class="entry" onclick="this.classList.toggle(\\'open\\')">' +
    '<div class="entry-header">' +
    '<span class="time">' + time + '</span>' +
    '<span class="subject ' + cls + '">' + escapeHtml(ev.subject) + '</span>' +
    '</div>' +
    '<div class="payload">' + escapeHtml(payload) + '</div>' +
    '</div>';
}

function applySearch() {
  const term = document.getElementById('search').value.toLowerCase();
  const entries = document.querySelectorAll('.entry');
  entries.forEach(el => {
    el.style.display = !term || el.textContent.toLowerCase().includes(term) ? '' : 'none';
  });
}

function togglePause() {
  paused = !paused;
  const btn = document.getElementById('pauseBtn');
  btn.textContent = paused ? 'Resume' : 'Pause';
  btn.classList.toggle('active', paused);
}

function clearFeed() {
  allEntries = [];
  document.getElementById('feed').innerHTML = '';
  document.getElementById('count').textContent = '0 events';
}

async function poll() {
  if (paused) return;
  try {
    const filter = document.getElementById('filter').value.trim();
    let url = '/nats/events?after=' + lastId;
    if (filter) url += '&subject=' + encodeURIComponent(filter);
    const r = await fetch(url);
    const events = await r.json();
    const feed = document.getElementById('feed');
    const wasAtBottom = feed.scrollTop + feed.clientHeight >= feed.scrollHeight - 30;
    for (const ev of events) {
      allEntries.push(ev);
      feed.insertAdjacentHTML('beforeend', renderEntry(ev));
      lastId = ev.id;
    }
    if (events.length) {
      document.getElementById('count').textContent = allEntries.length + ' events';
      if (wasAtBottom) feed.scrollTop = feed.scrollHeight;
      applySearch();
    }
  } catch(e) {}
}

async function checkHealth() {
  try {
    const r = await fetch('/nats/health');
    const d = await r.json();
    const el = document.getElementById('indicator');
    el.className = 'status ' + (d.connected ? 'on' : 'off');
  } catch(e) {
    document.getElementById('indicator').className = 'status off';
  }
}

document.getElementById('search').addEventListener('input', applySearch);
setInterval(poll, 2000);
setInterval(checkHealth, 5000);
checkHealth();
</script>
</body>
</html>`;
