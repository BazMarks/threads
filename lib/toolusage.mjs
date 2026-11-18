// How often each skill, helper, MCP server and catalog tool was called in the last 30 days. Counts and dates only;
// a call's input is compared with the catalog's match strings, never kept.
import fs from 'node:fs';
import readline from 'node:readline';
import { lp, statSafe } from './util.mjs';
import * as source from './sources/index.mjs';

const DAY = 86400000;
const cache = new Map(); // file -> {mtimeMs, size, key, ev}

async function fileEvents(file, matches) {
  const ev = [];
  const rl = readline.createInterface({ input: fs.createReadStream(lp(file)), crlfDelay: Infinity });
  for await (const line of rl) for (const e of source.eventsOfLine(line, matches)) ev.push(e);
  return ev;
}

/** -> {skills, helpers, mcp, tools}, each {key: {d7, d30, last}}. */
export async function countUsage(projectsDir, matches = [], now = Date.now()) {
  const ms = [...new Set(matches.map((m) => String(m || '').toLowerCase().trim()).filter((m) => m.length >= 4))];
  const key = ms.join('\n');
  const out = { skills: {}, helpers: {}, mcp: {}, tools: {} };
  const bucketOf = { skill: out.skills, helper: out.helpers, mcp: out.mcp, tool: out.tools };
  const since = now - 30 * DAY;
  const seen = new Set();
  for await (const f of source.walkTranscripts(projectsDir)) {
    const st = await statSafe(f.file);
    if (!st || st.mtimeMs < since) continue;
    seen.add(f.file);
    let c = cache.get(f.file);
    if (!c || c.mtimeMs !== st.mtimeMs || c.size !== st.size || c.key !== key) {
      let ev = [];
      try { ev = await fileEvents(f.file, ms); } catch { ev = []; }
      c = { mtimeMs: st.mtimeMs, size: st.size, key, ev };
      cache.set(f.file, c);
    }
    for (const [kind, k, t] of c.ev) {
      if (!t || t < since || t > now) continue;
      const bucket = bucketOf[kind];
      const b = bucket[k] || (bucket[k] = { d7: 0, d30: 0, last: 0 });
      b.d30++;
      if (t >= now - 7 * DAY) b.d7++;
      if (t > b.last) b.last = t;
    }
  }
  for (const f of [...cache.keys()]) if (!seen.has(f)) cache.delete(f);
  return out;
}

/** Keeps the last count and refreshes it every ttl ms (or when the match list changes); null until the first read ends. */
export function createUsageReader(projectsDir, ttl = 5 * 60000) {
  let value = null, at = 0, running = null, lastKey = null;
  return function read(matches = []) {
    const key = [...matches].sort().join('\n');
    if (!running && (Date.now() - at > ttl || key !== lastKey)) {
      lastKey = key;
      running = countUsage(projectsDir, matches).then((v) => { value = v; }, () => {}).finally(() => { at = Date.now(); running = null; });
    }
    return value;
  };
}

// ---------------------------------------------------------------- merge hints
const words = (s) => new Set(String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 3));
/** Jaccard overlap of two descriptions' words (0..1). */
function overlap(a, b) {
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  return n / (A.size + B.size - n);
}
const base = (name) => String(name || '').toLowerCase().replace(/^[a-z0-9_-]+:/, '').trim();
/** The same skill name in two places, or two skills whose descriptions overlap strongly. -> [{names: [a, b], why}] */
export function mergeHints(skills, threshold = 0.5) {
  const out = [];
  const by = new Map();
  for (const s of skills) (by.get(base(s.name)) || by.set(base(s.name), []).get(base(s.name))).push(s);
  for (const [n, list] of by) {
    const places = [...new Set(list.map((s) => s.where))];
    if (places.length > 1) out.push({ names: [n, n], why: `in ${places.join(' and ')}` });
  }
  const uniq = [...by.values()].map((l) => l[0]);
  for (let i = 0; i < uniq.length; i++) for (let j = i + 1; j < uniq.length; j++) {
    const o = overlap(uniq[i].description, uniq[j].description);
    if (o >= threshold) out.push({ names: [base(uniq[i].name), base(uniq[j].name)], why: `descriptions ${Math.round(o * 100)}% alike` });
  }
  return out.slice(0, 60);
}
