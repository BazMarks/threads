#!/usr/bin/env node
// A session's state for the Threads page, written by Claude Code's hooks or by hand. One file per session:
//   <data>/live/<session id>.json  {session, state, at, sticky?, task?}
// Hook mode reads the hook's JSON from stdin and keeps only session_id (and, for a notification, its type). The prompt
// is never read. The optional task label is the user's own words from --task, never text from a transcript.
//
//   node hooks/status.mjs --hook running|idle|awaiting          from the hooks (see hooks/README.md)
//   node hooks/status.mjs --state awaiting|waiting|running|idle by hand, inside a session
//   node hooks/status.mjs --task "<2-6 words>"                   a short label for the session (48 characters at most)
//   node hooks/status.mjs --print-install                        the settings block for the three hooks
// Options: --session <id> (else CLAUDE_SESSION_ID, else this folder's newest transcript), --claude <dir>, --data <dir>.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const STATES = ['awaiting', 'waiting', 'running', 'idle'];
const SID = /^[A-Za-z0-9-]{8,80}$/;
const ASKS = ['permission_prompt', 'elicitation_dialog'];
const HERE = path.dirname(fileURLToPath(import.meta.url));
const folderOf = (p) => String(p || '').replace(/[\\/]+$/, '').replace(/[^A-Za-z0-9]/g, '-');
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

/** The newest transcript of a working folder, as a session id, or ''. */
export function newestSession(claudeDir, cwd) {
  const dir = path.join(claudeDir, 'projects', folderOf(cwd));
  let best = '', at = -1, names = [];
  try { names = fs.readdirSync(dir); } catch { return ''; }
  for (const n of names) {
    if (!n.endsWith('.jsonl')) continue;
    const id = n.slice(0, -6);
    if (!SID.test(id)) continue;
    try { const m = fs.statSync(path.join(dir, n)).mtimeMs; if (m > at) { at = m; best = id; } } catch { /* gone */ }
  }
  return best;
}

function readLive(file) {
  try { const o = JSON.parse(fs.readFileSync(file, 'utf8')); return o && typeof o === 'object' ? o : {}; } catch { return {}; }
}

/** Merges one change {state?, sticky?, task?} into the session's live file (temp file + rename). -> {file, value} */
export function writeLive(dataDir, session, change = {}, now = Date.now()) {
  if (!SID.test(session || '')) throw new Error('no session id');
  const dir = path.join(dataDir, 'live');
  const file = path.join(dir, `${session}.json`);
  const prev = readLive(file);
  const prevAt = Date.parse(prev.at);
  const onlyTask = change.state == null && change.task != null && Number.isFinite(prevAt);
  const next = { session, state: STATES.includes(prev.state) ? prev.state : 'running', at: onlyTask ? prev.at : new Date(now).toISOString() };
  if (change.state != null) next.state = change.state;
  const sticky = change.sticky != null ? change.sticky === true : prev.sticky === true;
  if (sticky) next.sticky = true;
  const task = change.task != null ? clean(change.task, 48) : clean(prev.task, 48);
  if (task) next.task = task;
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
  return { file, value: next };
}

/** The hook's stdin JSON -> {session, type} or null. Nothing else is kept. */
export function hookInput(text) {
  let o = null;
  try { o = JSON.parse(String(text || '')); } catch { return null; }
  if (!o || typeof o !== 'object' || typeof o.session_id !== 'string' || !SID.test(o.session_id)) return null;
  return { session: o.session_id, type: typeof o.notification_type === 'string' ? o.notification_type : '' };
}

/** The settings block that runs this file from the three hooks. */
export function installSnippet(scriptPath = fileURLToPath(import.meta.url)) {
  const p = path.resolve(scriptPath).replace(/\\/g, '/');
  const cmd = (state) => [{ hooks: [{ type: 'command', command: `node "${p}" --hook ${state}`, timeout: 5 }] }];
  return { hooks: { UserPromptSubmit: cmd('running'), Stop: cmd('idle'), Notification: cmd('awaiting') } };
}

function arg(argv, name) { const i = argv.indexOf(name); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null; }
const USAGE = 'usage: node hooks/status.mjs --state awaiting|waiting|running|idle [--task "<2-6 words>"] [--session <id>] [--claude <dir>] [--data <dir>]\n'
  + '       node hooks/status.mjs --hook running|idle|awaiting   (from the hooks)\n'
  + '       node hooks/status.mjs --print-install';

export async function main(argv = process.argv.slice(2), env = process.env, { stdin = null, out = console.log, err = console.error } = {}) {
  const dataDir = path.resolve(arg(argv, '--data') || env.THREADS_DATA || path.join(HERE, '..', 'data'));
  if (argv.includes('--print-install')) { out(JSON.stringify(installSnippet(), null, 2)); return 0; }
  const hook = arg(argv, '--hook');
  if (hook != null) {
    // a hook never fails the session: every problem ends quietly with 0
    try {
      if (!['running', 'idle', 'awaiting'].includes(hook)) return 0;
      const raw = stdin != null ? stdin : fs.readFileSync(0, 'utf8');
      const h = hookInput(raw);
      if (!h) return 0;
      const prev = readLive(path.join(dataDir, 'live', `${h.session}.json`));
      if (hook === 'running') writeLive(dataDir, h.session, { state: 'running', sticky: false });
      else if (hook === 'idle') { if (!(prev.sticky === true && (prev.state === 'awaiting' || prev.state === 'waiting'))) writeLive(dataDir, h.session, { state: 'idle', sticky: false }); }
      else if (ASKS.includes(h.type) && prev.sticky !== true) writeLive(dataDir, h.session, { state: 'awaiting', sticky: false });
    } catch { /* the session goes on */ }
    return 0;
  }
  const state = arg(argv, '--state'), task = arg(argv, '--task');
  if (state == null && task == null) { err(USAGE); return 2; }
  if (state != null && !STATES.includes(state)) { err('the state is awaiting, waiting, running or idle'); return 2; }
  if (task != null && !clean(task, 48)) { err('the task label is empty'); return 2; }
  const claude = arg(argv, '--claude') || env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  const session = arg(argv, '--session') || env.CLAUDE_SESSION_ID || newestSession(claude, process.cwd());
  if (!SID.test(session || '')) { err('no session id: pass --session, or run this inside a Claude Code session'); return 2; }
  const change = {};
  if (state != null) { change.state = state; change.sticky = state === 'awaiting' || state === 'waiting'; }
  if (task != null) change.task = task;
  writeLive(dataDir, session, change);
  out('status saved');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then((code) => { process.exitCode = code; }, () => { process.exitCode = 0; });
}
