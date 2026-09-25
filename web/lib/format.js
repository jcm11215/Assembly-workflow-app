/** Dates and times as the shop reads them. */
import { parseISODate, todayISO, daysUntil } from '../../shared/dates.js';

/** "Tue 16 Sep" for a YYYY-MM-DD date. */
export function fmtDate(iso){
  if(!iso) return '';
  return parseISODate(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

/** "16 Sep, 2:05 pm" for a timestamp, dropping the date when it is today. */
export function fmtWhen(ts){
  if(!ts) return '';
  const d = new Date(ts);
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay ? time : `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}, ${time}`;
}

/** "in 3 days", "today", "2 days ago" relative to a YYYY-MM-DD date. */
export function fmtDue(iso){
  if(!iso) return 'No due date';
  const d = daysUntil(iso, todayISO());
  if(d === 0) return 'Due today';
  if(d === 1) return 'Due tomorrow';
  if(d === -1) return 'Due yesterday';
  return d > 0 ? `Due in ${d} days` : `${-d} days overdue`;
}

export function fmtBytes(n){
  if(n == null) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while(n >= 1024 && i < units.length - 1){ n /= 1024; i++; }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
