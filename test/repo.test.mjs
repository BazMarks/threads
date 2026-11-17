// Repo hygiene: the repo's own files, read as text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO } from './helpers.mjs';

const SKIP = new Set(['.git', 'node_modules', 'data', 'config.json', 'tools-catalog.json']);
function files(dir = REPO, rel = '') {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (SKIP.has(e.name) || r === 'test/out') continue;
    if (e.isDirectory()) out.push(...files(path.join(dir, e.name), r));
    else out.push(r);
  }
  return out;
}
const read = (r) => fs.readFileSync(path.join(REPO, r), 'utf8');
const textFiles = () => files().filter((r) => /\.(mjs|js|json|md|css|html|svg|yml)$|^\.gitignore$|LICENSE$/.test(r));

test('repo: no personal paths', () => {
  const sep = '[\\\\/]';
  const drive = new RegExp(`\\b[A-Za-z]:${sep}[A-Za-z]`);
  const users = new RegExp(`${sep}${'Us' + 'ers'}${sep}[A-Za-z]`);
  const home = new RegExp(`/${'ho' + 'me'}/[a-z]`);
  for (const r of textFiles()) {
    const t = read(r);
    for (const re of [drive, users, home]) assert.ok(!re.test(t), `${r} holds a personal-looking path`);
  }
});

test('repo: page is safe', () => {
  const app = read('public/app.js');
  for (const bad of ['inner' + 'HTML', 'outer' + 'HTML', 'insertAdjacent' + 'HTML', 'document.' + 'write', 'ev' + 'al(', 'new ' + 'Function']) assert.ok(!app.includes(bad), bad);
  const html = read('public/index.html');
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), 'an inline script');
  assert.ok(!/\sstyle=/i.test(html), 'a style attribute');
});

test('repo: no dead styles', () => {
  const css = read('public/styles.css');
  const used = read('public/app.js') + read('public/index.html');
  const classes = new Set([...css.matchAll(/\.((?:br|map)-[\w-]+)/g)].map((m) => m[1]));
  const dead = [...classes].filter((c) => !new RegExp(`['"\` .]${c}(?![\\w-])`).test(used));
  assert.deepEqual(dead, []);
});

test('repo: routes agree', () => {
  const app = read('public/app.js');
  const server = read('server.mjs');
  const paths = new Set([...app.matchAll(/['"`](\/api\/[a-z]+)/g)].map((m) => m[1]));
  assert.ok(paths.size >= 5);
  for (const p of paths) assert.ok(server.includes(`'${p}'`), p);
});

test('repo: ignore list and package', () => {
  const ig = read('.gitignore').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const x of ['data/', 'config.json', 'tools-catalog.json', 'node_modules/', '*.log', 'test/out/']) assert.ok(ig.includes(x), x);
  const pkg = JSON.parse(read('package.json'));
  for (const k of ['dependencies', 'devDependencies', 'author', 'repository']) assert.equal(pkg[k], undefined, k);
  assert.equal(pkg.type, 'module');
});

test('repo: docs', () => {
  assert.ok(read('README.md').split(/\r?\n/).length < 120);
  const c = read('CLAUDE.md').trim().split(/\r?\n/);
  assert.equal(c.length, 1);
  assert.ok(c[0].includes('AGENTS.md'));
});

test('repo: no image file but the icon', () => {
  const images = files().filter((r) => /\.(png|jpe?g|gif|webp|ico|bmp)$/i.test(r));
  assert.deepEqual(images, []);
});
