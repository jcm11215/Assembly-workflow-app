/**
 * Live updates over Server-Sent Events.
 *
 * Every open app holds one GET /api/events stream. After any change the
 * server pushes the changed record, already in the shape the app uses,
 * and each app patches its copy -- nobody reloads everything. EventSource
 * reconnects by itself; on reconnect the app re-reads its data once to
 * cover whatever it missed while offline.
 */
import { SECURITY_HEADERS } from './http.mjs';

const clients = new Set();
const HEARTBEAT_MS = 25000;

export function openStream(req, res, user){
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write('retry: 3000\n\n');
  const client = { res, user };
  clients.add(client);

  // A comment line keeps idle proxies from closing the connection and
  // lets a dead socket be noticed.
  const beat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
  req.on('close', () => {
    clearInterval(beat);
    clients.delete(client);
  });
  send(client, 'hello', { at: new Date().toISOString() });
}

function send(client, type, data){
  client.res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * Pushes `data` to every connected app, or only to those `visibleTo`
 * accepts (e.g. activity entries go to admins and to the person who
 * did the thing).
 */
export function broadcast(type, data, visibleTo = null){
  for(const client of clients){
    if(visibleTo && !visibleTo(client.user)) continue;
    try { send(client, type, data); } catch { /* socket already gone; close handler cleans up */ }
  }
}

/** Closes a user's open streams, e.g. when their account is switched
 *  off -- they stop receiving shop data at once, not on next reload. */
export function disconnectUser(userId){
  for(const client of clients){
    if(client.user.id === userId){
      try { client.res.end(); } catch { /* already closed */ }
      clients.delete(client);
    }
  }
}

/** A user's role or name changed: later events are filtered with it. */
export function updateUser(user){
  for(const client of clients){
    if(client.user.id === user.id) client.user = { ...client.user, ...user };
  }
}

/** Who has the app open right now. */
export const onlineUserIds = () => new Set([...clients].map(c => c.user.id));

export const connectionCount = () => clients.size;

export function closeAll(){
  for(const client of clients){
    try { client.res.end(); } catch { /* already closed */ }
  }
  clients.clear();
}
