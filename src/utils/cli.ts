/**
 * Hand-rolled CLI parser for vfx-familiar (D-19).
 *
 * Exhaustive 5-flag set: --http, --port <N>, --db <path>, --help, --version.
 * Supports both space-separated and `=` forms for --port and --db.
 * Unknown flags exit with code 2 and a pointer to --help.
 *
 * Pure module:
 *  - No MCP SDK imports (D-33 — utils layer is pure)
 *  - No environment variables consulted (TRNS-04 — zero env vars)
 *  - All output goes to stderr (D-21 — stdout reserved for JSON-RPC on stdio)
 */

export interface CliArgs {
  http: boolean;
  port?: number;
  db?: string;
  help: boolean;
  version: boolean;
}

export function parseCliFlags(argv: string[]): CliArgs {
  const out: CliArgs = { http: false, help: false, version: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--http') {
      out.http = true;
      continue;
    }
    if (a === '--help' || a === '-h') {
      out.help = true;
      continue;
    }
    if (a === '--version' || a === '-v') {
      out.version = true;
      continue;
    }
    if (a === '--port') {
      const v = argv[++i];
      out.port = requireInt(v, '--port');
      continue;
    }
    if (a.startsWith('--port=')) {
      out.port = requireInt(a.slice(7), '--port');
      continue;
    }
    if (a === '--db') {
      const v = argv[++i];
      if (!v) die(`--db requires a path`);
      out.db = v;
      continue;
    }
    if (a.startsWith('--db=')) {
      out.db = a.slice(5);
      continue;
    }
    die(`Unknown flag: ${a}. See --help.`);
  }
  return out;
}

export function printHelp(): void {
  console.error(`vfx-familiar — MCP server for VFX project hierarchy

Usage:
  vfx-familiar [--http] [--port <N>] [--db <path>] [--help] [--version]

Transports:
  stdio      (default — for Claude Desktop / Claude CLI / Cursor)
  --http     adds Streamable HTTP on port 3000 (or --port N) in the same process

Flags:
  --http              Enable HTTP transport in addition to stdio
  --port <N>          HTTP port (default: 3000)
  --port=N            Same, equals form
  --db <path>         SQLite database path (default: ./vfx-familiar.db)
  --db=<path>         Same, equals form
  --help, -h          Print this help and exit
  --version, -v       Print version and exit

Notes:
  No environment variables are consulted.
  All logs go to stderr; stdout is reserved for MCP JSON-RPC frames on stdio.
  --db accepts any filesystem path the process can write to.`);
}

function requireInt(s: string | undefined, flag: string): number {
  const n = Number(s);
  if (!Number.isInteger(n) || n <= 0) die(`${flag} requires a positive integer`);
  return n;
}

function die(msg: string): never {
  console.error(msg);
  process.exit(2);
}
