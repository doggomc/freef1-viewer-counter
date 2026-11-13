import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Exercise the actual room class in Node with the platform APIs represented by mocks.
const source = (await readFile(new URL('../src/index.js', import.meta.url), 'utf8'))
  .replace("import { DurableObject } from 'cloudflare:workers';", 'class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }')
  .replace("'./protocol.js'", `'${new URL('../src/protocol.js', import.meta.url).href}'`)
  .replace("'./router.js'", `'${new URL('../src/router.js', import.meta.url).href}'`);
const { ViewerCounterRoom } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

test('joins get immediate count and one persistent alarm batches joins and departures', async () => {
  const old = { Response: globalThis.Response, WebSocketPair: globalThis.WebSocketPair, WebSocket: globalThis.WebSocket };
  globalThis.WebSocket = { OPEN: 1 };
  globalThis.WebSocketPair = class { constructor() { this[0] = {}; this[1] = { readyState: 1, messages: [], send(m) { this.messages.push(JSON.parse(m)); } }; } };
  globalThis.Response = class { constructor(body, options) { this.body = body; Object.assign(this, options); } };
  try {
    const sockets = []; let alarm = null, alarmsSet = 0;
    const ctx = { acceptWebSocket(s) { sockets.push(s); }, getWebSockets() { return sockets; }, storage: {
      async getAlarm() { return alarm; }, async setAlarm(at) { alarm = at; alarmsSet++; }
    } };
    let room = new ViewerCounterRoom(ctx, {});
    const request = { headers: new Headers({ Upgrade: 'websocket' }) };
    for (let i = 0; i < 10; i++) await room.fetch(request);
    assert.equal(alarmsSet, 1);
    assert.deepEqual(sockets.map(s => s.messages[0].count), [1,2,3,4,5,6,7,8,9,10]);
    sockets[0].readyState = 3; await room.webSocketClose();
    assert.equal(alarmsSet, 1);
    // New object instance represents a hibernated object being awakened for its alarm.
    room = new ViewerCounterRoom(ctx, {}); alarm = null; await room.alarm();
    for (const s of sockets.slice(1)) assert.equal(s.messages.at(-1).count, 9);
    await room.webSocketClose(); assert.equal(alarmsSet, 2);
  } finally { Object.assign(globalThis, old); }
});
