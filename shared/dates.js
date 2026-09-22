/**
 * Calendar dates as "YYYY-MM-DD" strings in local time.
 *
 * `new Date('2026-09-16')` parses as UTC midnight -- the previous day
 * anywhere west of Greenwich -- so every date here is built and parsed
 * with an explicit local time instead.
 */

const pad = n => String(n).padStart(2, '0');

export function toISODate(d){
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const todayISO = () => toISODate(new Date());

export const parseISODate = iso => new Date(`${iso}T00:00:00`);

export const isISODate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) &&
  !Number.isNaN(parseISODate(s).getTime());

export function shiftDays(iso, delta){
  const d = parseISODate(iso);
  d.setDate(d.getDate() + delta);
  return toISODate(d);
}

/** Whole days from today until `iso`; negative when it has passed. */
export function daysUntil(iso, today = todayISO()){
  if(!iso) return Infinity;
  return Math.round((parseISODate(iso) - parseISODate(today)) / 86400000);
}

export const dayOfWeek = iso => parseISODate(iso).getDay();
