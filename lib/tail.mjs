// Reads only the new whole lines of append-only files. One offset per file; a file that got shorter starts over.
import fsp from 'node:fs/promises';
import { lp, statSafe } from './util.mjs';

const CHUNK = 4 * 1024 * 1024;

/**
 * -> { read(file, st, onLine, onReset?) -> Promise<{ reset }>, forget(file), size }
 * read does nothing when the size and write time are unchanged. A half-written last line waits for the next read.
 * Calls on one file run one after another. Never throws.
 */
export function createTail() {
  const files = new Map(); // file -> { offset, size, mtimeMs }
  const busy = new Map(); // file -> the read in progress

  async function readOnce(file, st, onLine, onReset) {
    const s = st || (await statSafe(file));
    if (!s) return { reset: false };
    let S = files.get(file);
    if (!S) { S = { offset: 0, size: -1, mtimeMs: -1 }; files.set(file, S); }
    if (s.size === S.size && s.mtimeMs === S.mtimeMs) return { reset: false };
    let reset = false;
    if (s.size < S.offset) {
      S.offset = 0;
      reset = true;
      try { if (onReset) onReset(); } catch { /* the caller's own problem */ }
    }
    let fh;
    try { fh = await fsp.open(lp(file), 'r'); } catch { return { reset }; }
    try {
      let pos = S.offset;
      let carry = Buffer.alloc(0);
      while (pos < s.size) {
        const len = Math.min(CHUNK, s.size - pos);
        const buf = Buffer.alloc(len);
        const { bytesRead } = await fh.read(buf, 0, len, pos);
        if (!bytesRead) break;
        pos += bytesRead;
        const data = carry.length ? Buffer.concat([carry, buf.subarray(0, bytesRead)]) : buf.subarray(0, bytesRead);
        let start = 0;
        for (let nl = data.indexOf(10, start); nl >= 0; nl = data.indexOf(10, start)) {
          let line = data.toString('utf8', start, nl);
          if (line.endsWith('\r')) line = line.slice(0, -1);
          try { onLine(line); } catch { /* one bad line never stops the read */ }
          start = nl + 1;
        }
        S.offset += start;
        carry = data.subarray(start);
      }
      S.size = s.size;
      S.mtimeMs = s.mtimeMs;
    } catch { /* keep what was read */ } finally {
      await fh.close().catch(() => {});
    }
    return { reset };
  }

  return {
    read(file, st, onLine, onReset) {
      const prev = busy.get(file) || Promise.resolve();
      const p = prev.then(() => readOnce(file, st, onLine, onReset)).catch(() => ({ reset: false }));
      busy.set(file, p);
      p.finally(() => { if (busy.get(file) === p) busy.delete(file); });
      return p;
    },
    forget(file) { files.delete(file); },
    get size() { return files.size; },
  };
}
