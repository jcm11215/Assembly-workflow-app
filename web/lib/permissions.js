/**
 * What the signed-in person may do, for deciding which buttons to show.
 * The server checks the same table (shared/roles.js) on every request,
 * so this is about not offering a button that would only be refused.
 */
import { can as roleCan } from '../../shared/roles.js';
import { getState, useStore } from './store.js';

export const can = permission => { const me = getState().me; return !!me && roleCan(me.role, permission); };

/** Hook form: re-renders if the person's role changes. */
export function useCan(permission){
  const role = useStore(s => s.me && s.me.role);
  return !!role && roleCan(role, permission);
}
