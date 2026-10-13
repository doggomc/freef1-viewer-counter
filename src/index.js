import { DurableObject } from 'cloudflare:workers';
import { countOpenSockets, makeCountMessage } from './protocol.js';
import { routeRequest } from './router.js';

export class ViewerCounterRoom extends DurableObject {
  async fetch(request) {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('WebSocket upgrade required', {
        status: 426,
        headers: { Upgrade: 'websocket' },
      });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Hibernatable acceptance keeps idle sockets connected without pinning the
    // Durable Object in memory. No socket attachments or storage are used.
    this.ctx.acceptWebSocket(server);
    this.broadcastCount();

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  webSocketMessage(socket) {
    // The site never sends application messages or heartbeats. Close clients
    // that try to use this endpoint as a message channel.
    if (socket.readyState === WebSocket.OPEN) {
      socket.close(1008, 'Client messages are not supported.');
    }
  }

  webSocketClose() {
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
