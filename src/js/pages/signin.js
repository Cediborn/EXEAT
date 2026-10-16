import { h } from '../dom.js';
import { signIn } from '../auth.js';
import { navigate } from '../router.js';
import { setTitle } from '../components/shell.js';
import { field, setFieldError, toast } from '../components/ui.js';
import { ApiError } from '../api.js';

export function signInPage({ query }) {
  setTitle('Sign in');
  const role = query.role === 'student' ? 'student' : 'staff';

  const identifierInput = h('input', {
    class: 'input',
    id: 'identifier',
    name: 'identifier',
    type: 'text',
    autocomplete: 'username',
    autocapitalize: 'none',
    spellcheck: 'false',
    placeholder: role === 'student' ? 'e.g. MFS/26/0123' : 'Your staff username',
    required: true,
  });
  const passwordInput = h('input', {
    class: 'input',
    id: 'password',
    name: 'password',
    type: 'password',
    autocomplete: 'current-password',
    required: true,
  });

  const idField = field({ id: 'identifier', label: role === 'student' ? 'Student ID' : 'Username', control: identifierInput, required: true });
  const pwField = field({ id: 'password', label: 'Password', control: passwordInput, required: true });
  const formError = h('div', { class: 'alert alert-danger', role: 'alert', hidden: true });

  const submitBtn = h('button', { class: 'btn btn-block', type: 'submit' }, 'Sign in');

  const form = h('form', {
    novalidate: true,
    onsubmit: async (event) => {
      event.preventDefault();
      formError.hidden = true;
      setFieldError(identifierInput, idField.querySelector('.field-error'), null);
      setFieldError(passwordInput, pwField.querySelector('.field-error'), null);

      if (!identifierInput.value.trim()) {
        setFieldError(identifierInput, idField.querySelector('.field-error'), 'Enter your username.');
        identifierInput.focus();
        return;
      }
      if (!passwordInput.value) {
        setFieldError(passwordInput, pwField.querySelector('.field-error'), 'Enter your password.');
        passwordInput.focus();
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Signing in…';
      try {
        const data = await signIn(identifierInput.value.trim(), passwordInput.value);
        toast(`Welcome back, ${data.user.fullName.split(' ')[0]}.`, { type: 'success' });
        navigate(homeFor(data.user.role));
      } catch (err) {
        const message = err instanceof ApiError ? err.message : 'Sign-in failed. Please try again.';
        formError.textContent = message;
        formError.hidden = false;
        passwordInput.value = '';
        passwordInput.focus();
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Sign in';
      }
    },
  },
    formError,
    idField,
    pwField,
    submitBtn);

  return h('div', { class: 'auth-wrap reveal' },
    h('div', { class: 'card auth-card' },
      h('h1', null, role === 'student' ? 'Student sign in' : 'Staff sign in'),
      h('p', { class: 'auth-sub' }, role === 'student'
        ? 'Use the student ID issued to you by the school.'
        : 'Housemaster, Senior Housemaster, gate or administrator account.'),
      form,
      h('div', { class: 'auth-alt' },
        role === 'student'
          ? h('span', null, 'New student? ',
              h('a', { href: '#/register' }, 'Create your account'),
              ' · ',
              h('a', { href: '#/signin' }, 'Staff sign in'))
          : h('span', null, h('a', { href: '#/signin?role=student' }, 'Student sign in')))));
}

function homeFor(role) {
  if (role === 'student') return '#/app';
  if (role === 'gate') return '#/gate';
  if (role === 'admin') return '#/admin';
  return '#/staff';
}
