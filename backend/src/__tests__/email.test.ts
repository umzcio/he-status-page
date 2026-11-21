import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import net from 'net';
import type { AddressInfo } from 'net';

// A minimal SMTP server that never offers STARTTLS (what an on-path attacker
// stripping it looks like) and records every command it receives.
async function fakeSmtp(): Promise<{ port: number; commands: string[]; close: () => Promise<void> }> {
  const commands: string[] = [];
  const sockets = new Set<net.Socket>();
  const server = net.createServer((sock) => {
    sockets.add(sock);
    sock.on('close', () => sockets.delete(sock));
    sock.write('220 fake ESMTP\r\n');
    let buf = '';
    let inData = false;
    sock.on('data', (chunk) => {
      buf += chunk.toString();
      let idx;
      while ((idx = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        if (inData) {
          if (line === '.') {
            inData = false;
            sock.write('250 queued\r\n');
          }
          continue;
        }
        commands.push(line);
        const verb = line.split(' ')[0].toUpperCase();
        if (verb === 'EHLO') sock.write('250-fake\r\n250-AUTH PLAIN LOGIN\r\n250 SIZE 1000000\r\n');
        else if (verb === 'STARTTLS') sock.write('454 TLS not available\r\n');
        else if (verb === 'AUTH') sock.write('235 ok\r\n');
        else if (verb === 'DATA') {
          inData = true;
          sock.write('354 go\r\n');
        } else if (verb === 'QUIT') {
          sock.write('221 bye\r\n');
          sock.end();
        } else sock.write('250 ok\r\n');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  return {
    port: (server.address() as AddressInfo).port,
    commands,
    close: () =>
      new Promise((resolve) => {
        sockets.forEach((s) => s.destroy());
        server.close(() => resolve());
      }),
  };
}

describe('sendEmail', () => {
  const ORIGINAL_ENV = process.env;
  let smtp: Awaited<ReturnType<typeof fakeSmtp>>;

  beforeEach(async () => {
    vi.resetModules();
    smtp = await fakeSmtp();
    process.env = {
      ...ORIGINAL_ENV,
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: String(smtp.port),
      SMTP_USER: 'relay-user',
      SMTP_PASS: 'relay-secret',
      EMAIL_FROM: 'status@example.edu',
    };
  });

  afterEach(async () => {
    await smtp.close();
    process.env = ORIGINAL_ENV;
  });

  it('refuses to continue when the server does not offer STARTTLS', async () => {
    const { sendEmail } = await import('../lib/email');
    await expect(sendEmail({ to: 'someone@example.edu', subject: 's', html: 'h' })).rejects.toThrow();
    const verbs = smtp.commands.map((c) => c.split(' ')[0].toUpperCase());
    expect(verbs).not.toContain('AUTH');
    expect(verbs).not.toContain('DATA');
  });

  it('sends in cleartext only when the operator opts out', async () => {
    process.env.SMTP_REQUIRE_TLS = 'false';
    const { sendEmail } = await import('../lib/email');
    await sendEmail({ to: 'someone@example.edu', subject: 's', html: 'h' });
    // The envelope recipient is exactly the validated address, alone.
    expect(smtp.commands.filter((c) => /^RCPT TO/i.test(c))).toEqual(['RCPT TO:<someone@example.edu>']);
  });

  it.each(['a@example.edu, b@evil.com', 'Victim <victim@example.edu>', '"x y"@example.edu', 'a b@example.edu'])(
    'never hands %j to the mailer',
    async (to) => {
      process.env.SMTP_REQUIRE_TLS = 'false';
      const { sendEmail } = await import('../lib/email');
      await expect(sendEmail({ to, subject: 's', html: 'h' })).rejects.toThrow(/plain email address/);
      expect(smtp.commands).toEqual([]);
    }
  );
});
