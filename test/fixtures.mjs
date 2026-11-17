// A synthetic Claude Code home for the tests and the screenshots. Everything here is made up; nothing is copied.
//   node test/fixtures.mjs <dir>   writes the home and prints the matching server command
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MIN = 60000, HOUR = 3600000, DAY = 86400000;
export const folderOf = (p) => String(p || '').replace(/[\\/]+$/, '').replace(/[^A-Za-z0-9]/g, '-');
export const sid = (n) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOTE = ['task', 'notification'].join('-');

// ---------------------------------------------------------------- line builders
let uuidN = 0;
const uuid = () => `00000000-0000-4000-9000-${String(++uuidN).padStart(12, '0')}`;
const iso = (t) => new Date(t).toISOString();
const base = (c, t) => ({ cwd: c.cwd, sessionId: c.session, timestamp: iso(t), entrypoint: c.entry, isSidechain: !!c.side, uuid: uuid(), version: '2.0.0' });

export function userLine(c, t, text) {
  return { type: 'user', message: { role: 'user', content: text }, ...base(c, t) };
}
export function assistantLine(c, t, { model = 'claude-opus-4-1', content = [], id = null, effort = '', usage = null } = {}) {
  const u = usage || { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 1000, cache_read_input_tokens: 5000,
    cache_creation: { ephemeral_5m_input_tokens: 600, ephemeral_1h_input_tokens: 400 } };
  return { type: 'assistant', message: { id: id || `msg_${crypto.randomBytes(8).toString('hex')}`, model, role: 'assistant', content, usage: u },
    requestId: `req_${crypto.randomBytes(6).toString('hex')}`, ...(effort ? { effort } : {}), ...base(c, t) };
}
export const toolUse = (name, input, id) => ({ type: 'tool_use', id, name, input });
export function toolResult(c, t, id, text) {
  return { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] }, ...base(c, t) };
}
export function notification(c, t, id, status = 'completed') {
  return { type: 'queue-operation', operation: 'enqueue', sessionId: c.session, timestamp: iso(t),
    content: `<${NOTE}>\n<task-id>bg1</task-id>\n<tool-use-id>${id}</tool-use-id>\n<status>${status}</status>\n<summary>done</summary>\n</${NOTE}>` };
}

function writeLines(file, lines, mtime) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');
  const s = new Date(mtime);
  fs.utimesSync(file, s, s);
}
function writeText(file, text, mtime = null) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
  if (mtime) { const s = new Date(mtime); fs.utimesSync(file, s, s); }
}

/**
 * Writes the home under root. -> {claudeDir, dataDir, workDir, ids, CANARY, toolUseIds, folders, responses}
 * ids: {A1..A6, B1..B5, T1?, G1..}; CANARY: {where: string}; responses: unique response ids in the last 15 days.
 */
export function makeHome(root, now = Date.now(), { empty = false, twin = false, many = 0 } = {}) {
  const claudeDir = path.join(root, 'home', '.claude');
  const dataDir = path.join(root, 'data');
  const workDir = path.join(root, 'work');
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  const out = { claudeDir, dataDir, workDir, ids: {}, CANARY: {}, toolUseIds: [], folders: [], responses: 0 };
  if (empty) return out;
  const hex = () => crypto.randomBytes(3).toString('hex');
  const C = (where) => (out.CANARY[where] = `CANARY_${where.toUpperCase()}_${hex()}`);
  const respIds = new Set();
  const projects = path.join(claudeDir, 'projects');
  const proj = (name) => {
    const cwd = path.join(workDir, ...name.split('/'));
    fs.mkdirSync(cwd, { recursive: true });
    const folder = folderOf(cwd);
    if (!out.folders.includes(folder)) out.folders.push(folder);
    return { cwd, dir: path.join(projects, folder) };
  };
  let n = 0;
  const session = (key, p, entry = 'cli') => { const s = sid(++n); out.ids[key] = s; return { session: s, cwd: p.cwd, entry, file: path.join(p.dir, `${s}.jsonl`), sub: path.join(p.dir, s, 'subagents') }; };
  const tid = (k) => { const id = `toolu_${k}${crypto.randomBytes(6).toString('hex')}`; out.toolUseIds.push(id); return id; };
  const track = (lines, mtime) => { if (now - mtime < 15 * DAY) for (const l of lines) if (l.type === 'assistant') respIds.add(l.message.id); return lines; };

  const alpha = proj('alpha');
  const beta = proj('beta');

  // A1: interactive, opus, three turns; Agent (reviewer), Skill, Bash; its helper still writing
  {
    const c = session('A1', alpha);
    const t0 = now - 20 * MIN;
    const agentId = tid('A1agent');
    const lines = [
      userLine(c, t0, `please look at this ${C('prompt')}`),
      { type: 'ai-title', aiTitle: `Title ${C('aititle')}`, sessionId: c.session },
      assistantLine(c, t0 + MIN, { effort: 'medium', content: [{ type: 'thinking', thinking: `thinking ${C('thinking')}` }, { type: 'text', text: `reply ${C('reply')}` },
        toolUse('Agent', { subagent_type: 'reviewer', description: 'check', prompt: 'look again' }, agentId)] }),
      toolResult(c, t0 + 2 * MIN, agentId, `review finished ${C('result')}`),
      assistantLine(c, t0 + 3 * MIN, { effort: 'medium', content: [toolUse('Skill', { skill: 'demo-skill' }, tid('A1skill'))] }),
      toolResult(c, t0 + 4 * MIN, out.toolUseIds.at(-1), 'Launching skill'),
      assistantLine(c, now - 2 * MIN, { effort: 'medium', content: [toolUse('Read', { file_path: path.join(root, `notes-${C('path')}.txt`) }, tid('A1read')),
        toolUse('Bash', { command: `echo ${C('command')}`, description: 'run' }, tid('A1bash'))] }),
      { type: 'last-prompt', lastPrompt: `again ${C('lastprompt')}`, sessionId: c.session },
      { type: 'session-owner', accountUuid: C('owner'), sessionId: c.session },
    ];
    writeLines(c.file, track(lines, now - 2 * MIN), now - 2 * MIN);
    const hc = { ...c, side: true };
    const hfile = path.join(c.sub, 'agent-a1b2c3d4e5f60718.jsonl');
    writeLines(hfile, track([
      userLine(hc, t0 + MIN, 'look again'),
      assistantLine(hc, now - 3 * MIN, { model: 'claude-sonnet-4-5', effort: 'high', content: [toolUse('Grep', { pattern: 'x' }, tid('A1hgrep'))] }),
      assistantLine(hc, now - MIN, { model: 'claude-sonnet-4-5', effort: 'high', content: [{ type: 'text', text: 'ok' }] }),
    ], now - MIN), now - MIN);
    writeText(hfile.replace(/\.jsonl$/, '.meta.json'), JSON.stringify({ agentType: 'reviewer', description: `review ${C('meta')}`, toolUseId: agentId, finished: false, model: 'sonnet', effort: 'high' }));
  }
  // A2: headless, sonnet, two turns, quiet for 25 minutes
  {
    const c = session('A2', alpha, 'sdk-cli');
    writeLines(c.file, track([
      userLine(c, now - 40 * MIN, 'go'),
      assistantLine(c, now - 39 * MIN, { model: 'claude-sonnet-4-5', content: [{ type: 'text', text: 'one' }] }),
      assistantLine(c, now - 25 * MIN, { model: 'claude-sonnet-4-5', content: [{ type: 'text', text: 'two' }] }),
    ], now - 25 * MIN), now - 25 * MIN);
  }
  // A3: a background job still out; A4: the same job, closed by its notification
  for (const key of ['A3', 'A4']) {
    const c = session(key, alpha);
    const bgId = tid(`${key}bg`);
    const lines = [
      userLine(c, now - 30 * MIN, 'start it'),
      assistantLine(c, now - 29 * MIN, { content: [toolUse('Bash', { command: 'sleep 999', run_in_background: true }, bgId)] }),
      toolResult(c, now - 28 * MIN, bgId, 'Command running in background with ID: bg1'),
      assistantLine(c, now - 16 * MIN, { content: [{ type: 'text', text: 'waiting' }] }),
    ];
    if (key === 'A4') lines.push(notification(c, now - 15 * MIN, bgId, 'completed'));
    else lines.push(userLine(c, now - 15 * MIN, 'ok'));
    writeLines(c.file, track(lines, now - 15 * MIN), now - 15 * MIN);
    if (key === 'A3') out.copyId = lines[3].message.id;
  }
  // a copy of one A3 response inside A4 (as a resumed session would hold it): counted once in Details
  {
    const c4 = { session: out.ids.A4, cwd: alpha.cwd, entry: 'cli' };
    const f = path.join(alpha.dir, `${out.ids.A4}.jsonl`);
    const st = fs.statSync(f);
    fs.appendFileSync(f, JSON.stringify(assistantLine(c4, now - 16 * MIN, { id: out.copyId, content: [{ type: 'text', text: 'copy' }] })) + '\n');
    fs.utimesSync(f, st.mtime, st.mtime);
  }
  // A5: a user line only; A6: quiet for three hours
  {
    const c = session('A5', alpha);
    writeLines(c.file, [userLine(c, now - 5 * MIN, 'hello')], now - 5 * MIN);
    const c6 = session('A6', alpha);
    writeLines(c6.file, track([userLine(c6, now - 3 * HOUR - MIN, 'x'), assistantLine(c6, now - 3 * HOUR, { content: [{ type: 'text', text: 'y' }] })], now - 3 * HOUR), now - 3 * HOUR);
  }
  // B1-B4: sessions with live files
  const live = (s, state, at, extra = {}) => writeText(path.join(dataDir, 'live', `${s}.json`), JSON.stringify({ session: s, state, at: iso(at), ...extra }));
  const simple = (key, lastMin, model = 'claude-opus-4-1') => {
    const c = session(key, beta);
    const last = now - lastMin * MIN;
    writeLines(c.file, track([userLine(c, last - 2 * MIN, 'q'), assistantLine(c, last, { model, content: [{ type: 'text', text: 'a' }] })], last), last);
    return c;
  };
  live(simple('B1', 5).session, 'awaiting', now - 4 * MIN);
  live(simple('B2', 2).session, 'awaiting', now - 10 * MIN);
  live(simple('B3', 300, 'claude-fable-5').session, 'idle', now - 300 * MIN);
  live(simple('B4', 20).session, 'waiting', now - 20 * MIN, { sticky: true, task: 'tidy the test data' });
  // B5: twenty days old; a skill and an MCP call (counted by the tool usage only)
  {
    const c = session('B5', beta);
    const t = now - 20 * DAY;
    writeLines(c.file, [userLine(c, t - MIN, 'old'), assistantLine(c, t, { content: [toolUse('Skill', { skill: 'demo-skill' }, tid('B5skill')), toolUse('mcp__fixture_mcp__ping', {}, tid('B5mcp'))] })], t);
  }
  if (twin) {
    const p = proj('nested/alpha');
    const c = session('T1', p);
    const last = now - 30 * MIN;
    writeLines(c.file, track([userLine(c, last - MIN, 'q'), assistantLine(c, last, { content: [{ type: 'text', text: 'a' }] })], last), last);
  }
  if (many > 0) {
    const p = proj('gamma');
    for (let k = 0; k < many; k++) {
      const c = session(`G${k + 1}`, p);
      const last = now - (30 + k) * MIN;
      writeLines(c.file, track([userLine(c, last - MIN, 'q'), assistantLine(c, last, { model: 'claude-haiku-4-5', content: [{ type: 'text', text: 'a' }] })], last), last);
    }
  }

  // helpers, skills, commands, plugins, settings
  const fm = (lines, body, nl = '\n') => ['---', ...lines, '---', '', body, ''].join(nl);
  const agents = path.join(claudeDir, 'agents');
  writeText(path.join(agents, 'reviewer.md'), fm(['name: reviewer', 'description: Reviews a change and reports problems', 'model: sonnet', 'effort: medium'], `Body ${C('agentbody')}`, '\r\n'));
  writeText(path.join(agents, 'planner.md'), fm(['name: planner', 'description: Writes the plan before a build', 'model: claude-opus-9-9'], 'Plans.'));
  writeText(path.join(agents, 'bad.md'), 'No frontmatter here.\n');
  writeText(path.join(agents, 'notes.txt'), 'not a helper\n');
  const skill = (dir, name, desc) => writeText(path.join(dir, name, 'SKILL.md'), fm([`name: ${name}`, `description: ${desc}`], `Steps ${C(`skill${name.replace(/[^a-z]/g, '')}`)}`));
  skill(path.join(claudeDir, 'skills'), 'demo-skill', 'Builds demo charts from local sample data files');
  skill(path.join(claudeDir, 'skills'), 'unused-skill', 'Builds demo charts from local sample data folders');
  skill(path.join(alpha.cwd, '.claude', 'skills'), 'proj-skill', 'A project skill for alpha');
  skill(path.join(claudeDir, 'plugins', 'cache', 'mk', 'plug-a', '1.0.0', 'skills'), 'plug-skill', 'A skill from an enabled plugin');
  skill(path.join(claudeDir, 'plugins', 'marketplaces', 'mk', 'plugins', 'plug-b', 'skills'), 'not-enabled', 'A skill from a plugin that is off');
  skill(path.join(claudeDir, 'plugins', '.trash', 'x', 'skills'), 'gone', 'A removed skill');
  writeText(path.join(claudeDir, 'commands', 'ship.md'), 'Ship it.\n');
  writeText(path.join(claudeDir, 'settings.json'), JSON.stringify({
    hooks: { Stop: [{ matcher: '', hooks: [{ type: 'command', command: `node "${path.join(root, 'scripts', 'stop.mjs')}" --flag ${C('hook')}` }] }] },
    enabledPlugins: { 'plug-a@mk': true, 'plug-b@mk': false },
    statusLine: { type: 'command', command: `node "${path.join(root, 'scripts', 'statusline.mjs')}"` },
    env: { SECRET_VALUE: C('settingsenv') },
  }, null, 2));
  writeText(path.join(root, 'home', '.claude.json'), JSON.stringify({
    mcpServers: { 'fixture-mcp': { command: 'node', args: [C('mcpargs')], env: { TOKEN: C('mcpenv') }, url: `http://127.0.0.1:9/${C('mcpurl')}` } },
    projects: { [alpha.cwd]: { mcpServers: { 'proj-mcp': { command: 'node', args: ['x'] } } } },
    otherKey: C('userjson'),
  }, null, 2));
  writeText(path.join(alpha.cwd, '.mcp.json'), JSON.stringify({ mcpServers: { 'dot-mcp': { command: 'node', args: ['y'] } } }));
  out.responses = respIds.size;
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const dir = process.argv[2];
  if (!dir) { console.error('usage: node test/fixtures.mjs <dir>'); process.exit(2); }
  const h = makeHome(path.resolve(dir), Date.now(), { twin: true });
  const server = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server.mjs');
  console.log(`node "${path.relative(process.cwd(), server) || 'server.mjs'}" --claude "${h.claudeDir}" --data "${h.dataDir}"`);
}
