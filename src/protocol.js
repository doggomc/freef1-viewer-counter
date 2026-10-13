export function countOpenSockets(sockets) {
  return sockets.reduce((count, socket) => count + (socket.readyState === 1 ? 1 : 0), 0);
}

export function makeCountMessage(count) {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new TypeError('Viewer count must be a non-negative safe integer');
  }

  return JSON.stringify({ type: 'count', count });
}
