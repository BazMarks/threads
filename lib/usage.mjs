// Token counts per response, read from transcripts as numbers only, with model families and list prices.
import fs from 'node:fs';
import { createTail } from './tail.mjs';
import * as source from './sources/index.mjs';

export const FAMILIES = ['fable', 'opus', 'sonnet', 'haiku'];
export const familyOf = (model) => FAMILIES.find((f) => String(model || '').toLowerCase().includes(f)) || 'other';

/** lib/prices.json, or null when it cannot be read. */
export function loadPrices() {
  try { return JSON.parse(fs.readFileSync(new URL('./prices.json', import.meta.url), 'utf8')); } catch { return null; }
}

/** List dollars of one response {model, i, o, cw, cr, cw1h}; 0 when its family has no price. */
export function usdOf(r, prices) {
  const p = prices && prices.models ? prices.models[familyOf(r.model)] : null;
  if (!p) return 0;
  const cw1h = r.cw1h || 0;
  return (r.i * p.in + r.o * p.out + (r.cw - cw1h) * p.in * (prices.cache_write_x || 1.25)
    + cw1h * p.in * (prices.cache_write_1h_x || 2) + r.cr * p.cache_read) / 1e6;
}

/** Rows per file, read once and then only their new lines; the least recently used files drop past max. */
export function createUsageCache(max = 4000) {
  const tail = createTail();
  const rowsOf = new Map(); // file -> Row[]
  return {
    async rows(file, st) {
      let rs = rowsOf.get(file);
      if (!rs) rs = [];
      rowsOf.delete(file);
      rowsOf.set(file, rs);
      await tail.read(file, st, (line) => { const r = source.usageOfLine(line, file); if (r) rs.push(r); }, () => { rs.length = 0; });
      while (rowsOf.size > max) { const k = rowsOf.keys().next().value; rowsOf.delete(k); tail.forget(k); }
      return rs;
    },
    get size() { return rowsOf.size; },
  };
}

/** One response once, at the largest of each counter over its copies and its earliest time. */
export function dedupe(rows, into = new Map(), own = false) {
  for (const r of rows) {
    const [id, t, model, i, o, cw, cr, side, effort, cw1h] = r;
    const p = into.get(id);
    if (p) {
      p.i = Math.max(p.i, i); p.o = Math.max(p.o, o); p.cw = Math.max(p.cw, cw); p.cr = Math.max(p.cr, cr); p.cw1h = Math.max(p.cw1h, cw1h || 0);
      if (t < p.t) p.t = t;
      if (!p.effort && effort) p.effort = effort;
      if (own && !side) p.own = true;
    } else {
      into.set(id, { t, model, i, o, cw, cr, cw1h: cw1h || 0, side: !!side, own: own && !side, effort: effort || '' });
    }
  }
  return into;
}

/** The family with the most output tokens, or null. */
export function mainFamily(rs) {
  const out = new Map();
  for (const r of rs) out.set(familyOf(r.model), (out.get(familyOf(r.model)) || 0) + r.o + 1e-9);
  let best = null, n = -1;
  for (const [f, v] of out) if (v > n) { best = f; n = v; }
  return best;
}

const BURST_GAP_MS = 5 * 60000;
/** Times -> [[first, last], ...]; a new stretch starts after a gap longer than gap. */
export function burstsOf(times, gap = BURST_GAP_MS) {
  const ts = [...times].filter(Number.isFinite).sort((a, b) => a - b);
  const out = [];
  for (const t of ts) { if (out.length && t - out.at(-1)[1] <= gap) out.at(-1)[1] = t; else out.push([t, t]); }
  return out;
}
