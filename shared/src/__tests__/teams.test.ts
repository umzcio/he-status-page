import { describe, it, expect, vi, beforeEach } from 'vitest';

// Replace the guarded client so delivery outcomes can be scripted; the guard
// itself is covered in guardedHttp.test.ts.
const post = vi.fn();
const createGuardedHttpClient = vi.fn((_opts?: unknown) => ({ post }));
vi.mock('../urlGuard', () => ({ createGuardedHttpClient: (opts: unknown) => createGuardedHttpClient(opts) }));

describe('sendTeamsWebhook', () => {
  beforeEach(() => {
    vi.resetModules();
    post.mockReset();
    createGuardedHttpClient.mockClear();
  });

  it('uses a strict client: public addresses only, no redirects', async () => {
    await import('../teams');
    expect(createGuardedHttpClient).toHaveBeenCalledWith(
      expect.objectContaining({ allowPrivate: false, maxRedirects: 0 })
    );
  });

  it('reports only the status code of a failed delivery', async () => {
    post.mockRejectedValue({ response: { status: 401, data: { secret: 'internal-token-value' } } });
    const { sendTeamsWebhook } = await import('../teams');
    const result = await sendTeamsWebhook('https://hooks.example.com/x', {});
    expect(result.success).toBe(false);
    expect(result.error).toBe('HTTP 401');
  });

  it('refuses non-https URLs without sending', async () => {
    const { sendTeamsWebhook } = await import('../teams');
    const result = await sendTeamsWebhook('http://hooks.example.com/x', {});
    expect(result.success).toBe(false);
    expect(post).not.toHaveBeenCalled();
  });
});
