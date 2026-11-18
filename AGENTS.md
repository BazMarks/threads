# Working in this repo

Threads is a local, zero-dependency dashboard of a user's Claude Code sessions, built from the files Claude Code keeps
on their machine. It listens on 127.0.0.1 only and sends nothing anywhere.

- Run: `node server.mjs`
- Test: `npm test`
- Try it without real data: `node test/fixtures.mjs <dir>` writes a made-up home and prints the server command.

## Helping a user set it up

1. Check `node --version` (20 or newer).
2. Start the server (`node server.mjs --open`) and open the address it prints.
3. Offer the status hooks (`hooks/README.md`). Ask before editing their `settings.json`, and keep the hooks they have.

## Where things are

- `lib/`: the modules behind each tab (brain, details, tools, team; `timeline.mjs` is the Brain's Timeline layout), the
  state rules, caches and helpers.
- `lib/sources/`: everything that knows Claude Code's folders and line format; `index.mjs` picks the source.
- `hooks/`: `status.mjs`, run by Claude Code's hooks or by hand, and its README.
- `public/`: the page (`index.html`, `app.js`, `styles.css`, `favicon.svg`).
- `test/`: the synthetic home (`fixtures.mjs`), unit, server, leak and repo tests, and `shot.mjs` for pictures.

## Rules

- Never commit `data/`, `config.json` or `tools-catalog.json`.
- Never read, print, log or paste transcript text. Work on the fixture home, not a real one.
- A payload holds only: numbers, times, state words, model family words, effort words, tool / skill / helper / MCP
  server / hook event / plugin / command names, script file names, the `description:` line of a SKILL.md or helper
  file's frontmatter, the `name` and `line` of the user's own `tools-catalog.json`, project labels (the last segment
  of a session's working folder), a session's own task label (set by the user with `hooks/status.mjs --task`,
  control characters removed, 48 characters at most), and the hashed ids `s-…` and `p-…`.
  Never: a prompt, a reply, a command, a path, a result, a title, a session id, a tool-use id, the dashed project
  folder name, a full working folder, any value under an MCP server entry, any other settings value.
- A new payload field needs a line in `test/leak.test.mjs` (and a canary in `test/fixtures.mjs` when it reads a new place).
- No dependencies. Node 20+, ES modules.
- No personal paths or names in code, tests or docs.
- Windows, macOS and Linux: build paths with `node:path`; split a foreign path on both separators.
- The page builds DOM with `textContent` only; no inline script or style.
- A state is always sign + word + colour: `●` running cyan, `!` awaiting you red, `⧗` waiting grey-blue,
  `…` idle yellow, `✓` done green.

## Adding a source

Write a module with the exports of `lib/sources/claude.mjs` and switch to it in `lib/sources/index.mjs`.

## Adding a feature or another app's data

To show another app's data in Threads (a plan graph, a task board), or to use Threads' data inside it, read the
sessions and agents with the same calls the server makes; no server, page or key is needed:

```js
import * as source from './lib/sources/index.mjs';
import { collect, buildBrain } from './lib/brain.mjs';
import { createUsageCache, loadPrices } from './lib/usage.mjs';
import { readTeam } from './lib/team.mjs';

const P = source.locate({});                    // Claude Code's folders (~/.claude by default)
const team = await readTeam(P.agentsDir);
const c = await collect({ P, cache: createUsageCache(), prices: loadPrices(), team });
const B = await buildBrain(c.sess, { dataDir: './data', total: c.total, team });
// B.projects: each project and its state. B.nodes: each session with its state (run, await, wait, idle, done),
// model, effort, tokens, dollars, minutes and its helpers (role, state, model, effort, tokens).
// B.today: today's busy stretches per project and session (and per helper), as [from, to] times.
```

- A new tab: add a route to `GET_ROUTES` in `server.mjs`; in `public/app.js` add its `VIEWS`, `data`, `ENDPOINT` and
  `RENDER` entries and a `render…` function. The page fetches `/api/<name>` with its key, like the other tabs.
- The other app's own data stays in that app's files or database; read it in the new route. Keep the payload rules
  above for anything that comes from Claude Code.
