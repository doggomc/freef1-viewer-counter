import { DurableObject } from 'cloudflare:workers';
import { countOpenSockets, makeCountMessage } from './protocol.js';
import { routeRequest } from './router.js';
import { parseContext, contextCount, savePeak } from './peaks.js';

export class ViewerCounterRoom extends DurableObject {
  async fetch(request) {
    if (new URL(request.url).pathname === '/internal/peaks') {
      return Response.json({ peaks: await this.ctx.storage.get('peaks-v1') || [] }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('WebSocket upgrade required', {
        status: 426,
        headers: { Upgrade: 'websocket' },
      });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Hibernatable acceptance keeps idle sockets connected without pinning the
    // Durable Object in memory. Attachments keep category state through hibernation.
    this.ctx.acceptWebSocket(server);
    try { await savePeak(this.ctx.storage, 'site', 'overall', 'All open pages', countOpenSockets(this.ctx.getWebSockets())); } catch { /* counting must not interrupt viewer connections */ }
    // Populate the new connection immediately; batch the room-wide update.
    try { server.send(makeCountMessage(countOpenSockets(this.ctx.getWebSockets()))); server.send('{"type":"capabilities","contexts":true}'); } catch {}
    await this.scheduleBroadcast();

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  async webSocketMessage(socket, message) {
    if (message === '{"type":"clear"}') { socket.serializeAttachment(null); return; }
    const context = parseContext(message);
    if (!context) return; // Ignore unsupported metadata; never disrupt the live count.
    socket.serializeAttachment(context);
    try { await savePeak(this.ctx.storage, context.kind, context.key, context.label, contextCount(this.ctx.getWebSockets(), context)); } catch { /* leave the connection open if storage is unavailable */ }
  }

  async webSocketClose() {
    await this.scheduleBroadcast();
  }

  // Durable Object alarms survive hibernation and guarantee a trailing update.
  async scheduleBroadcast() {
    if (await this.ctx.storage.getAlarm() === null) {
      await this.ctx.storage.setAlarm(Date.now() + 2500);
    }
  }

  async alarm() {
    this.broadcastCount();
  }

  webSocketError(socket) {
    if (socket.readyState === WebSocket.OPEN) {
      try {
        socket.close(1011, 'Connection error.');
      } catch {
        // The runtime may already have closed the failed connection.
      }
    }
  }

  broadcastCount() {
    const sockets = this.ctx.getWebSockets();
    const message = makeCountMessage(countOpenSockets(sockets));

    for (const socket of sockets) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      try {
        socket.send(message);
      } catch {
        // A concurrent close is cleaned up by the runtime's close callback.
      }
    }
  }
}

export default {
  fetch: routeRequest,
};
