// LibreNMS identifiers (hostnames, device ids, group names, service types) are
// admin-supplied and end up in LibreNMS API paths sent with the API token. Each
// one must fill exactly one path segment, so separators, dot segments, and
// query/fragment/escape characters are rejected outright, and the rest is
// percent-encoded.

// eslint-disable-next-line no-control-regex
const FORBIDDEN = /[/\\?#%\x00-\x1f\x7f]/;

/** Validate and percent-encode one LibreNMS path segment. Throws if unsafe. */
export function libreNmsSegment(value: unknown): string {
  if (typeof value !== 'string' || value === '' || value === '.' || value === '..' || FORBIDDEN.test(value)) {
    throw new Error(`Invalid LibreNMS identifier: ${JSON.stringify(value)}`);
  }
  return encodeURIComponent(value);
}

export interface LibreNmsEndpoint {
  mode: 'device' | 'service' | 'group';
  target: string;
  subtype?: string;
}

/**
 * Parse a status_api_endpoint of the form device:<host>, service:<host>[:<type>]
 * or group:<name>. Throws on an unknown mode, extra parts, or an unsafe
 * identifier.
 */
export function parseLibreNmsEndpoint(endpoint: string): LibreNmsEndpoint {
  const parts = endpoint.split(':');
  const [mode, target, subtype] = parts;
  if (mode !== 'device' && mode !== 'service' && mode !== 'group') {
    throw new Error(
      `Invalid LibreNMS endpoint "${endpoint}". Expected device:<host>, service:<host>[:<type>], or group:<name>`
    );
  }
  if (parts.length < 2 || parts.length > (mode === 'service' ? 3 : 2)) {
    throw new Error(`Invalid LibreNMS endpoint "${endpoint}"`);
  }
  libreNmsSegment(target);
  if (subtype !== undefined) libreNmsSegment(subtype);
  return { mode, target, subtype };
}
