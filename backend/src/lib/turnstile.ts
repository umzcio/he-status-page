import axios from 'axios';

export function isTurnstileConfigured(): boolean {
  return !!process.env.TURNSTILE_SECRET_KEY;
}

// Verify a Cloudflare Turnstile token server-side against siteverify.
// Returns true/false for a definitive verdict; throws on network/siteverify
// failure so the caller can fail closed with a distinct error.
export async function verifyTurnstile(token: string, remoteip?: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true; // Skip if not configured

  const params = new URLSearchParams();
  params.append('secret', secret);
  params.append('response', token);
  if (remoteip) params.append('remoteip', remoteip);

  const response = await axios.post(
    'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    params,
    {
      timeout: 5000,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }
  );
  return response.data.success === true;
}
