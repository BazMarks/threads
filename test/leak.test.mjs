// Nothing private may reach the page: every answer of the server on the full synthetic home is searched for the
// planted canaries, session ids, tool-use ids, folder paths and settings values.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpDir, startServer, until } from './helpers.mjs';
import { makeHome } from './fixtures.mjs';
import { nodeId } from '../lib/states.mjs';
import { startOfDay } from '../lib/util.mjs';

/**
 * The server reads the real clock, and the fixture writes up to 2 minutes before it. Near local midnight those writes
 * fall on yesterday and today's block is empty, so the test waits until 5 minutes past midnight first (it never waits
 * at any other time of day).
 */
function waitNearMidnight(now) {
  const sod = startOfDay(now), next = startOfDay(sod + 36 * 3600000);
  return now - sod < 5 * 60000 ? sod + 5 * 60000 - now : next - now < 2 * 60000 ? next + 5 * 60000 - now : 0;
}

test('leak: the wait is 0 by day and runs to 00:05 near midnight', () => {
  const sod = startOfDay(Date.now()), MIN = 60000;
  assert.equal(waitNearMidnight(sod + 12 * 60 * MIN), 0);
  assert.equal(waitNearMidnight(sod + MIN), 4 * MIN);
  const next = startOfDay(sod + 36 * 3600000);
  assert.equal(waitNearMidnight(next - MIN), 6 * MIN);
});

test('leak: no canary, id, path or settings value in any answer', async () => {
  const wait = waitNearMidnight(Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  const root = tmpDir();
  const h = makeHome(root, Date.now(), { twin: true, many: 3 });
  const s = await startServer({ ...h, catalogText: JSON.stringify({ items: [{ name: 'resize', line: 'Resizes', match: 'resize.mjs' }] }) });
  const texts = [];
  try {
    await until(async () => (await s.get('/api/tools')).json.usage === 'ready');
    await until(async () => !(await s.get('/api/details')).json.pending);
    for (const p of ['/api/ping', '/api/brain', '/api/details', '/api/tools', '/api/team', '/', '/app.js', '/styles.css']) texts.push([p, (await s.get(p)).text]);
    texts.push(['seen', (await s.post('/api/seen', { id: nodeId(h.ids.A2), name: 'alpha' })).text]);
    texts.push(['park', (await s.post('/api/park', { id: nodeId(h.ids.A4), until: '' })).text]);
    texts.push(['unpark', (await s.post('/api/park', { id: nodeId(h.ids.A4), unpark: true })).text]);
    texts.push(['team', (await s.post('/api/team', { helper: 'reviewer', effort: 'high' })).text]);
    texts.push(['bad', (await s.post('/api/team', { helper: 'nobody', effort: 'high' })).text]);
    texts.push(['brain after', (await s.get('/api/brain')).text]);
  } finally { await s.stop(); }
  texts.push(['output', s.output()]);
  const banned = [
    ...Object.values(h.CANARY), ...Object.values(h.ids), ...h.toolUseIds, ...h.folders,
    root, root.replace(/\\/g, '/'), root.replace(/\//g, '\\'), 'mcpServers', 'CANARY',
  ];
  assert.ok(Object.keys(h.CANARY).length >= 15);
  for (const [where, text] of texts) for (const b of banned) assert.ok(!text.includes(b), `${where} holds a banned string (${b.slice(0, 12)}...)`);
  assert.ok(texts.find(([w]) => w === '/api/brain')[1].includes('tidy the test data'), 'the session label is allowed');
  // the Timeline's `today` block: only hashed ids, project keys, numbers, role / state / model words
  const T = JSON.parse(texts.find(([w]) => w === '/api/brain')[1]).today;
  assert.ok(T.rows.length > 0, 'the today block is searched above');
  const num = (sp) => sp.every((x) => x.length === 2 && x.every(Number.isFinite));
  for (const r of T.rows) {
    assert.deepEqual(Object.keys(r).sort(), ['key', 'lanes']); assert.match(r.key, /^p-/);
    for (const l of r.lanes) {
      assert.deepEqual(Object.keys(l).sort(), ['helpers', 'id', 'spans']); assert.match(l.id, /^s-/); assert.ok(num(l.spans));
      for (const x of l.helpers) { assert.deepEqual(Object.keys(x).sort(), ['model', 'role', 'spans', 'st']); assert.ok(num(x.spans)); }
    }
  }
});
