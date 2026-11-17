// Pictures of the five tabs on the synthetic home, for a person to look at. Not part of npm test.
//   node test/shot.mjs   -> test/out/<tab>.png
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpDir, startServer, until, REPO } from './helpers.mjs';
import { makeHome } from './fixtures.mjs';
import { nodeId } from '../lib/states.mjs';

function findBrowser() {
  const env = process.env.THREADS_BROWSER;
  if (env && fs.existsSync(env)) return env;
  const list = [];
  if (process.platform === 'win32') {
    for (const k of ['ProgramFiles', 'ProgramFiles(x86)', 'LOCALAPPDATA']) {
      const base = process.env[k];
      if (!base) continue;
      list.push(path.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'), path.join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    }
  } else if (process.platform === 'darwin') {
    list.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
  } else {
    for (const name of ['google-chrome', 'chromium', 'chromium-browser', 'microsoft-edge']) {
      for (const dir of String(process.env.PATH || '').split(path.delimiter)) if (dir) list.push(path.join(dir, name));
    }
  }
  return list.find((p) => fs.existsSync(p)) || null;
}

const browser = findBrowser();
if (!browser) { console.log('no browser found; skipped'); process.exit(0); }
const out = path.join(REPO, 'test', 'out');
fs.mkdirSync(out, { recursive: true });
const root = tmpDir();
const h = makeHome(root, Date.now(), { twin: true });
// one done line, so the strip shows a count
fs.writeFileSync(path.join(h.dataDir, 'seen.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), id: nodeId('aaaaaaaa-0000-4000-8000-999999999999'), name: 'beta · earlier' })}\n`);
const catalog = JSON.stringify({ items: [{ name: 'resize-images', line: 'Batch-resizes a folder of images', match: 'resize-images.mjs' }, { name: 'deploy', line: 'Builds and uploads the site' }] });
const s = await startServer({ ...h, catalogText: catalog });
try {
  await until(async () => (await s.get('/api/tools')).json.usage === 'ready');
  await until(async () => !(await s.get('/api/details')).json.pending);
  for (const tab of ['brain', 'details', 'tools', 'team']) {
    const file = path.join(out, `${tab}.png`);
    const profile = tmpDir();
    const r = spawnSync(browser, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--user-data-dir=${profile}`, '--window-size=1440,900', '--virtual-time-budget=5000',
      `--screenshot=${file}`, `http://127.0.0.1:${s.port}/#${tab}`], { stdio: 'ignore', timeout: 60000 });
    console.log(`${tab}: ${fs.existsSync(file) ? path.relative(REPO, file) : `failed (${r.status})`}`);
  }
} finally { await s.stop(); }
