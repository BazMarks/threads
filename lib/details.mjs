// The Details tab: tokens and list dollars per day, per project and per session, numbers only.
import { dayKey, addDays, uniqueLabels, statSafe } from './util.mjs';
import { dedupe, familyOf, usdOf, FAMILIES } from './usage.mjs';
import { nodeId, projectKey } from './states.mjs';
import { projectLabel } from './brain.mjs';
import * as source from './sources/index.mjs';

export const TOKEN_DAYS = 14;
const DAY = 86400000;
const labelCache = new Map(); // folder -> {file, mtimeMs, label}

const zero = () => ({ n: 0, tok: 0, usd: 0 });
const famRow = () => Object.fromEntries([...FAMILIES, 'other'].map((k) => [k, zero()]));
const round = (x) => ({ n: x.n, tok: x.tok, usd: Math.round(x.usd * 1e4) / 1e4 });
const fams = (row) => Object.fromEntries(Object.entries(row).filter(([, v]) => v.n).map(([k, v]) => [k, round(v)]));
const mainOf = (row) => { const e = Object.entries(row).filter(([, v]) => v.n).sort((a, b) => b[1].tok - a[1].tok)[0]; return e ? e[0] : null; };
const sumTok = (row) => Object.values(row).reduce((a, v) => a + v.tok, 0);

export async function loadDetails({ P, cache, prices = null, now = Date.now(), days = TOKEN_DAYS }) {
  const today = dayKey(now);
  const dayList = [];
  for (let i = days - 1; i >= 0; i--) dayList.push(addDays(today, -i));
  const inDays = new Set(dayList);
  const week = new Set(dayList.slice(-7));
  const sinceMs = now - (days + 1) * DAY;
  const resp = new Map();
  const newest = new Map(); // folder -> {file, mtimeMs} of its newest main transcript
  let files = 0;
  for await (const f of source.walkTranscripts(P.projectsDir)) {
    const st = await statSafe(f.file);
    if (!st || !st.isFile() || st.mtimeMs < sinceMs) continue;
    files++;
    if (!f.helper) { const n = newest.get(f.folder); if (!n || n.mtimeMs < st.mtimeMs) newest.set(f.folder, { file: f.file, mtimeMs: st.mtimeMs }); }
    const rows = await cache.rows(f.file, st);
    // one response once: its earliest copy owns it, with the largest of each counter
    for (const [id, r] of dedupe(rows)) {
      const p = resp.get(id);
      const helper = r.side || f.helper;
      if (!p) { resp.set(id, { ...r, folder: f.folder, session: f.session, helper }); continue; }
      p.i = Math.max(p.i, r.i); p.o = Math.max(p.o, r.o); p.cw = Math.max(p.cw, r.cw); p.cr = Math.max(p.cr, r.cr); p.cw1h = Math.max(p.cw1h, r.cw1h);
      if (r.t < p.t) { p.t = r.t; p.folder = f.folder; p.session = f.session; p.helper = helper; }
    }
  }
  // project labels from each folder's newest main transcript
  const pairs = [];
  for (const [folder, n] of newest) {
    let c = labelCache.get(folder);
    if (!c || c.file !== n.file) {
      const head = await source.sessionHead(n.file);
      c = { file: n.file, label: projectLabel(head.cwd, folder) };
      labelCache.set(folder, c);
    }
    pairs.push({ key: projectKey(folder), label: c.label });
  }
  const labels = uniqueLabels(pairs);
  const labelOf = (folder) => labels.get(projectKey(folder)) || projectLabel('', folder);

  const add = (a, r, usd) => { a.n++; a.tok += r.i + r.o + r.cw + r.cr; a.usd += usd; };
  const byDay = new Map(dayList.map((d) => [d, famRow()]));
  const byProject = new Map();
  const sessions = new Map();
  const recent = now - 48 * 3600000;
  for (const r of resp.values()) {
    const d = dayKey(r.t);
    if (!inDays.has(d)) continue;
    const fam = familyOf(r.model);
    const usd = prices ? usdOf(r, prices) : 0;
    add(byDay.get(d)[fam], r, usd);
    const key = projectKey(r.folder);
    if (week.has(d)) {
      let p = byProject.get(key);
      if (!p) byProject.set(key, p = { key, label: labelOf(r.folder), models: famRow(), lead: zero(), helper: zero() });
      add(p.models[fam], r, usd);
      add(r.helper ? p.helper : p.lead, r, usd);
    }
    const sk = `${r.folder}\n${r.session}`;
    let s = sessions.get(sk);
    if (!s) sessions.set(sk, s = { id: nodeId(r.session), project: labelOf(r.folder), first: r.t, last: r.t, peak: 0, ...zero(), helperN: 0, models: famRow() });
    s.first = Math.min(s.first, r.t); s.last = Math.max(s.last, r.t);
    if (!r.helper) s.peak = Math.max(s.peak, r.i + r.cr + r.cw);
    add(s, r, usd); add(s.models[fam], r, usd);
    if (r.helper) s.helperN++;
  }
  return {
    ok: true, pending: false, today,
    days: dayList.map((d) => ({ day: d, models: fams(byDay.get(d)) })),
    projects: [...byProject.values()].map((p) => ({ key: p.key, label: p.label, models: fams(p.models), lead: round(p.lead), helper: round(p.helper), tok: sumTok(p.models) }))
      .sort((a, b) => b.tok - a.tok).slice(0, 12).map(({ tok, ...p }) => p),
    sessions: [...sessions.values()].filter((s) => s.last >= recent).sort((a, b) => b.last - a.last).slice(0, 14)
      .map((s) => ({ id: s.id, project: s.project, first: s.first, last: s.last, peak: s.peak, n: s.n, tok: s.tok, usd: Math.round(s.usd * 1e4) / 1e4, helperN: s.helperN, model: mainOf(s.models) })),
    files, responses: resp.size,
  };
}

/** Keeps the last Details and refreshes it in the background when older than ttl. */
export function createDetailsReader({ P, cache, prices = null, ttl = 60000 }) {
  let value = null, at = 0, running = null;
  const refresh = () => {
    if (!running) {
      running = loadDetails({ P, cache, prices, now: Date.now() })
        .then((v) => { value = v; }, () => { /* keep the last answer */ })
        .finally(() => { at = Date.now(); running = null; });
    }
    return running;
  };
  return {
    current() { if (Date.now() - at > ttl) refresh(); return value; },
    refresh,
  };
}

/** Today's totals, and a usual day: the median of the earlier days that have tokens (null under 3 such days). */
export function spendOf(details) {
  if (!details || !details.days) return null;
  const tot = (d) => Object.values(d.models).reduce((a, v) => ({ tokens: a.tokens + (v.tok || 0), usd: a.usd + (v.usd || 0) }), { tokens: 0, usd: 0 });
  const todayRow = details.days.find((d) => d.day === details.today);
  const t = todayRow ? tot(todayRow) : { tokens: 0, usd: 0 };
  const earlier = details.days.filter((d) => d.day < details.today).map(tot).filter((x) => x.tokens > 0);
  let usual = null;
  if (earlier.length >= 3) {
    const med = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
    usual = { tokens: Math.round(med(earlier.map((x) => x.tokens))), usd: Math.round(med(earlier.map((x) => x.usd)) * 1e4) / 1e4 };
  }
  return { tokens: t.tokens, usd: Math.round(t.usd * 1e4) / 1e4, usual };
}
