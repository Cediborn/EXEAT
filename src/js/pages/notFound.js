import { h } from '../dom.js';
import { setTitle } from '../components/shell.js';
import { navigate } from '../router.js';

export function notFoundPage() {
  setTitle('Page not found');
  return h('div', { class: 'empty-state reveal', style: { 'max-width': '32rem', margin: '0 auto' } },
    h('h1', { style: { 'margin-bottom': 'var(--space-2)' } }, 'Page not found'),
    h('p', null, 'That page does not exist. If you followed a link from a notification, sign in first and try again.'),
    h('div', { class: 'btn-row', style: { justifyContent: 'center' } },
      h('button', { class: 'btn', type: 'button', onclick: () => navigate('#/') }, 'Go home'),
      h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => navigate('#/signin') }, 'Sign in')));
}
