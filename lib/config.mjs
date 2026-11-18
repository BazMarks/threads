// Command-line flags.

const FLAGS_WITH_VALUE = { '--port': 'port', '--claude': 'claudeDir', '--data': 'dataDir', '--catalog': 'catalogFile' };
const SWITCHES = { '--open': 'open', '--read-only': 'readOnly', '--help': 'help', '-h': 'help', '--version': 'version' };

export const USAGE = `usage: node server.mjs [options]
  --port <n>        listen on this port only (default: the first free one of 4848-4858)
  --open            open the page in your browser
  --claude <dir>    Claude Code's folder (default: CLAUDE_CONFIG_DIR, else ~/.claude)
  --data <dir>      where Got it, Park and the live files are kept (default: ./data)
  --catalog <file>  your own tools list (default: ./tools-catalog.json)
  --read-only       write nothing
  --help, --version`;

export function parseArgs(argv) {
  const out = { port: null, open: false, claudeDir: null, dataDir: null, catalogFile: null, readOnly: false, help: false, version: false, error: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a in SWITCHES) { out[SWITCHES[a]] = true; continue; }
    if (a in FLAGS_WITH_VALUE) {
      const v = argv[i + 1];
      if (v == null || v.startsWith('--')) { out.error = `${a} needs a value`; break; }
      i++;
      if (a === '--port') {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 1 || n > 65535) { out.error = 'the port is a number from 1 to 65535'; break; }
        out.port = n;
      } else out[FLAGS_WITH_VALUE[a]] = v;
      continue;
    }
    out.error = `unknown option ${String(a).slice(0, 40)}`;
    break;
  }
  return out;
}

