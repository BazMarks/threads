// The Team tab: one row per helper file in the agents folder. A change rewrites only that file's model: and effort:
// lines and appends one line {at, helper, from, to} to team-changes.jsonl in the data folder.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { lp, appendJsonl, writeFileAtomic, one, ls } from './util.mjs';

const MODELS_BASE = ['fable', 'opus', 'sonnet', 'haiku'];
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const HELPER = /^[A-Za-z0-9][A-Za-z0-9_-]{0,59}$/;
const MODEL_WORD = /^[A-Za-z0-9][A-Za-z0-9._[\]-]{0,59}$/;

const head = async (f, n = 8192) => {
  try {
    const fh = await fsp.open(lp(f), 'r');
    try { const buf = Buffer.alloc(n); const { bytesRead } = await fh.read(buf, 0, n, 0); return buf.toString('utf8', 0, bytesRead); } finally { await fh.close(); }
  } catch { return null; }
};
export { head as readHead };

/** The block between the first two "---" lines -> {key: value} (single-line values, outer quotes dropped). */
export function frontmatter(text) {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(String(text || ''));
  const out = {};
  if (!m) return out;
  for (const line of m[1].split(/\r?\n/)) {
    const k = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (k && !(k[1] in out)) out[k[1]] = k[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

/** "claude-opus-4" or "opus" -> "opus"; another word stays as written (cut to 20). */
export const famWord = (m) => { const s = String(m || '').toLowerCase(); return MODELS_BASE.find((f) => s.includes(f)) || one(s, 20); };

/** Every helper file: [{name, description, model, modelRaw, effort}], by name. */
export async function readTeam(agentsDir) {
  const out = [];
  for (const e of await ls(agentsDir)) {
    if (!e.isFile() || !e.name.endsWith('.md')) continue;
    const name = e.name.slice(0, -3);
    if (!HELPER.test(name)) continue;
    const fm = frontmatter(await head(path.join(agentsDir, e.name)));
    out.push({ name, description: one(fm.description, 220), model: famWord(fm.model), modelRaw: one(fm.model, 60), effort: one(fm.effort, 12).toLowerCase() });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** The model words the page offers: the four families, plus each model id a helper file names. */
export function modelsFor(helpers) {
  const out = [...MODELS_BASE];
  for (const x of helpers || []) {
    const raw = String(x.modelRaw || '');
    if (!raw || MODELS_BASE.includes(raw.toLowerCase()) || !MODEL_WORD.test(raw) || out.includes(raw)) continue;
    out.push(raw);
  }
  return out;
}

/**
 * Rewrites the given keys' lines of a frontmatter; every other byte and the line endings stay. A missing key gets a
 * line before the closing "---". -> the new text, or null when there is no frontmatter.
 */
export function setFrontmatter(text, set) {
  const m = /^(﻿?---)(\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$))/.exec(text);
  if (!m) return null;
  const nl = m[2];
  const lines = m[3].split(/\r?\n/);
  for (const [k, v] of Object.entries(set)) {
    const i = lines.findIndex((l) => new RegExp(`^${k}:`).test(l));
    if (i >= 0) lines[i] = `${k}: ${v}`; else lines.push(`${k}: ${v}`);
  }
  return m[1] + nl + lines.join(nl) + m[4] + text.slice(m[0].length);
}

/** body: {helper, model?, effort?}. -> {status, body} */
export async function setTeam(body, { agentsDir, logFile, now = Date.now(), dryRun = false } = {}) {
  const bad = (status, error) => ({ status, body: { ok: false, error } });
  if (!body || typeof body !== 'object' || Array.isArray(body)) return bad(400, 'expected {helper, model, effort}');
  const extra = Object.keys(body).find((k) => !['helper', 'model', 'effort'].includes(k));
  if (extra) return bad(400, `unknown key ${one(extra, 20)}`);
  if (typeof body.helper !== 'string' || !HELPER.test(body.helper)) return bad(400, 'which helper? (its file name, no path)');
  if (body.model == null && body.effort == null) return bad(400, 'nothing to change');
  if (body.model != null) {
    const models = modelsFor(await readTeam(agentsDir));
    if (typeof body.model !== 'string' || !models.includes(body.model)) return bad(400, `the model is one of: ${models.join(', ')}`);
  }
  if (body.effort != null && !EFFORTS.includes(body.effort)) return bad(400, `the effort is one of: ${EFFORTS.join(', ')}`);
  const file = path.join(agentsDir, `${body.helper}.md`);
  let st = null;
  try { st = await fsp.lstat(lp(file)); } catch { st = null; }
  if (!st || !st.isFile()) return bad(404, `no helper named ${body.helper}`);
  let text;
  try { text = await fsp.readFile(lp(file), 'utf8'); } catch { return bad(404, `no helper named ${body.helper}`); }
  const fm = frontmatter(text);
  const from = { model: famWord(fm.model), effort: one(fm.effort, 12).toLowerCase() };
  const set = {};
  if (body.model != null) set.model = body.model;
  if (body.effort != null) set.effort = body.effort;
  const next = setFrontmatter(text, set);
  if (next == null) return bad(409, `${body.helper}.md has no frontmatter`);
  const to = { model: set.model ? famWord(set.model) : from.model, effort: set.effort || from.effort };
  if (dryRun) return { status: 200, body: { ok: true, dryRun: true, helper: body.helper, from, to } };
  if (next !== text) await writeFileAtomic(file, next);
  const line = { at: new Date(now).toISOString(), helper: body.helper, from, to };
  await appendJsonl(logFile, line);
  return { status: 200, body: { ok: true, helper: body.helper, from, to, at: line.at } };
}

/** team-changes.jsonl -> the newest change per helper: {helper: {at, from, to}}. */
export async function lastChanges(logFile) {
  const out = {};
  let text = '';
  try { text = await fsp.readFile(lp(logFile), 'utf8'); } catch { return out; }
  for (const l of text.split(/\r?\n/)) {
    let o;
    try { o = JSON.parse(l); } catch { continue; }
    if (!o || !HELPER.test(o.helper || '') || !o.from || !o.to) continue;
    out[o.helper] = { at: Date.parse(o.at) || 0, from: { model: one(o.from.model, 20), effort: one(o.from.effort, 12) }, to: { model: one(o.to.model, 20), effort: one(o.to.effort, 12) } };
  }
  return out;
}
