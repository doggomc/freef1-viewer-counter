import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { countOpenSockets, makeCountMessage } from '../src/protocol.js';
import { DEFAULT_ALLOWED_ORIGINS, isAllowedOrigin, routeRequest } from '../src/router.js';

const PRODUCTION_ORIGIN = 'https://freef1.netlify.app';
const VERCEL_ORIGIN = 'https://freef1-live.vercel.app';
const BACKUP_ORIGIN = 'https://freef1-backup.vercel.app';

function mockEnv() {
  const calls = { idName: null, request: null };
  const response = new Response('forwarded to room');

  const env = {
    ALLOWED_ORIGINS: PRODUCTION_ORIGIN,
    VIEWER_COUNTER_ROOM: {
      idFromName(name) {
        calls.idName = name;
        return { name };
      },
      get(id) {
        assert.ok(['freef1-global', 'freef1-backup'].includes(id.name));
        return {
          fetch(request) {
            calls.request = request;
            return Promise.resolve(response);
          },
        };
      },
    },
  };

  return { env, calls, response };
}

function request(url, { method = 'GET', headers = {} } = {}) {
  return {
    url,
    method,
    headers: new Headers(headers),
  };
}

test('only exact configured origins are allowed', () => {
  assert.equal(isAllowedOrigin(PRODUCTION_ORIGIN, PRODUCTION_ORIGIN), true);
  assert.equal(isAllowedOrigin('https://preview--freef1.netlify.app', PRODUCTION_ORIGIN), false);
  assert.equal(isAllowedOrigin(null, PRODUCTION_ORIGIN), false);
});

test('comma-separated local and production origins are parsed exactly', () => {
  const configured = `${PRODUCTION_ORIGIN}, http://localhost:8787`;
  assert.equal(isAllowedOrigin('http://localhost:8787', configured), true);
  assert.equal(isAllowedOrigin('http://localhost:8788', configured), false);
});

test('wrangler.jsonc and default origins allow both Netlify and Vercel production sites', () => {
  const wrangler = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  const configured = wrangler.vars?.ALLOWED_ORIGINS;
  assert.equal(isAllowedOrigin(PRODUCTION_ORIGIN, configured), true);
  assert.equal(isAllowedOrigin(VERCEL_ORIGIN, configured), true);
  assert.equal(isAllowedOrigin(BACKUP_ORIGIN, configured), true);
  assert.equal(isAllowedOrigin('https://sub.freef1-backup.vercel.app', configured), false);
  assert.equal(isAllowedOrigin('https://freef1.site', configured), true);
  assert.equal(isAllowedOrigin('https://freef2.netlify.app', configured), true);
  assert.equal(isAllowedOrigin('https://freef1-live-git-main-team.vercel.app', configured), false);
  assert.equal(isAllowedOrigin('https://attacker.example', configured), false);
  assert.equal(DEFAULT_ALLOWED_ORIGINS.includes(PRODUCTION_ORIGIN), true);
  assert.equal(DEFAULT_ALLOWED_ORIGINS.includes(VERCEL_ORIGIN), true);
  assert.equal(isAllowedOrigin(VERCEL_ORIGIN, undefined), true);
});

test('health endpoint is public, cache-disabled, and does not touch the room', async () => {
  const { env, calls } = mockEnv();
  const response = await routeRequest(request('https://counter.example/health'), env);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { ok: true, service: 'freef1-viewer-counter' });
  assert.equal(calls.idName, null);
});

test('unapproved and missing origins are rejected before room access', async () => {
  for (const headers of [
    { Origin: 'https://attacker.example', Upgrade: 'websocket' },
    { Upgrade: 'websocket' },
  ]) {
    const { env, calls } = mockEnv();
    const response = await routeRequest(request('https://counter.example/ws', { headers }), env);
    assert.equal(response.status, 403);
    assert.equal(calls.idName, null);
  }
});

test('WebSocket route rejects query parameters and non-upgrade requests', async () => {
  const { env, calls } = mockEnv();
  const queryResponse = await routeRequest(request('https://counter.example/ws?visitor=1', {
    headers: { Origin: PRODUCTION_ORIGIN, Upgrade: 'websocket' },
  }), env);
  assert.equal(queryResponse.status, 400);
  assert.equal(calls.idName, null);

  const upgradeResponse = await routeRequest(request('https://counter.example/ws', {
    headers: { Origin: PRODUCTION_ORIGIN },
  }), env);
  assert.equal(upgradeResponse.status, 426);
  assert.equal(calls.idName, null);
});

test('approved WebSocket upgrade is forwarded to one fixed global room', async () => {
  const { env, calls, response: expectedResponse } = mockEnv();
  const incoming = request('https://counter.example/ws', {
    headers: { Origin: PRODUCTION_ORIGIN, Upgrade: 'WebSocket' },
  });
  const response = await routeRequest(incoming, env);

  assert.equal(response, expectedResponse);
  assert.equal(calls.idName, 'freef1-global');
  assert.equal(calls.request, incoming);
});

test('main and backup origins use separate fixed rooms with no client-selected room', async () => {
  for (const [origin, expected] of [[VERCEL_ORIGIN, 'freef1-global'], [BACKUP_ORIGIN, 'freef1-backup']]) {
    const { env, calls } = mockEnv();
    env.ALLOWED_ORIGINS = `${VERCEL_ORIGIN},${BACKUP_ORIGIN}`;
    await routeRequest(request('https://counter.example/ws', { headers: { Origin: origin, Upgrade: 'websocket' } }), env);
    assert.equal(calls.idName, expected);
  }
});

test('only open sockets contribute to the live count', () => {
  const sockets = [
    { readyState: 0 }, // CONNECTING
    { readyState: 1 }, // OPEN
    { readyState: 1 }, // OPEN
    { readyState: 2 }, // CLOSING
    { readyState: 3 }, // CLOSED
  ];
  assert.equal(countOpenSockets(sockets), 2);
});

test('count payload contains only a type and a non-negative integer', () => {
  assert.equal(makeCountMessage(42), '{"type":"count","count":42}');
  assert.throws(() => makeCountMessage(-1), TypeError);
  assert.throws(() => makeCountMessage(1.5), TypeError);
});

test('health supports HEAD and cross-origin access but rejects other methods', async () => {
  const { env } = mockEnv();
  for (const method of ['GET', 'HEAD']) {
    const response = await routeRequest(request('https://counter.example/health', { method }), env);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    if (method === 'HEAD') assert.equal(await response.text(), '');
  }
  const response = await routeRequest(request('https://counter.example/health', { method: 'POST' }), env);
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'GET, HEAD');
});

test('aggregate peaks are public, read-only and separated by site', async () => {
  for (const [site, room] of [['main','freef1-global'], ['backup','freef1-backup']]) {
    const {env, calls} = mockEnv();
    const response = await routeRequest(request(`https://counter.example/admin/peaks?site=${site}`), env);
    assert.equal(await response.text(), 'forwarded to room'); assert.equal(calls.idName, room);
  }
  const {env, calls} = mockEnv();
  assert.equal((await routeRequest(request('https://counter.example/admin/peaks?site=other'), env)).status, 400);
  assert.equal((await routeRequest(request('https://counter.example/admin/peaks?site=main', {method:'POST'}), env)).status, 405);
  assert.equal(calls.idName, null);
});
