// The Brain tab: every session written lately, with its helpers, numbers, tool tag and state. collect() keeps
// server-side records (with session ids, never sent); buildBrain() turns them into the payload (hashed ids only).
import path from 'node:path';
import { startOfDay, one, uniqueLabels } from './util.mjs';
import { dedupe, usdOf, mainFamily, burstsOf } from './usage.mjs';
import { sessionTools, folderClosed } from './sesstools.mjs';
import { todayTimeline } from './timeline.mjs';
import {
  RUN_MS, LIVE_SHOW_MS, nodeId, projectKey, weekStart, sessionState, sessionShown, countStates,
  readSeen, readPark, applyPark, readLiveDir, effortWord,
} from './states.mjs';
import * as source from './sources/index.mjs';

const tok = (r) => r.i + r.o + r.cw + r.cr;
const sumUsd = (rs, prices) => (prices ? Math.round(rs.reduce((s, r) => s + usdOf(r, prices), 0) * 1e4) / 1e4 : null);
const newestEffort = (rs) => { for (let k = rs.length - 1; k >= 0; k--) if (rs[k].effort) return rs[k].effort; return ''; };

/** The label rule: the last segment of the working folder; else the end of the folder name; else the folder name. */
export function projectLabel(cwd, folder) {
  let label = source.labelOfCwd(cwd);
  if (!label) label = one(String(folder).split('-').filter(Boolean).pop() || '', 40);
  return label || one(folder, 40);
}

/** -> {sess: Sess[], total} */
export async function collect({ P, cache, prices = null, team = [], now = Date.now() }) {
  const teamEffort = new Map(team.map((t) => [t.name, t.effort]));
  const { sessions, total } = await source.listSessions(P, Math.min(now - LIVE_SHOW_MS, startOfDay(now)));
  const sess = [];
  for (const s of sessions) {
    const helpers = await source.listHelpers(s.subDir);
    const resp = dedupe(await cache.rows(s.file, s.st), new Map(), true);
    const helperRows = [];
    for (const h of helpers) {
      const rows = await cache.rows(h.file, h.st);
      helperRows.push(rows);
      dedupe(rows, resp, false);
    }
    const all = [...resp.values()];
    const own = all.filter((r) => r.own).sort((a, b) => a.t - b.t);
    if (!own.length) continue;
    const last = Math.max(s.st.mtimeMs, ...helpers.map((h) => h.st.mtimeMs));
    const times = all.map((r) => r.t);
    const spans = burstsOf(times);
    const busyMin = Math.max(1, Math.round(spans.reduce((a, [x, y]) => a + (y - x), 0) / 60000));
    const runs = [];
    for (let k = 0; k < helpers.length; k++) {
      const h = helpers[k];
      const meta = await source.helperMeta(h.file);
      const rs = [...dedupe(helperRows[k]).values()].sort((a, b) => a.t - b.t);
      const T = await sessionTools(h.file, h.st, now, { side: true });
      const ts = rs.map((r) => r.t);
      runs.push({
        who: meta.who, finished: meta.finished, toolUseId: meta.toolUseId, tool: T.tool, skill: T.skill,
        start: ts.length ? ts[0] : null, end: ts.length ? ts[ts.length - 1] : null, spans: burstsOf(ts),
        tok: rs.reduce((a, r) => a + tok(r), 0), usd: sumUsd(rs, prices), model: mainFamily(rs),
        effort: teamEffort.get(meta.who) || newestEffort(rs), mtimeMs: h.st.mtimeMs,
      });
    }
    const closed = await folderClosed(path.join(P.projectsDir, s.folder), now);
    for (const r of runs) if (r.finished && r.toolUseId) closed.add(r.toolUseId);
    const T = await sessionTools(s.file, s.st, now, { closed });
    const head = await source.sessionHead(s.file);
    sess.push({
      session: s.session, folder: s.folder, project: { key: projectKey(s.folder), label: projectLabel(head.cwd, s.folder) }, entry: head.entry,
      turns: own.length, tokens: all.reduce((a, r) => a + tok(r), 0), own: own.reduce((a, r) => a + tok(r), 0),
      usd: sumUsd(all, prices), ownUsd: sumUsd(own, prices), model: mainFamily(own), effort: newestEffort(own),
      idleSec: Math.max(0, Math.round((now - last) / 1000)), ownAt: s.st.mtimeMs, last, first: Math.min(...times), spans, busyMin,
      bg: T.bg, tool: T.tool, skill: T.skill, runs,
    });
  }
  return { sess, total };
}

/** The labels of the projects in a list of Sess, with " (2)" for a second folder that has the same label. */
const labelsOf = (sess) => uniqueLabels(sess.map((s) => s.project));

const RANK = { await: 0, run: 1, wait: 2, idle: 3 };
const PER_PROJECT = 8, HELPERS_MAX = 24, DONE_MAX = 80;

/** Sess[] -> Brain (the /api/brain payload). */
export async function buildBrain(sess, { dataDir, total = 0, team = [], spend = null, pricesAsOf = '', now = Date.now() } = {}) {
  const seen = await readSeen(path.join(dataDir, 'seen.jsonl'));
  const park = await readPark(path.join(dataDir, 'parked.jsonl'));
  const lives = await readLiveDir(path.join(dataDir, 'live'));
  const ws = weekStart(now);
  const labels = labelsOf(sess);
  const nodes = [];
  const done = new Map();
  const lanes = new Map();
  const addDone = (id, name, at) => { if (at >= ws && (!done.has(id) || done.get(id).at < at)) done.set(id, { id, name, at }); };
  for (const S of sess) {
    const lf = lives.get(S.session) || null;
    if (!sessionShown({ file: lf, idleSec: S.idleSec, now })) continue;
    const id = nodeId(S.session);
    const sa = seen.has(id) ? seen.get(id).at : null;
    const lastAt = lf && lf.at ? lf.at : S.last;
    const args = { file: lf, idleSec: S.idleSec, ownAt: S.ownAt, lastAt, seenAt: sa, bg: S.bg };
    const st = sessionState(args);
    if (st === 'done') { addDone(id, (seen.get(id) || {}).name || 'session', sa); continue; }
    const waitJob = st === 'run' && S.bg > 0 && sessionState({ ...args, bg: 0 }) !== 'run';
    const hs = S.runs.map((r) => ({
      role: r.who, st: !r.finished && now - r.mtimeMs < RUN_MS ? 'run' : 'done', model: r.model, effort: effortWord(r.effort),
      tokens: r.tok, usd: r.usd, min: r.start != null && r.end != null ? Math.max(1, Math.round((r.end - r.start) / 60000)) : null,
      ...(r.tool ? { tool: r.tool } : {}), ...(r.skill ? { skill: r.skill } : {}), at: r.mtimeMs, spans: r.spans,
    })).sort((a, b) => (a.st === b.st ? b.at - a.at : a.st === 'run' ? -1 : 1));
    lanes.set(id, { spans: S.spans, helpers: hs.slice(0, HELPERS_MAX).map((h) => ({ role: h.role, st: h.st, model: h.model, spans: h.spans })) });
    nodes.push({
      id, kind: 'session', parent: S.project.key, project: labels.get(S.project.key) || S.project.label, st,
      entry: S.entry, started: S.first, at: lastAt, model: S.model, effort: effortWord(S.effort),
      tokens: S.tokens, usd: S.usd, own: S.own, ownUsd: S.ownUsd, min: S.busyMin, plus: hs.filter((h) => h.st === 'run').length,
      helpers: hs.slice(0, HELPERS_MAX).map(({ at, spans, ...h }) => h), helperMore: Math.max(0, hs.length - HELPERS_MAX),
      ...(lf && lf.task ? { task: lf.task } : {}),
      ...(S.tool ? { tool: S.tool } : {}), ...(S.skill ? { skill: S.skill } : {}), ...(S.bg ? { bg: S.bg } : {}),
      ...(waitJob ? { waitJob: true } : {}), ...(lf ? {} : { noHooks: true }),
    });
  }
  for (const [id, x] of seen) if (!done.has(id) && x.at >= ws) addDone(id, x.name || 'session', x.at);
  const doneList = [...done.values()].sort((a, b) => b.at - a.at);
  const P = applyPark(nodes, park, now);
  // at most PER_PROJECT nodes per project: the most urgent first, then the newest
  const byProject = new Map();
  for (const n of P.nodes) (byProject.get(n.parent) || byProject.set(n.parent, []).get(n.parent)).push(n);
  const shown = [];
  const projects = [];
  for (const [key, list] of byProject) {
    list.sort((a, b) => RANK[a.st] - RANK[b.st] || b.at - a.at);
    const keep = list.slice(0, PER_PROJECT);
    shown.push(...keep);
    const st = keep.reduce((best, n) => (RANK[n.st] < RANK[best] ? n.st : best), 'idle');
    projects.push({ key, label: keep[0].project, st, n: keep.length, more: list.length - keep.length });
  }
  projects.sort((a, b) => RANK[a.st] - RANK[b.st] || a.label.localeCompare(b.label));
  const counts = countStates(shown, doneList.length);
  const running = shown.filter((n) => n.st === 'run').length;
  return {
    ok: true, now, source: source.LABEL, empty: total === 0, hooks: lives.size > 0,
    you: { st: shown.some((n) => n.st === 'await') ? 'await' : running ? 'run' : 'idle', sessions: shown.length, running },
    projects, nodes: shown, parked: P.parked, done: doneList.slice(0, DONE_MAX), counts, weekStart: ws, spend,
    team: team.map((t) => ({ name: t.name, model: t.model, effort: effortWord(t.effort) })), pricesAsOf,
    today: todayTimeline({ nodes: shown, projects, lanes, now }),
  };
}
