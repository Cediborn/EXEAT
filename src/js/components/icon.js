import { h } from '../dom.js';

/**
 * Small inline SVG icon set (stroke inherits currentColor). Replaces the
 * emoji feature illustrations with consistent, themeable line icons.
 */
function icon(paths, extraProps = {}) {
  return h('svg', {
    viewBox: '0 0 24 24',
    width: '18',
    height: '18',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
    focusable: 'false',
    ...extraProps,
  }, ...paths);
}

/** Clock — faster reviews. */
export function iconClock() {
  return icon([
    h('circle', { cx: '12', cy: '12', r: '9' }),
    h('path', { d: 'M12 7v5l3 2' }),
  ]);
}

/** Shield with check — verified passes. */
export function iconShieldCheck() {
  return icon([
    h('path', { d: 'M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z' }),
    h('path', { d: 'M9 12l2 2 4-4' }),
  ]);
}

/** Phone — built for phones. */
export function iconPhone() {
  return icon([
    h('rect', { x: '7', y: '2.5', width: '10', height: '19', rx: '2.5' }),
    h('path', { d: 'M11 18.5h2' }),
  ]);
}

/** Checkmark inside a circle — confirmations. */
export function iconCheckCircle() {
  return icon([
    h('circle', { cx: '12', cy: '12', r: '9' }),
    h('path', { d: 'M8.5 12.5l2.5 2.5 4.5-5' }),
  ]);
}

/** Gate / doorway — gate verification. */
export function iconGate() {
  return icon([
    h('path', { d: 'M4 21V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v16' }),
    h('path', { d: 'M2 21h20' }),
    h('path', { d: 'M12 12v1' }),
  ]);
}
