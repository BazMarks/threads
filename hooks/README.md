# Status hooks

Three Claude Code hooks keep each session's state exact and make "awaiting you" work. Each one runs
`hooks/status.mjs`, which writes one small file per session under `data/live/`.

| Hook | Runs | Writes |
|---|---|---|
| `UserPromptSubmit` | `status.mjs --hook running` | running |
| `Stop` | `status.mjs --hook idle` | idle (unless the session set awaiting or waiting itself) |
| `Notification` | `status.mjs --hook awaiting` | awaiting you, for a permission prompt or a question only |

Only the session id (and, for a notification, its type) is kept. The prompt is never read.

## Install

1. Print the block with this folder's path filled in:

   ```sh
   node hooks/status.mjs --print-install
   ```

2. Merge its `hooks` entries into your user settings, keeping any hooks you already have:
   - macOS and Linux: `~/.claude/settings.json`
   - Windows: `%USERPROFILE%\.claude\settings.json`

3. Restart your Claude Code sessions.

## Check

Send a prompt in any session: its node turns running within 20 seconds. Let a tool ask for permission: the node turns
red, awaiting you. The line "Status hooks are not installed" leaves the Brain tab once the first file is written.

## By hand

Inside a session (the session id comes from `CLAUDE_SESSION_ID`, else this folder's newest transcript):

```sh
node hooks/status.mjs --state waiting          # waiting on something outside the session
node hooks/status.mjs --state awaiting         # needs you; stays until the next prompt
node hooks/status.mjs --state running
node hooks/status.mjs --task "fix the login"   # a short label for the node (48 characters at most)
```

`--session <id>`, `--claude <dir>` and `--data <dir>` pick another session or folder (`THREADS_DATA` works too).

## Remove

Delete the three entries from your settings file. The files in `data/live/` can be deleted; older ones are removed
after 14 days.
