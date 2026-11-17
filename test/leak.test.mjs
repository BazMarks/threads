// Nothing private may reach the page: every answer of the server on the full synthetic home is searched for the
// planted canaries, session ids, tool-use ids, folder paths and settings values.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpDir, startServer, until } from './helpers.mjs';
import { makeHome } from './fixtures.mjs';
import { nodeId } from '../lib/states.mjs';

test('leak: no canary, id, path or settings value in any answer', async () => {
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
});
