// The Tools tab: what is installed (names and description lines), how often each was used, and the user's own
// tools-catalog.json.
import path from 'node:path';
import fsp from 'node:fs/promises';
import { lp, ls, one, statSafe } from './util.mjs';
import { mergeHints } from './toolusage.mjs';
import { projectLabel } from './brain.mjs';
import * as source from './sources/index.mjs';

const DAY = 86400000;

/** tools-catalog.json's text -> [{name, line, match?}] (bad items dropped; at most 300), or null. */
export function parseCatalog(text) {
  let o;
  try { o = JSON.parse(String(text || '').replace(/^﻿/, '')); } catch { return null; }
  const items = o && Array.isArray(o.items) ? o.items : null;
  if (!items) return null;
  return items.filter((i) => i && typeof i.name === 'string' && one(i.name, 80)).slice(0, 300).map((i) => {
    const m = typeof i.match === 'string' ? i.match.trim().toLowerCase() : '';
    return { name: one(i.name, 80), line: one(i.line, 120), ...(m.length >= 4 && m.length <= 60 && !/[\u0000-\u001f]/.test(m) ? { match: m } : {}) };
  });
}

let dirsCache = { key: '', at: 0, value: [] };
/** The working folders of the projects used in the last 30 days that still exist: [{dir, label}], at most 60. */
export async function projectDirsOf(P, now = Date.now()) {
  if (dirsCache.key === P.projectsDir && now - dirsCache.at < 5 * 60000 && now >= dirsCache.at) return dirsCache.value;
  const found = [];
  for (const d of await ls(P.projectsDir)) {
    if (!d.isDirectory()) continue;
    const dir = path.join(P.projectsDir, d.name);
    let best = null;
    for (const e of await ls(dir)) {
      if (!e.isFile() || !e.name.endsWith('.jsonl')) continue;
      const st = await statSafe(path.join(dir, e.name));
      if (st && now - st.mtimeMs < 30 * DAY && (!best || st.mtimeMs > best.mtimeMs)) best = { file: path.join(dir, e.name), mtimeMs: st.mtimeMs };
    }
    if (!best) continue;
    const head = await source.sessionHead(best.file);
    if (!head.cwd || !(await source.isDir(head.cwd))) continue;
    found.push({ dir: head.cwd, label: projectLabel(head.cwd, d.name), at: best.mtimeMs });
  }
  const seen = new Set();
  const value = found.sort((a, b) => b.at - a.at).filter((x) => !seen.has(x.dir) && seen.add(x.dir)).slice(0, 60).map(({ dir, label }) => ({ dir, label }));
  dirsCache = { key: P.projectsDir, at: now, value };
  return value;
}

/** The Tools payload. usageOf(matches) -> the counts, or null while the first count runs. */
export async function listTools({ P, catalogFile, usageOf = null, now = Date.now() }) {
  const inv = await source.inventory(P, await projectDirsOf(P, now));
  let catalog = [];
  try { catalog = parseCatalog(await fsp.readFile(lp(catalogFile), 'utf8')) || []; } catch { catalog = []; }
  const usage = usageOf ? usageOf(catalog.filter((i) => i.match).map((i) => i.match)) : null;
  const use = (bucket, key) => (usage ? (usage[bucket] && usage[bucket][key]) || { d7: 0, d30: 0, last: 0 } : null);
  const skills = inv.skills.map((s) => ({ name: s.name, where: s.where, short: one(s.description, 70), long: one(s.description, 400), use: use('skills', s.name.toLowerCase()) }));
  const helpers = inv.helpers.map((x) => ({ name: x.name, where: x.where, short: one(x.short, 70), model: x.model, effort: x.effort, use: use('helpers', x.name.toLowerCase()) }));
  const mcp = inv.mcp.map((m) => ({ name: m.name, where: m.where, use: use('mcp', source.mcpKey(m.name)) }));
  if (usage) {
    const known = new Set(mcp.map((m) => source.mcpKey(m.name)));
    for (const k of Object.keys(usage.mcp).sort()) if (!known.has(k)) mcp.push({ name: k, where: 'in use', use: usage.mcp[k] });
  }
  const own = catalog.map((i) => ({ ...i, use: i.match ? use('tools', i.match) : null }));
  const merges = mergeHints(inv.skills.map((s) => ({ name: s.name, where: s.where, description: s.description })));
  return {
    ok: true, usage: usage ? 'ready' : 'pending', skills, helpers, mcp, hooks: inv.hooks, commands: inv.commands, plugins: inv.plugins, statusLine: inv.statusLine,
    own, merges,
    counts: { skills: skills.length, helpers: helpers.length, mcp: mcp.length, hooks: inv.hooks.length, commands: inv.commands.length, plugins: inv.plugins.length, own: own.length },
  };
}
