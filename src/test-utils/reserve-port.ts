// src/test-utils/reserve-port.ts — get a port that is actually free.
//
// Several wire-level test files spawn a real server on a TCP port. They each
// picked one with `30000 + Math.floor(Math.random() * 30000)`: no check that
// anything was listening there, and no retry if the bind failed. Vitest runs
// those files in PARALLEL, so two workers can draw the same number, and either
// can draw a port something else on the machine already holds. The server then
// exits with EADDRINUSE and the test fails as a timeout — which reads like a
// slow machine rather than a collision, and is why it was written off as
// contention twice.
//
// Binding port 0 makes the OS choose, from the ephemeral range it knows is
// free, and it will not hand the same port to two simultaneous binds. There is
// still a window between closing this socket and the server binding it, but it
// is microseconds against a random draw with no check at all.

import { createServer } from 'node:net';

/** Reserve a free TCP port on 127.0.0.1 and release it for the caller to bind. */
export function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (addr === null || typeof addr === 'string') {
        srv.close(() => reject(new Error('could not determine the reserved port')));
        return;
      }
      const { port } = addr;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}
