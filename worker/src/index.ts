export interface Env {
  /** Comma-separated browser origins allowed to call this proxy (set in wrangler.jsonc `vars`). */
  ALLOWED_ORIGINS?: string;
}

function parseAllowedOrigins(env: Env): Set<string> {
  return new Set(
    (env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map(s => s.trim().replace(/\/+$/, ''))
      .filter(Boolean),
  );
}

function corsHeaders(origin: string | null, allowed: Set<string>): Headers {
  const headers = new Headers();
  if (origin && allowed.has(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Vary', 'Origin');
  }
  headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Upstream-URL');
  headers.set('Access-Control-Max-Age', '86400');
  return headers;
}

function jsonResponse(body: unknown, status: number, origin: string | null, allowed: Set<string>): Response {
  const headers = corsHeaders(origin, allowed);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(body), { status, headers });
}

// Best-effort SSRF block. Workers expose no DNS API, so hostnames that *resolve* to private
// IPs slip through — only IP literals and reserved hostnames are caught here.
function isPrivateHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.localhost')) return true;

  const ipv4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const a = parseInt(ipv4[1], 10);
    const b = parseInt(ipv4[2], 10);
    if (a === 0) return true;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    return false;
  }

  if (h === '::1' || h === '::') return true;
  // fc00::/7 unique-local + fe80::/10 link-local (rough prefix match — false positives here are fine).
  if (/^f[cd][0-9a-f]{2}:/.test(h)) return true;
  if (/^fe[89ab][0-9a-f]?:/.test(h)) return true;

  return false;
}

function validateUpstreamUrl(raw: string): { ok: true; url: URL } | { ok: false; error: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: 'X-Upstream-URL must be a valid URL' };
  }
  if (url.protocol !== 'https:') return { ok: false, error: 'X-Upstream-URL must use https://' };
  if (isPrivateHostname(url.hostname)) return { ok: false, error: 'X-Upstream-URL host is not a public address' };
  if (!url.pathname.endsWith('/chat/completions')) {
    return { ok: false, error: 'X-Upstream-URL path must end with /chat/completions' };
  }
  return { ok: true, url };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin');
    const allowed = parseAllowedOrigins(env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin, allowed) });
    }

    const url = new URL(request.url);
    if (url.pathname === '/health') {
      return jsonResponse({ ok: true }, 200, origin, allowed);
    }

    if (url.pathname !== '/v1/chat/completions') {
      return jsonResponse({ error: 'Not found' }, 404, origin, allowed);
    }

    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405, origin, allowed);
    }

    if (origin && !allowed.has(origin)) {
      return jsonResponse({ error: 'Origin not allowed' }, 403, origin, allowed);
    }

    const authorization = request.headers.get('Authorization');
    if (!authorization?.startsWith('Bearer ')) {
      return jsonResponse({ error: 'Missing Bearer token' }, 401, origin, allowed);
    }

    const rawUpstream = request.headers.get('X-Upstream-URL');
    if (!rawUpstream) {
      return jsonResponse({ error: 'Missing X-Upstream-URL header' }, 400, origin, allowed);
    }
    const check = validateUpstreamUrl(rawUpstream);
    if (!check.ok) return jsonResponse({ error: check.error }, 400, origin, allowed);

    const rawBody = await request.text();
    try {
      const parsed = JSON.parse(rawBody) as Record<string, unknown>;
      if (typeof parsed.model !== 'string' || !Array.isArray(parsed.messages)) {
        return jsonResponse({ error: 'Invalid request body' }, 400, origin, allowed);
      }
    } catch {
      return jsonResponse({ error: 'Request body must be valid JSON' }, 400, origin, allowed);
    }

    let upstream: Response;
    try {
      upstream = await fetch(check.url.toString(), {
        method: 'POST',
        headers: {
          Authorization: authorization,
          'Content-Type': 'application/json',
        },
        body: rawBody,
      });
    } catch (error) {
      return jsonResponse(
        { error: error instanceof Error ? error.message : 'Upstream request failed' },
        502,
        origin,
        allowed,
      );
    }

    const headers = corsHeaders(origin, allowed);
    headers.set('Cache-Control', 'no-store');
    const contentType = upstream.headers.get('Content-Type');
    if (contentType) headers.set('Content-Type', contentType);
    return new Response(upstream.body, {
      status: upstream.status,
      headers,
    });
  },
};
