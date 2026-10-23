// Resolve Express's `trust proxy` setting from TRUST_PROXY.
//
// Express only reads X-Forwarded-For when the socket peer is trusted. A hop
// count (the old TRUST_PROXY_HOPS) or `true` trusts whoever connects, including
// a client talking to the backend port directly, which lets that client pick
// its own req.ip and walk around IP rate limits. So only address-based values
// are accepted: Express's named ranges (loopback, linklocal, uniquelocal), IPs,
// and CIDRs, comma-separated. Default: loopback (nginx on the same host).

export interface TrustProxyResult {
  value: string[] | false;
  warnings: string[];
}

export function resolveTrustProxy(env: NodeJS.ProcessEnv = process.env): TrustProxyResult {
  const warnings: string[] = [];
  const raw = env.TRUST_PROXY?.trim();

  if (env.TRUST_PROXY_HOPS) {
    warnings.push(
      'TRUST_PROXY_HOPS is no longer supported and is ignored: a hop count trusts any peer. ' +
        'Set TRUST_PROXY to the address(es) of your reverse proxy instead (default: loopback).'
    );
  }

  if (!raw) return { value: ['loopback'], warnings };
  if (raw === 'false') return { value: false, warnings };

  const entries = raw.split(',').map((v) => v.trim()).filter(Boolean);
  const rejected = entries.filter((v) => v === 'true' || /^\d+$/.test(v));
  const accepted = entries.filter((v) => !rejected.includes(v));

  if (rejected.length > 0) {
    warnings.push(
      `TRUST_PROXY ignores ${rejected.join(', ')}: hop counts and "true" trust any peer. ` +
        'List proxy addresses, CIDRs, or loopback/linklocal/uniquelocal.'
    );
  }

  return { value: accepted.length > 0 ? accepted : ['loopback'], warnings };
}
