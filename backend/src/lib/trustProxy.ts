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

  if (!raw) {
    if (env.REQUIRE_TRUST_PROXY === 'true') {
      // Set by docker-compose: behind a proxy container, the loopback default
      // would put every visitor in the proxy's single rate-limit bucket.
      throw new Error(
        'TRUST_PROXY must be set to your reverse proxy\'s IP address(es) (e.g. TRUST_PROXY=172.28.0.10). ' +
          'See README, "Docker Compose".'
      );
    }
    return { value: ['loopback'], warnings };
  }
  if (raw === 'false') return { value: false, warnings };

  const entries = raw.split(',').map((v) => v.trim()).filter(Boolean);
  const rejected = entries.filter((v) => v === 'true' || /^\d+$/.test(v));
  const accepted = entries.filter((v) => !rejected.includes(v));

  const broad = accepted.filter((v) => v === 'uniquelocal' || v === 'linklocal');
  if (broad.length > 0) {
    warnings.push(
      `TRUST_PROXY includes ${broad.join(', ')}: every address in that range is trusted to set ` +
        'X-Forwarded-For, so a client with such an address can forge its IP. List your proxy\'s address instead.'
    );
  }

  if (rejected.length > 0) {
    warnings.push(
      `TRUST_PROXY ignores ${rejected.join(', ')}: hop counts and "true" trust any peer. ` +
        'List proxy addresses, CIDRs, or loopback/linklocal/uniquelocal.'
    );
  }

  return { value: accepted.length > 0 ? accepted : ['loopback'], warnings };
}
