// The tool tag and the open background jobs of one transcript, names only:
//   tool  = the newest tool call of the session's own turns: {k: 'tool'|'skill'|'helper'|'mcp', name}
//   skill = the newest skill it called ('' when none)
//   bg    = background jobs launched in the last BG_MAX_MS whose notification has not come yet
// A notification can land in the next session of the same folder, so the folder's notifications count too; the cap
// keeps an orphan job from reading as running for ever.
import path from 'node:path';
import { ls, statSafe } from './util.mjs';
import { createTail } from './tail.mjs';
import * as source from './sources/index.mjs';

export const BG_MAX_MS = 3 * 3600000;
const tail = createTail();
const states = new Map(); // file -> state

export const fresh = (side = false) => ({ side, tool: null, skill: '', launch: new Map(), closed: new Set() });

async function stateOf(file, st, side = false) {
  const s = st || (await statSafe(file));
  if (!s) return null;
  let S = states.get(file);
  if (!S) { S = fresh(side); states.set(file, S); }
  await tail.read(file, s, (line) => source.feedLine(S, line), () => { const n = fresh(side); Object.assign(S, n); });
  if (states.size > 400) { const k = states.keys().next().value; states.delete(k); tail.forget(k); }
  return S;
}

/** One transcript -> {tool, skill, bg}. closed: more tool-use ids known to be over. side: a helper's own file. */
export async function sessionTools(file, st = null, now = Date.now(), { closed = null, side = false } = {}) {
  const S = await stateOf(file, st, side);
  if (!S) return { tool: null, skill: '', bg: 0 };
  let bg = 0;
  for (const [id, t] of S.launch) if (!S.closed.has(id) && !(closed && closed.has(id)) && t && now - t < BG_MAX_MS) bg++;
  return { tool: S.tool ? { k: S.tool.k, name: S.tool.name } : null, skill: S.skill, bg };
}

/** The tool-use ids closed by a notification in any transcript of a folder written in the last BG_MAX_MS. */
export async function folderClosed(dir, now = Date.now()) {
  const out = new Set();
  for (const e of await ls(dir)) {
    if (!e.isFile() || !e.name.endsWith('.jsonl')) continue;
    const f = path.join(dir, e.name);
    const st = await statSafe(f);
    if (!st || now - st.mtimeMs > BG_MAX_MS) continue;
    const S = await stateOf(f, st);
    if (S) for (const id of S.closed) out.add(id);
  }
  return out;
}

