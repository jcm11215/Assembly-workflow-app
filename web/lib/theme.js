/**
 * Light or dark, per device. Dark is the default; "system" follows the
 * device's own setting and keeps following it. theme-boot.js applies the
 * saved choice before the page first draws.
 */
const KEY = 'awt.theme';
const media = window.matchMedia('(prefers-color-scheme: dark)');

export const THEMES = [
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
  { id: 'system', label: 'Match device' }
];

export function themePref(){
  try { return localStorage.getItem(KEY) || 'dark'; } catch { return 'dark'; }
}

function apply(pref){
  const dark = pref === 'dark' || (pref === 'system' && media.matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  const meta = document.querySelector('meta[name=theme-color]');
  if(meta) meta.setAttribute('content', dark ? '#181818' : '#ffffff');
}

export function setThemePref(pref){
  try { localStorage.setItem(KEY, pref); } catch { /* private mode: this visit only */ }
  apply(pref);
}

media.addEventListener('change', () => { if(themePref() === 'system') apply('system'); });
