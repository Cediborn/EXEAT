/**
 * Light/dark theme controller.
 *
 * The stored preference lives in localStorage under 'entryout-theme' and is
 * applied before first paint by the inline script in index.html (no flash of
 * the wrong theme). Dark (charcoal) is the default for new visitors; an
 * explicit choice always wins and persists across reloads.
 */
import { h } from './dom.js';

const KEY = 'entryout-theme';

const MOON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" '
  + 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'
  + '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';

const SUN = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" '
  + 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'
  + '<circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42'
  + 'M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>';

export function currentTheme() {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

function syncButtons() {
  const isDark = currentTheme() === 'dark';
  const label = isDark ? 'Switch to light theme' : 'Switch to dark theme';
  for (const btn of document.querySelectorAll('.theme-toggle')) {
    btn.setAttribute('aria-pressed', String(isDark));
    btn.setAttribute('aria-label', label);
    btn.setAttribute('title', label);
    const icon = btn.querySelector('.theme-toggle-icon');
    if (icon) icon.innerHTML = isDark ? SUN : MOON;
  }
}

export function applyTheme(theme) {
  const value = theme === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', value);
  document.documentElement.style.colorScheme = value;
  try { localStorage.setItem(KEY, value); } catch { /* private mode — theme still applies */ }
  syncButtons();
}

export function toggleTheme() {
  applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
}

/** Accessible header/mobile-nav toggle button (keyboard operable, aria-labelled). */
export function themeToggleButton() {
  const isDark = currentTheme() === 'dark';
  const label = isDark ? 'Switch to light theme' : 'Switch to dark theme';
  const btn = h('button', {
    class: 'btn btn-ghost btn-sm theme-toggle',
    type: 'button',
    'aria-pressed': String(isDark),
    'aria-label': label,
    title: label,
    onclick: toggleTheme,
  }, h('span', { class: 'theme-toggle-icon', 'aria-hidden': 'true' }));
  btn.querySelector('.theme-toggle-icon').innerHTML = isDark ? SUN : MOON;
  return btn;
}
