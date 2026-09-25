/**
 * Field checks for request bodies. Each returns the cleaned value or
 * throws a 400 whose message can be shown to the person as-is.
 */
import { badRequest } from './http.mjs';
import { isISODate } from '../shared/dates.js';

export function text(value, label, { required = false, max = 2000 } = {}){
  const s = value == null ? '' : String(value).trim();
  if(required && !s) throw badRequest(`${label} is required.`);
  if(s.length > max) throw badRequest(`${label} is too long (${max} characters at most).`);
  return s;
}

export function oneOf(value, allowed, label){
  if(!allowed.includes(value)) throw badRequest(`${label} must be one of: ${allowed.join(', ')}.`);
  return value;
}

/** '' or null clears; otherwise must be YYYY-MM-DD. */
export function optionalDate(value, label){
  if(value == null || value === '') return null;
  if(!isISODate(value)) throw badRequest(`${label} must be a date.`);
  return value;
}

export function date(value, label){
  if(!isISODate(value)) throw badRequest(`${label} must be a date.`);
  return value;
}

export function optionalNumber(value, label, { min = -Infinity, max = Infinity } = {}){
  if(value == null || value === '') return null;
  const n = Number(value);
  if(!Number.isFinite(n) || n < min || n > max) throw badRequest(`${label} must be a number between ${min} and ${max}.`);
  return n;
}

export function integer(value, label, { min, max }){
  const n = Number(value);
  if(!Number.isInteger(n) || n < min || n > max) throw badRequest(`${label} must be a whole number from ${min} to ${max}.`);
  return n;
}

/** A user id that exists, or null. */
export function optionalUser(db, value, label = 'Assignee'){
  if(value == null || value === '') return null;
  if(!db.get('select 1 from users where id = ?', String(value))) throw badRequest(`${label} is not on the team.`);
  return String(value);
}

/** A job id that exists. */
export function job(db, value){
  const row = value && db.get('select id, job_number from jobs where id = ?', String(value));
  if(!row) throw badRequest('Pick a job.');
  return row;
}

export const bool = v => v === true || v === 1 || v === 'true';
