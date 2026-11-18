// Small helpers shared by every module: paths, local days, safe file writes, text cleaning.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

/** A long-path-safe form on Windows; the path itself elsewhere. */
export function lp(p) {
  if (process.platform !== 'win32' || !p) return p;
  return path.toNamespacedPath(path.resolve(p));
}

/** The local calendar day of a time, as YYYY-MM-DD. */
export function dayKey(ms) {
  const d = new Date(ms);
  const m = d.getMonth() + 1, day = d.getDate();
  return `${d.getFullYear()}-${m < 10 ? '0' : ''}${m}-${day < 10 ? '0' : ''}${day}`;
}

/** Local midnight of a YYYY-MM-DD key, or null. */
function keyToMs(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() : null;
}

/** The day key n calendar days after a key. */
export function addDays(key, n) {
  const ms = keyToMs(key);
  if (ms == null) return null;
  const d = new Date(ms);
  d.setDate(d.getDate() + n);
  return dayKey(d.getTime());
}

/** Local midnight of the day that holds ms. */
export function startOfDay(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** stat that answers null instead of throwing. */
export async function statSafe(p) {
  try { return await fsp.stat(lp(p)); } catch { return null; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RETRY = new Set(['EPERM', 'EACCES', 'EBUSY']);
async function renameRetry(from, to) {
  const t0 = Date.now();
  for (;;) {
    try { await fsp.rename(from, to); return; } catch (e) {
      if (!RETRY.has(e.code) || Date.now() - t0 > 2000) throw e;
      await sleep(50);
    }
  }
}

let seq = 0;
/** Writes a temp file, flushes it, renames it over the target, and reads it back. */
export async function writeFileAtomic(file, text) {
  await fsp.mkdir(lp(path.dirname(file)), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.${++seq}.tmp`;
  const fh = await fsp.open(lp(tmp), 'w');
  try {
    await fh.writeFile(text, 'utf8');
    await fh.sync();
  } finally {
    await fh.close();
  }
  try {
    await renameRetry(lp(tmp), lp(file));
  } catch (e) {
    try { await fsp.unlink(lp(tmp)); } catch { /* already gone */ }
    throw e;
  }
  const back = await fsp.readFile(lp(file), 'utf8');
  if (back !== text) throw new Error('the file did not read back as written');
}

/** Appends one JSON line, making the folder when needed. */
export async function appendJsonl(file, obj) {
  await fsp.mkdir(lp(path.dirname(file)), { recursive: true });
  await fsp.appendFile(lp(file), JSON.stringify(obj) + '\n', 'utf8');
}

/** One line of plain text: control characters become spaces, runs of spaces collapse, cut to n characters. */
export function one(v, n) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
}

/** A JSON file's value, or null when it is missing or does not parse. */
export function readJson(file) {
  try { return JSON.parse(fs.readFileSync(lp(file), 'utf8').replace(/^﻿/, '')); } catch { return null; }
}

/** A folder's entries (dirents), or [] when it cannot be read. */
export async function ls(dir) {
  try { return await fsp.readdir(lp(dir), { withFileTypes: true }); } catch { return []; }
}

export const sha256hex = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

/** [{key, label}] -> Map(key -> label); a label used by two keys gets " (2)", " (3)" on the later keys (by key order). */
export function uniqueLabels(pairs) {
  const byLabel = new Map();
  for (const { key, label } of pairs) {
    const keys = byLabel.get(label) || byLabel.set(label, new Set()).get(label);
    keys.add(key);
  }
  const out = new Map();
  for (const [label, keys] of byLabel) [...keys].sort().forEach((k, i) => out.set(k, i ? `${label} (${i + 1})` : label));
  return out;
}
