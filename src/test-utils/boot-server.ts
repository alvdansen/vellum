import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the server entrypoint the spawn-based tests boot. */
export const SERVER_ENTRY = resolve(__dirname, '../server.ts');

/**
 * server.ts logs this line immediately AFTER it registers its SIGINT/SIGTERM
 * handlers, so observing it on stderr proves a signal will now be handled
 * gracefully instead of hitting Node's default disposition.
 *
 * `stdio-hygiene.test.ts` additionally asserts this exact string appears in
 * stderr, so a rename in server.ts fails loudly there rather than silently
 * disabling the readiness gate for every caller.
 */
export const READY_MARKER = 'vellum: stdio transport connected';

export interface BootServerResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signalName: NodeJS.Signals | null;
  /**
   * True when READY_MARKER was observed before the child went away — i.e. the
   * signal (if any) was readiness-gated rather than racing the boot. Tests that
   * depend on the graceful-shutdown path assert this so a marker-string drift
   * can never silently degrade them back to blind signalling.
   */
  sawMarker: boolean;
}

export interface BootServerOptions {
  /** `--db` value. Caller owns creation/cleanup of this path. */
  dbPath: string;
  env: NodeJS.ProcessEnv;
  /** Signal to send once the child is ready. Default SIGTERM. */
  signal?: NodeJS.Signals;
  /**
   * Leave stdin open. The MCP stdio transport exits on stdin EOF, so tests that
   * need the child alive until the signal arrives must set this.
   */
  keepStdinOpen?: boolean;
  /**
   * How long to wait for READY_MARKER before giving up. On expiry the child is
   * SIGKILLed and the promise REJECTS with a diagnostic — it is never signalled
   * blind.
   *
   * Must stay strictly BELOW the caller's vitest timeout, or vitest's generic
   * "test timed out" wins the race and this diagnostic never surfaces. The
   * default is deliberately under vitest.config.ts's `testTimeout` (10000) so
   * that holds even for a caller that sets no per-test timeout; both current
   * callers additionally use 15s/20s. Worst measured boot is ~5.6s at 8x CPU
   * oversubscription, so 8s still leaves headroom.
   */
  readyTimeoutMs?: number;
  /** Delay between seeing the marker and signalling, to capture trailing logs. */
  graceMs?: number;
  /**
   * How long to wait for the child to actually exit after being signalled.
   * On expiry it is SIGKILLed and the promise rejects, so a hung graceful
   * shutdown surfaces as a diagnostic instead of a bare vitest timeout with the
   * temp DB left behind. Keep below the caller's vitest timeout.
   */
  shutdownTimeoutMs?: number;
}

/**
 * NOTE ON SCOPE: this helper is stdio-only by design. READY_MARKER is printed
 * before server.ts starts its optional `--http` transport, so it would be a
 * FALSE readiness signal for an HTTP caller (the port is not bound yet). Tests
 * that need the HTTP listener must poll the port themselves.
 */

/**
 * Boot `src/server.ts` as a real child process, wait until it reports itself
 * ready, then signal it and capture everything it wrote.
 *
 * WHY READINESS-GATED, NOT A WALL CLOCK — this helper exists because a fixed
 * delay is unfixable by tuning. server.ts only installs its SIGINT/SIGTERM
 * handlers after npx resolution, tsx transpile, better-sqlite3's native load,
 * and `await engine.start()`. Signal before that and Node's default disposition
 * kills the child with 128+SIGTERM = 143, so `exitCode === 0` fails and the db
 * may not exist yet. Measured spawn-to-ready: ~0.6s idle, ~2.2s under normal
 * parallel vitest load, and 5.0-5.6s at 8x CPU oversubscription — any fixed
 * margin is a bet on machine load, which is exactly how this flaked before.
 *
 * The readiness timeout deliberately does NOT fall back to signalling: a slow
 * boot must fail loudly and accurately ("never printed READY_MARKER") rather
 * than produce a mystery 143 or let an assertion pass for the wrong reason.
 * A child that exits on its own first (e.g. config rejection at boot) resolves
 * normally with `sawMarker: false`.
 */
export function bootServer(opts: BootServerOptions): Promise<BootServerResult> {
  const {
    dbPath,
    env,
    signal: killSig = 'SIGTERM',
    keepStdinOpen = false,
    readyTimeoutMs = 8_000,
    graceMs = 150,
    shutdownTimeoutMs = 10_000,
  } = opts;

  return new Promise<BootServerResult>((resolvePromise, rejectPromise) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    // Spawn node DIRECTLY, not via `npx tsx`. `npx` produces a three-process
    // chain (npm exec -> tsx -> node server), and `child` is only the outermost
    // wrapper: SIGTERM reaches the server solely because npm and tsx forward
    // it, and SIGKILL cannot be forwarded at all. So killing `child` on the
    // timeout path would leave the real server orphaned and running, with its
    // inherited stdio pipe write-ends keeping this worker's event loop alive.
    // One process means child.kill hits the process that owns the handlers, and
    // it skips npm-exec's ~300-400ms cold start.
    const child = spawn(process.execPath, ['--import', 'tsx', SERVER_ENTRY, '--db', dbPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    });

    let sawMarker = false;
    let signalled = false;
    let settled = false;
    let graceTimer: NodeJS.Timeout | undefined;
    let shutdownTimer: NodeJS.Timeout | undefined;
    let exitCode: number | null = null;
    let exitSignal: NodeJS.Signals | null = null;

    // Cleared from every settle path. A failed spawn emits 'error' + 'close'
    // but never 'exit', so clearing only there would leave a pending timer
    // holding the vitest worker's event loop open past the rejection.
    const clearTimers = (): void => {
      clearTimeout(readyTimer);
      if (graceTimer !== undefined) clearTimeout(graceTimer);
      if (shutdownTimer !== undefined) clearTimeout(shutdownTimer);
    };

    const readyTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      clearTimers();
      // SIGKILL, not the caller's signal: the whole point is that we do NOT
      // know whether a handler is installed, so don't pretend to ask politely.
      child.kill('SIGKILL');
      // Belt and braces: drop our ends of the pipes so nothing can keep this
      // worker's event loop alive if the child somehow outlives the signal.
      child.stdout.destroy();
      child.stderr.destroy();
      child.stdin.destroy();
      rejectPromise(
        new Error(
          `bootServer: server never printed READY_MARKER ("${READY_MARKER}") within ` +
            `${readyTimeoutMs}ms, and did not exit on its own. Captured stderr:\n` +
            Buffer.concat(stderrChunks).toString('utf8').slice(-2000),
        ),
      );
    }, readyTimeoutMs);
    // Never let our own timer be the reason a worker stays alive.
    readyTimer.unref?.();

    child.stdout.on('data', (c) => stdoutChunks.push(c));
    child.stderr.on('data', (c) => {
      stderrChunks.push(c);
      if (sawMarker) return;
      if (!Buffer.concat(stderrChunks).toString('utf8').includes(READY_MARKER)) return;
      sawMarker = true;
      clearTimeout(readyTimer);
      // Brief grace so a line logged just after the marker still lands in the
      // captured stderr before the process goes away.
      graceTimer = setTimeout(() => {
        if (signalled || settled) return;
        signalled = true;
        child.kill(killSig);
        // Bound the graceful shutdown too. Without this, a hang in server.ts's
        // shutdown() (it awaits engine.stop() before process.exit(0)) would
        // leave the promise pending until the caller's vitest timeout — a bare
        // "Test timed out", with the temp DB never cleaned up.
        shutdownTimer = setTimeout(() => {
          if (settled) return;
          settled = true;
          clearTimers();
          child.kill('SIGKILL');
          rejectPromise(
            new Error(
              `bootServer: server did not exit within ${shutdownTimeoutMs}ms of ${killSig} ` +
                `(READY_MARKER was seen, so the handler was installed — shutdown itself hung). ` +
                `Captured stderr:\n${Buffer.concat(stderrChunks).toString('utf8').slice(-2000)}`,
            ),
          );
        }, shutdownTimeoutMs);
        shutdownTimer.unref?.();
      }, graceMs);
      graceTimer.unref?.();
    });

    if (!keepStdinOpen) {
      child.stdin.end();
    }

    // 'exit' carries the status; 'close' is when the stdio streams are actually
    // drained. Resolving on 'exit' can snapshot stderr BEFORE the child's final
    // writes are delivered — and those last lines are exactly what the
    // graceful-shutdown test asserts on ("SIGTERM received" / "shutting down").
    // 'close' also fires on the failed-spawn path where 'exit' never does.
    child.on('exit', (code, signalName) => {
      exitCode = code;
      exitSignal = signalName;
    });

    child.on('close', () => {
      if (settled) return;
      settled = true;
      clearTimers();
      try {
        if (!child.stdin.destroyed) child.stdin.end();
      } catch {
        /* ignore */
      }
      resolvePromise({
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        exitCode,
        signalName: exitSignal,
        sawMarker,
      });
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimers();
      rejectPromise(err);
    });
  });
}
