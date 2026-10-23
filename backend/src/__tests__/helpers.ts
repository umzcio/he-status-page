import type { Express } from 'express';
import type { AddressInfo } from 'node:net';

// Start an Express app on an ephemeral loopback port and return its base URL
// plus a close() for afterEach. Lets route tests use plain fetch() without a
// supertest dependency.
export async function listen(app: Express): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}
