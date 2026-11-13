import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Exercise the actual room class in Node with the platform APIs represented by mocks.
const source = (await readFile(new URL('../src/index.js', import.meta.url), 'utf8'))
  .replace("import { DurableObject } from 'cloudflare:workers';", 'class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }')
  .replace("'./protocol.js'", `'${new URL('../src/protocol.js', import.meta.url).href}'`)
  .replace("'./peaks.js'", `'${new URL('../src/peaks.js', import.meta.url).href}'`)
  .replace("'./router.js'", `'${new URL('../src/router.js', import.meta.url).href}'`);
const { ViewerCounterRoom } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

test('joins get immediate count and one persistent alarm batches joins and departures', async () => {
  const old = { Response: globalThis.Response, WebSocketPair: globalThis.WebSocketPair, WebSocket: globalThis.WebSocket };
  globalThis.WebSocket = { OPEN: 1 };
  globalThis.WebSocketPair = class { constructor() { this[0] = {}; this[1] = { readyState: 1, messages: [], send(m) { this.messages.push(JSON.parse(m)); } }; } };
  globalThis.Response = class { constructor(body, options) { this.body = body; Object.assign(this, options); } };
  try {
    const sockets = []; let alarm = null, alarmsSet = 0; const records = new Map();
    const ctx = { acceptWebSocket(s) { sockets.push(s); }, getWebSockets() { return sockets; }, storage: {
      async getAlarm() { return alarm; }, async setAlarm(at) { alarm = at; alarmsSet++; }, async get(k) { return records.get(k); }, async put(k,v) { records.set(k,v); }, async transaction(fn) { return fn(this); }
    } };
    let room = new ViewerCounterRoom(ctx, {});
    const request = { url: 'https://counter.example/ws', headers: new Headers({ Upgrade: 'websocket' }) };
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

test('context messages track matching open pages and clear without changing global sockets', async () => {
  const old = globalThis.WebSocket; globalThis.WebSocket = { OPEN: 1 };
  try {
    const makeSocket = () => ({readyState:1, value:null, serializeAttachment(v) { this.value=v; }, deserializeAttachment() { return this.value; }});
    const sockets = [makeSocket(),makeSocket()]; const map = new Map();
    const storage = {get:async k => structuredClone(map.get(k)), put:async(k,v)=>map.set(k,structuredClone(v)), transaction:async fn=>fn(storage)};
    const room = new ViewerCounterRoom({ getWebSockets:()=>sockets, storage }, {});
    const msg = JSON.stringify({type:'context',kind:'replay',key:'2026:1:race',label:'Race'});
    await room.webSocketMessage(sockets[0],msg); await room.webSocketMessage(sockets[1],msg);
    assert.equal(map.get('peaks-v1')[0].peak,2);
    await room.webSocketMessage(sockets[0],'{"type":"clear"}');
    assert.equal(sockets[0].deserializeAttachment(),null); assert.equal(sockets[0].readyState,1);
  } finally { globalThis.WebSocket = old; }
});
