// Strictly bounded, aggregate-only metadata; never accept URLs or visitor IDs.
export function parseContext(message) {
  if (typeof message !== 'string' || message.length > 400) return null;
  let value; try { value = JSON.parse(message); } catch { return null; }
  if (!value || value.type !== 'context' || !['live', 'replay', 'other'].includes(value.kind)) return null;
  if (typeof value.key !== 'string' || !/^[a-zA-Z0-9._:-]{1,100}$/.test(value.key)) return null;
  if (typeof value.label !== 'string' || value.label.length < 1 || value.label.length > 160 || /[\x00-\x1f<>]/.test(value.label) || /https?:\/\//i.test(value.label)) return null;
  return { kind: value.kind, key: value.key, label: value.label };
}
export const PAGE_LABELS = Object.freeze({
  home: 'Home', cockpit: 'Cockpit', schedule: 'Schedule', standings: 'Standings',
  'live-timing': 'Live timing', drivers: 'Drivers', driver: 'Driver profile',
  teams: 'Teams', team: 'Team profile', other: 'Other', replays: 'Replays',
  'other-streams': 'Other Streams', 'replay-cockpit': 'Replay cockpit',
  'private-cockpit': 'Other Streams cockpit', help: 'Help',
});
export function attachment(socket) {
  const raw = socket.deserializeAttachment();
  if (!raw) return { page: null, context: null };
  return raw.kind ? { page: null, context: raw } : { page: raw.page || null, context: raw.context || null };
}
export function openSummary(sockets) {
  const pages = {}; let total = 0, unclassified = 0;
  for (const socket of sockets) {
    if (socket.readyState !== 1) continue;
    total++;
    const { page } = attachment(socket);
    if (page && PAGE_LABELS[page]) pages[page] = (pages[page] || 0) + 1;
    else unclassified++;
  }
  return { total, unclassified, pages };
}
export function contextCount(sockets, context) {
  return sockets.filter(s => { if (s.readyState !== 1) return false; const x = attachment(s).context; return x && x.kind === context.kind && x.key === context.key; }).length;
}
export async function savePeak(storage, kind, key, label, count) {
  await storage.transaction(async tx => {
    const entries = await tx.get('peaks-v1') || [];
    const old = entries.find(x => x.kind === kind && x.key === key);
    if (old && old.peak >= count) return;
    if (old) { old.peak = count; old.at = new Date().toISOString(); old.label = label; }
    else {
      if (entries.length >= 500) { const i = entries.findIndex(x => x.kind !== 'site' && x.kind !== 'page'); if (i >= 0) entries.splice(i, 1); else return; }
      entries.push({ kind, key, label, peak: count, at: new Date().toISOString() });
    }
    await tx.put('peaks-v1', entries);
  });
}
