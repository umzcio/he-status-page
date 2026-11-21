import { describe, it, expect, vi, beforeEach } from 'vitest';

// Replace the guarded client so delivery outcomes can be scripted; the guard
// itself is covered in guardedHttp.test.ts.
const post = vi.fn();
const createGuardedHttpClient = vi.fn((_opts?: unknown) => ({ post }));
vi.mock('../urlGuard', () => ({
  createGuardedHttpClient: (opts: unknown) => createGuardedHttpClient(opts),
  isSsrfBlocked: (e: any) => e?.code === 'ERR_SSRF_BLOCKED',
}));

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

  it('records a policy refusal as fixed text, without the resolved address', async () => {
    post.mockRejectedValue(
      Object.assign(new Error('Endpoint blocked by SSRF guard: private address 10.1.2.3 (host "hooks.example.com")'), {
        code: 'ERR_SSRF_BLOCKED',
      })
    );
    const { sendTeamsWebhook } = await import('../teams');
    const result = await sendTeamsWebhook('https://hooks.example.com/x', {});
    expect(result.error).toBe('Blocked by address policy');
  });

  it('does not echo network error text', async () => {
    post.mockRejectedValue(Object.assign(new Error('connect ECONNREFUSED 10.1.2.3:443'), { code: 'ECONNREFUSED' }));
    const { sendTeamsWebhook } = await import('../teams');
    const result = await sendTeamsWebhook('https://hooks.example.com/x', {});
    expect(result.error).toBe('Request failed (ECONNREFUSED)');
  });

  it('refuses non-https URLs without sending', async () => {
    const { sendTeamsWebhook } = await import('../teams');
    const result = await sendTeamsWebhook('http://hooks.example.com/x', {});
    expect(result.success).toBe(false);
    expect(post).not.toHaveBeenCalled();
  });
});
