import test from 'node:test';
import assert from 'node:assert/strict';
import { countOpenSockets, makeCountMessage } from '../src/protocol.js';
import { isAllowedOrigin, routeRequest } from '../src/router.js';

const PRODUCTION_ORIGIN = 'https://freef1.netlify.app';

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
        assert.equal(id.name, 'freef1-global');
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
