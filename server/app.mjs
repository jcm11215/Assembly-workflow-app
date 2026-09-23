/**
 * Builds the request handler: API routes under /api, the web app for
 * everything else. Kept apart from main.mjs so tests can run the whole
 * server against an in-memory database on a spare port.
 */
import { config } from './config.mjs';
import { createRouter, HttpError, forbidden, readJson, readRaw, sendError, sendJson,
         serveStatic, parseCookies, cookieHeader, isHttps, MB } from './http.mjs';
import { SESSION_COOKIE, userForSession } from './auth.mjs';
import { can } from '../shared/roles.js';
import { broadcast } from './live.mjs';
import { now } from './db.mjs';
import { toActivity } from './records.mjs';

import sessionRoutes from './routes/session.mjs';
import stateRoutes from './routes/state.mjs';
import jobRoutes from './routes/jobs.mjs';
import blueprintRoutes from './routes/blueprints.mjs';
import recordRoutes from './routes/records.mjs';
import taskRoutes from './routes/tasks.mjs';
import activityRoutes from './routes/activity.mjs';
import adminRoutes from './routes/admin.mjs';
import aiRoutes from './routes/ai.mjs';
import knowledgeRoutes from './routes/knowledge.mjs';
import scanRoutes from './routes/scans.mjs';
import calibrationRoutes from './routes/calibration.mjs';

/**
 * @param {object} deps
 * @param {object} deps.db      from openDb()
 * @param {string} deps.filesDir where blueprint files live
 */
export function createApp({ db, filesDir }){
  const router = createRouter();
  for(const register of [sessionRoutes, stateRoutes, jobRoutes, blueprintRoutes, recordRoutes,
                         taskRoutes, activityRoutes, adminRoutes, aiRoutes, knowledgeRoutes, scanRoutes,
                         calibrationRoutes]){
    register(router);
  }

  return async function handle(req, res){
    const url = new URL(req.url, 'http://local');
    const pathname = url.pathname;

    if(!pathname.startsWith('/api/')){
      if(req.method !== 'GET' && req.method !== 'HEAD'){ sendJson(res, 405, { error: 'Method not allowed' }); return; }
      if(pathname.startsWith('/shared/') && serveStatic(req, res, config.sharedDir, pathname.slice('/shared'.length))) return;
      const file = pathname === '/' ? '/index.html' : pathname;
      if(serveStatic(req, res, config.webDir, file)) return;
      sendJson(res, 404, { error: 'Not found' });
      return;
    }

    try {
      const found = router.match(req.method, pathname);
      if(!found) throw new HttpError(404, 'No such API endpoint.', 'not_found');
      if(found.methodNotAllowed) throw new HttpError(405, 'Method not allowed.', 'method');
      const { route, params } = found;

      // A custom header on every write. Browsers will not attach one to a
      // cross-site request without a CORS preflight, which this server
      // never approves -- so another site cannot make a signed-in
      // browser change anything here.
      if(req.method !== 'GET' && req.method !== 'HEAD' && req.headers['x-requested-with'] !== 'awt'){
        throw forbidden('Request refused (missing app header).');
      }

      const token = parseCookies(req)[SESSION_COOKIE];
      const user = userForSession(db, token, config.sessionDays);
      if(!route.opts.public && !user) throw new HttpError(401, 'Sign in first.', 'signed_out');
      if(route.opts.perm && !can(user.role, route.opts.perm)) throw forbidden();

      const ctx = makeContext({ req, res, url, params, db, filesDir, user, token });
      const result = await route.handler(ctx);
      if(!res.headersSent) sendJson(res, ctx.status || 200, result === undefined ? { ok: true } : result, ctx.headers);
    } catch (err) {
      if(res.headersSent){ console.error(err); res.end(); return; }
      sendError(res, err);
    }
  };
}

function makeContext({ req, res, url, params, db, filesDir, user, token }){
  return {
    req, res, db, filesDir, user, token, params,
    query: url.searchParams,
    headers: {},
    status: 200,
    json: (limit) => readJson(req, limit),
    raw: (limit = 60 * MB) => readRaw(req, limit),

    /** Throws 403 unless the signed-in user holds `permission`. */
    require(permission){
      if(!can(user.role, permission)) throw forbidden();
    },

    setSessionCookie(value, maxAgeSec){
      res.setHeader('Set-Cookie', cookieHeader(SESSION_COOKIE, value, { maxAgeSec, secure: isHttps(req) }));
    },

    clientIp(){
      return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    },

    /**
     * Appends to the activity log and pushes the entry to whoever may see
     * it (admins, and the person who did it). `detail.text` is the line
     * the Activity screen shows; any other fields are kept for the audit
     * view.
     */
    log(action, detail = {}, entity = null){
      return logActivity(db, user, action, detail, entity);
    }
  };
}

export function logActivity(db, user, action, detail = {}, entity = null){
  const info = db.run(
    'insert into activity (actor_id, actor_name, action, entity_type, entity_id, detail, at) values (?, ?, ?, ?, ?, ?, ?)',
    user ? user.id : null, user ? user.fullName : 'System', action,
    entity ? entity.type : null, entity ? entity.id : null, JSON.stringify(detail || {}), now());
  const entry = toActivity(db.get('select * from activity where id = ?', info.lastInsertRowid));
  broadcast('activity', entry, u => can(u.role, 'activity.all') || (user && u.id === user.id));
  return entry;
}
