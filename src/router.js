export const DEFAULT_ALLOWED_ORIGINS = [
  'https://freef1.netlify.app',
  'https://freef1-live.vercel.app',
  'https://freef1-backup.vercel.app',
  'https://freef1.site',
  'https://www.freef1.site',
  'https://freef2.netlify.app',
];
const MAIN_ROOM = 'freef1-global';
const BACKUP_ROOM = 'freef1-backup';
const BACKUP_ORIGIN = 'https://freef1-backup.vercel.app';

export function parseAllowedOrigins(rawOrigins) {
  const configured = typeof rawOrigins === 'string'
    ? rawOrigins.split(',').map((origin) => origin.trim()).filter(Boolean)
    : [];

  return new Set(configured.length ? configured : DEFAULT_ALLOWED_ORIGINS);
}

export function isAllowedOrigin(origin, rawOrigins) {
  return typeof origin === 'string' && parseAllowedOrigins(rawOrigins).has(origin);
}

function textResponse(body, status, headers = {}) {
  return new Response(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
      ...headers,
    },
  });
}

export async function routeRequest(request, env) {
  const url = new URL(request.url);

  if (url.pathname === '/health') {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return textResponse('Method not allowed', 405, { Allow: 'GET, HEAD' });
    }

    return new Response(request.method === 'HEAD' ? null : JSON.stringify({ ok: true, service: 'freef1-viewer-counter' }), {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json; charset=utf-8',
      },
    });
  }

  // Read-only aggregate statistics are public; no individual connection data is exposed.
  if (url.pathname === '/admin/peaks') {
    if (request.method !== 'GET') return textResponse('Method not allowed', 405);
    const site = url.searchParams.get('site');
    if (!['main', 'backup'].includes(site) || [...url.searchParams.keys()].some(k => k !== 'site')) return textResponse('Invalid site', 400);
    const id = env.VIEWER_COUNTER_ROOM.idFromName(site === 'backup' ? BACKUP_ROOM : MAIN_ROOM);
    return env.VIEWER_COUNTER_ROOM.get(id).fetch(new Request('https://counter.internal/internal/peaks'));
  }

  if (url.pathname !== '/ws') {
    return textResponse('Not found', 404);
  }

  if (url.search) {
    return textResponse('Query parameters are not supported', 400);
  }

  if (request.method !== 'GET') {
    return textResponse('Method not allowed', 405, { Allow: 'GET' });
  }

  const origin = request.headers.get('Origin');
  if (!isAllowedOrigin(origin, env.ALLOWED_ORIGINS)) {
    return textResponse('Origin not allowed', 403);
  }

  if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
    return textResponse('WebSocket upgrade required', 426, { Upgrade: 'websocket' });
  }

  const roomId = env.VIEWER_COUNTER_ROOM.idFromName(origin === BACKUP_ORIGIN ? BACKUP_ROOM : MAIN_ROOM);
  const room = env.VIEWER_COUNTER_ROOM.get(roomId);
  return room.fetch(request);
}
