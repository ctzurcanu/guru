/**
 * guru-proxy: forwards guru's API calls to Anthropic and OpenAI.
 *
 * - With a valid `x-guru-pass` header, the owner's key (a Worker secret) is used.
 * - Otherwise the caller's own key header is forwarded unchanged.
 * Keys never reach the browser, and responses (including streams) pass straight through.
 */

interface Env {
  ALLOWED_ORIGINS: string;
  GURU_PASSPHRASE?: string;
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
}

interface Upstream {
  origin: string;
  paths: RegExp;
  ownerKey: (env: Env) => string | undefined;
  /** Puts a key on the outgoing request in the form this provider expects. */
  setKey: (headers: Headers, key: string) => void;
}

const UPSTREAMS: Record<string, Upstream> = {
  anthropic: {
    origin: 'https://api.anthropic.com',
    paths: /^\/v1\/(messages|models(\/[\w.-]+)?)$/,
    ownerKey: env => env.ANTHROPIC_API_KEY,
    setKey: (headers, key) => headers.set('x-api-key', key),
  },
  openai: {
    origin: 'https://api.openai.com',
    paths: /^\/v1\/(responses|models(\/[\w.-]+)?)$/,
    ownerKey: env => env.OPENAI_API_KEY,
    setKey: (headers, key) => headers.set('authorization', `Bearer ${key}`),
  },
};

/** The caller's own key; SDKs send it as `x-api-key` or `Authorization: Bearer`. */
const callerKey = (request: Request) =>
  (request.headers.get('x-api-key') ?? request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1])?.trim();

// Only these request headers are forwarded upstream.
const FORWARDED = ['content-type', 'accept', 'anthropic-version', 'anthropic-beta', 'openai-beta'];

function cors(origin: string | null, env: Env): Record<string, string> {
  const allowed = env.ALLOWED_ORIGINS.split(',').map(o => o.trim());
  const ok = origin && (allowed.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));
  return ok ? {'access-control-allow-origin': origin, vary: 'Origin'} : {};
}

/** Constant-time string comparison, so response timing doesn't reveal the passphrase. */
async function same(a: string, b: string) {
  const [x, y] = await Promise.all([a, b].map(s => crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))));
  const ua = new Uint8Array(x), ub = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < ua.length; i++) diff |= ua[i] ^ ub[i];
  return diff === 0;
}

const error = (status: number, message: string, headers: Record<string, string>) =>
  Response.json({error: {type: 'proxy_error', message}}, {status, headers});

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const corsHeaders = cors(request.headers.get('origin'), env);
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          ...corsHeaders,
          'access-control-allow-methods': 'GET, POST, OPTIONS',
          'access-control-allow-headers': request.headers.get('access-control-request-headers') ?? '',
          'access-control-max-age': '86400',
        },
      });
    }
    if (url.pathname === '/health') return Response.json({status: 'ok'}, {headers: corsHeaders});

    const [, name, ...rest] = url.pathname.split('/');
    const upstream = UPSTREAMS[name];
    const path = '/' + rest.join('/');
    if (!upstream || !upstream.paths.test(path)) return error(404, 'Not found.', corsHeaders);
    if (request.method !== 'GET' && request.method !== 'POST') return error(405, 'Method not allowed.', corsHeaders);

    const headers = new Headers();
    for (const h of FORWARDED) {
      const value = request.headers.get(h);
      if (value) headers.set(h, value);
    }

    // Trim everything: pasted secrets often carry a stray space or newline.
    const pass = request.headers.get('x-guru-pass')?.trim();
    if (pass) {
      const expected = env.GURU_PASSPHRASE?.trim();
      if (!expected || !(await same(pass, expected))) {
        return error(401, 'Wrong guru passphrase.', corsHeaders);
      }
      const key = upstream.ownerKey(env)?.trim();
      if (!key) return error(503, `No ${name} key is configured on the proxy.`, corsHeaders);
      upstream.setKey(headers, key);
    } else {
      const key = callerKey(request);
      if (!key) return error(401, 'Missing API key or guru passphrase.', corsHeaders);
      upstream.setKey(headers, key);
    }

    const response = await fetch(upstream.origin + path + url.search, {
      method: request.method,
      headers,
      body: request.method === 'POST' ? request.body : undefined,
    });

    // Pass the upstream response (and any stream) through, adding CORS.
    const out = new Headers(response.headers);
    for (const [k, v] of Object.entries(corsHeaders)) out.set(k, v);
    out.set('access-control-expose-headers', 'request-id, x-request-id, retry-after');
    return new Response(response.body, {status: response.status, statusText: response.statusText, headers: out});
  },
};
