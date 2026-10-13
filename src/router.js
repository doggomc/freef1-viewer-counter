const DEFAULT_ALLOWED_ORIGINS = ['https://freef1.netlify.app'];
const ROOM_NAME = 'freef1-global';

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
    if (request.method !== 'GET') {
      return textResponse('Method not allowed', 405, { Allow: 'GET' });
    }

    return new Response(JSON.stringify({ ok: true, service: 'freef1-viewer-counter' }), {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json; charset=utf-8',
      },
    });
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

  const roomId = env.VIEWER_COUNTER_ROOM.idFromName(ROOM_NAME);
  const room = env.VIEWER_COUNTER_ROOM.get(roomId);
  return room.fetch(request);
}
