// The five states of a session, and the small files the page writes: Got it (seen.jsonl), Park (parked.jsonl), and the
// live files the status hooks write (live/<session>.json).
//   run   ● cyan       a write in the last 10 minutes, a background job still out, or its hook says running
//   await ! red        its hook says it waits for your answer (a permission prompt or a question)
//   wait  ⧗ grey-blue  it said so itself (hooks/status.mjs --state waiting)
//   idle  … yellow     stopped, not yet seen
//   done  ✓ green      you pressed Got it; it leaves the tree and counts in "done this week" (from Monday 00:00 local)
import fsp from 'node:fs/promises';
import path from 'node:path';
import { lp, appendJsonl, one, sha256hex, ls, statSafe } from './util.mjs';

export const RUN_MS = 10 * 60000, STALE_RUN_MS = 30 * 60000, AWAIT_GRACE_MS = 3000;
export const SHOW_MS = 2 * 3600000, LIVE_SHOW_MS = 12 * 3600000;
export const GLYPH = { run: '●', await: '!', wait: '⧗', idle: '…', done: '✓' };
export const NODE_ID = /^s-[a-f0-9]{16}$/;
/** A session's id on the page: a hash, so no session id leaves the server. */
export const nodeId = (session) => `s-${sha256hex(String(session)).slice(0, 16)}`;
/** A project's key on the page: a hash of its transcript folder name. */
export const projectKey = (folder) => `p-${sha256hex(String(folder)).slice(0, 10)}`;
export const LIVE_STATES = ['awaiting', 'waiting', 'running', 'idle'];
const SESSION_ID = /^[A-Za-z0-9-]{8,80}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Monday 00:00 (local) of the week that holds now, in ms. */
export function weekStart(now = Date.now()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

/**
 * file: its live file {state, at, sticky} or null; idleSec: seconds since it or a helper last wrote; ownAt: when its
 * own transcript was last written; lastAt: when its state last changed; seenAt: its newest Got it; bg: jobs still out.
 */
export function sessionState({ file = null, idleSec = null, ownAt = 0, lastAt = 0, seenAt = null, bg = 0 } = {}) {
  const seen = seenAt != null && seenAt >= (lastAt || 0);
  let fs = file ? file.state : '';
  if (fs === 'awaiting' && !file.sticky && ownAt > file.at + AWAIT_GRACE_MS) fs = 'running'; // it wrote again: answered
  if (fs === 'awaiting') return 'await';
  if (fs === 'waiting') return 'wait';
  if (fs === 'running' && idleSec != null && idleSec * 1000 < STALE_RUN_MS) return 'run';
  if (bg > 0) return 'run';
  if (!fs && idleSec != null && idleSec * 1000 < RUN_MS) return 'run';
  return seen ? 'done' : 'idle';
}

/** On the tree: a live file changed in the last 12 hours, or, without one, a write in the last 2. */
export function sessionShown({ file = null, idleSec = null, now = Date.now() } = {}) {
  if (file && file.at) return now - file.at < LIVE_SHOW_MS;
  return idleSec != null && idleSec * 1000 < SHOW_MS;
}

export function countStates(nodes, doneWeek = 0) {
  const c = { run: 0, await: 0, wait: 0, idle: 0, done: doneWeek };
  for (const n of nodes) if (n.st in c && n.st !== 'done') c[n.st]++;
  return c;
}

const bad = (status, error) => ({ status, body: { ok: false, error } });
const atOf = (v) => (typeof v === 'string' ? Date.parse(v) : typeof v === 'number' ? v : NaN);

// ---------------------------------------------------------------- Got it
/** seen.jsonl -> Map(id -> {at, name}); the newest line per id wins. */
export function parseSeen(text) {
  const m = new Map();
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (!o || typeof o.id !== 'string' || !NODE_ID.test(o.id)) continue;
    const at = atOf(o.at);
    if (!Number.isFinite(at)) continue;
    const had = m.get(o.id);
    if (!had || had.at <= at) m.set(o.id, { at, name: one(o.name, 40) });
  }
  return m;
}
export async function readSeen(file) {
  try { return parseSeen(await fsp.readFile(lp(file), 'utf8')); } catch { return new Map(); }
}
/** body: {id, name?}. -> {status, body} */
export async function markSeen(file, body, now = Date.now()) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return bad(400, 'expected {id}');
  const extra = Object.keys(body).find((k) => k !== 'id' && k !== 'name');
  if (extra) return bad(400, `unknown key ${one(extra, 20)}`);
  if (typeof body.id !== 'string' || !NODE_ID.test(body.id)) return bad(400, 'which one? (s-<id>)');
  if (body.name != null && typeof body.name !== 'string') return bad(400, 'name must be text');
  const name = one(body.name, 40);
  const line = { at: new Date(now).toISOString(), id: body.id, name };
  await appendJsonl(file, line);
  return { status: 200, body: { ok: true, id: body.id, at: line.at } };
}

// ---------------------------------------------------------------- Park
/** parked.jsonl -> Map(id -> {at, name, until} | {at, unpark: true}); the newest line per id wins. */
export function parsePark(text) {
  const m = new Map();
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (!o || typeof o.id !== 'string' || !NODE_ID.test(o.id)) continue;
    const at = atOf(o.at);
    if (!Number.isFinite(at)) continue;
    const had = m.get(o.id);
    if (had && had.at > at) continue;
    m.set(o.id, o.unpark === true ? { at, unpark: true } : { at, name: one(o.name, 40), until: typeof o.until === 'string' && DAY_RE.test(o.until) ? o.until : '' });
  }
  return m;
}
export async function readPark(file) {
  try { return parsePark(await fsp.readFile(lp(file), 'utf8')); } catch { return new Map(); }
}
/** body: {id, name?, until?: "YYYY-MM-DD"} parks; {id, unpark: true} brings it back. -> {status, body} */
export async function markPark(file, body, now = Date.now()) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return bad(400, 'expected {id}');
  const extra = Object.keys(body).find((k) => !['id', 'name', 'until', 'unpark'].includes(k));
  if (extra) return bad(400, `unknown key ${one(extra, 20)}`);
  if (typeof body.id !== 'string' || !NODE_ID.test(body.id)) return bad(400, 'which one? (s-<id>)');
  if (body.unpark != null && body.unpark !== true) return bad(400, 'unpark is true or absent');
  if (body.until != null && !(typeof body.until === 'string' && (body.until === '' || DAY_RE.test(body.until)))) return bad(400, 'the date is YYYY-MM-DD');
  if (body.name != null && typeof body.name !== 'string') return bad(400, 'name must be text');
  const at = new Date(now).toISOString();
  const line = body.unpark ? { at, id: body.id, unpark: true } : { at, id: body.id, name: one(body.name, 40), until: body.until || '' };
  await appendJsonl(file, line);
  return { status: 200, body: { ok: true, ...line } };
}

/** The local day key of a time. */
export const dayOfMs = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/** Parked nodes leave the tree until their day, then come back as idle with back: true. -> {nodes, parked} */
export function applyPark(nodes, park, now = Date.now()) {
  const today = dayOfMs(now);
  const parked = [];
  const out = [];
  const onTree = new Set(nodes.map((n) => n.id));
  for (const n of nodes) {
    const p = park.get(n.id);
    if (!p || p.unpark) { out.push(n); continue; }
    if (p.until && p.until <= today) { out.push({ ...n, st: 'idle', back: true }); continue; }
    parked.push({ id: n.id, name: p.name || 'session', until: p.until, at: p.at });
  }
  for (const [id, p] of park) if (!p.unpark && !onTree.has(id) && !(p.until && p.until <= today)) parked.push({ id, name: p.name || 'session', until: p.until, at: p.at });
  return { nodes: out, parked: parked.sort((a, b) => (a.until || '9999').localeCompare(b.until || '9999')) };
}

// ---------------------------------------------------------------- live files
/**
 * One live file -> {session, state, at, sticky, task} or null. task is the session's own short label (written by the
 * user's own status command, never read from a transcript): control characters removed, 48 characters at most.
 */
export function parseLive(text, sessionFromName = '') {
  let o;
  try { o = JSON.parse(String(text || '').replace(/^﻿/, '')); } catch { return null; }
  if (!o || typeof o !== 'object') return null;
  const session = typeof o.session === 'string' && SESSION_ID.test(o.session) ? o.session : sessionFromName;
  if (!session || !SESSION_ID.test(session)) return null;
  if (!LIVE_STATES.includes(o.state)) return null;
  const at = Date.parse(o.at);
  if (!Number.isFinite(at)) return null;
  return { session, state: o.state, at, sticky: o.sticky === true, task: typeof o.task === 'string' ? one(o.task, 48) : '' };
}
const LIVE_NAME = /^([A-Za-z0-9-]{8,80})\.json$/;
export async function readLiveDir(dir) {
  const out = new Map();
  for (const e of await ls(dir)) {
    const m = LIVE_NAME.exec(e.name);
    if (!e.isFile() || !m) continue;
    let text;
    try { text = await fsp.readFile(lp(path.join(dir, e.name)), 'utf8'); } catch { continue; }
    const v = parseLive(text, m[1]);
    if (v) out.set(v.session, v);
  }
  return out;
}
/** Deletes live files older than 14 days (their at, else their write time). -> how many */
export async function pruneLive(dir, now = Date.now()) {
  let n = 0;
  for (const e of await ls(dir)) {
    if (!e.isFile() || !LIVE_NAME.test(e.name)) continue;
    const f = path.join(dir, e.name);
    let at = NaN;
    try { at = Date.parse(JSON.parse(await fsp.readFile(lp(f), 'utf8')).at); } catch { /* use the write time */ }
    if (!Number.isFinite(at)) { const st = await statSafe(f); at = st ? st.mtimeMs : now; }
    if (now - at > 14 * 86400000) { try { await fsp.unlink(lp(f)); n++; } catch { /* in use */ } }
  }
  return n;
}

const EFFORT_SHORT = { low: 'low', medium: 'med', high: 'high', xhigh: 'xhigh', max: 'max' };
export const effortWord = (e) => (e ? EFFORT_SHORT[e] || String(e).slice(0, 8) : '');
