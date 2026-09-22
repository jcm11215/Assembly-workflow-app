/**
 * Roles and what each may do. The server checks these on every request;
 * the browser uses the same table to decide which buttons to show.
 *
 *   trainee    "Assembler B" -- works any job, but cannot sign work off
 *              into QC or Complete.
 *   assembler  "Assembler A" -- experienced; works any job, signs off.
 *   admin      runs the shop app: jobs, the team, access codes, settings.
 */

export const ROLES = ['trainee', 'assembler', 'admin'];

export const ROLE_INFO = {
  trainee: {
    label: 'Assembler B',
    blurb: 'Trainee. Works any job -- checklists, stage moves, notes, blockers -- but cannot sign a job into QC or Complete.'
  },
  assembler: {
    label: 'Assembler A',
    blurb: 'Experienced. Works any job and can sign a job through QC and Complete.'
  },
  admin: {
    label: 'Admin',
    blurb: 'Everything an assembler can do, plus creating, editing and deleting jobs, scanning drawings, the team, access codes and settings.'
  }
};

export const roleLabel = role => (ROLE_INFO[role] || {}).label || role || 'No role';

/**
 * Every permission the app checks, by name. Anything not listed for a
 * role is refused. Stage moves have one extra rule (trainee sign-off)
 * that lives in procedure.js's checkStageMove, because it depends on
 * which stage is being entered.
 */
const EVERYONE = ['trainee', 'assembler', 'admin'];
const ADMIN = ['admin'];

export const PERMISSIONS = {
  'job.work':          EVERYONE,   // stage moves, checklist ticks, percent complete
  'job.manage':        ADMIN,      // create, edit details, assign, delete
  'blueprint.manage':  ADMIN,      // scan, re-scan, edit the parts list
  'blocker.report':    EVERYONE,
  'blocker.manage':    ADMIN,      // change status, delete
  'note.write':        EVERYONE,
  'note.delete':       ADMIN,
  'error.log':         EVERYONE,
  'error.close':       ADMIN,
  'error.delete':      ADMIN,
  'task.tick':         EVERYONE,
  'task.manage':       ADMIN,
  'activity.all':      ADMIN,      // everyone sees their own; admins see the shop's
  'team.manage':       ADMIN,
  'settings.manage':   ADMIN,
  'ai.use':            EVERYONE
};

export function can(role, permission){
  const allowed = PERMISSIONS[permission];
  return !!allowed && allowed.includes(role);
}
