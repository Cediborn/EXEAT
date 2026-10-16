import { h } from '../dom.js';
import { register } from '../auth.js';
import { navigate } from '../router.js';
import { setTitle } from '../components/shell.js';
import { field, setFieldError, toast } from '../components/ui.js';
import { HOUSES, CLASS_YEARS, isPhone } from '../validation.js';
import { ApiError } from '../api.js';

export function registerPage() {
  setTitle('Create your account');

  const controls = {};
  const errorEls = {};

  const make = (id, props, opts) => {
    const control = h('input', { class: 'input', id, name: id, ...props });
    controls[id] = control;
    const node = field({ id, label: opts.label, hint: opts.hint, required: opts.required !== false, control });
    errorEls[id] = node.querySelector('.field-error');
    return node;
  };

  const makeSelect = (id, options, opts) => {
    const control = h('select', { class: 'select', id, name: id },
      h('option', { value: '' }, opts.placeholder || 'Select…'),
      options.map((value) => h('option', { value }, value)));
    controls[id] = control;
    const node = field({ id, label: opts.label, hint: opts.hint, required: true, control });
    errorEls[id] = node.querySelector('.field-error');
    return node;
  };

  const formError = h('div', { class: 'alert alert-danger', role: 'alert', hidden: true });
  const submitBtn = h('button', { class: 'btn btn-block', type: 'submit' }, 'Create account');

  const form = h('form', {
    novalidate: true,
    onsubmit: async (event) => {
      event.preventDefault();
      formError.hidden = true;
      Object.values(errorEls).forEach((el) => { el.hidden = true; el.textContent = ''; });
      Object.values(controls).forEach((c) => c.removeAttribute('aria-invalid'));

      const values = Object.fromEntries(Object.entries(controls).map(([k, c]) => [k, c.value.trim()]));
      const errors = {};
      if (!/^[A-Za-z0-9/-]{4,40}$/.test(values.username.toUpperCase())) errors.username = 'Use your student ID, e.g. MFS/26/0123.';
      if (values.fullName.length < 3) errors.fullName = 'Enter your full name.';
      if (!/^[A-Za-z0-9/ -]{4,30}$/.test(values.indexNumber)) errors.indexNumber = 'Enter your index number.';
      if (!CLASS_YEARS.includes(values.classYear)) errors.classYear = 'Choose your year group.';
      if (!HOUSES.includes(values.house)) errors.house = 'Choose your house.';
      if (!values.guardianName) errors.guardianName = "Enter your parent or guardian's name.";
      if (!isPhone(values.guardianPhone)) errors.guardianPhone = 'Enter a valid phone number, e.g. 024 123 4567.';
      if (!values.enrollmentCode) errors.enrollmentCode = 'Enter the enrolment code given to you by the school.';
      if (values.password.length < 8) errors.password = 'Use at least 8 characters.';
      if (values.password !== values.confirm) errors.confirm = 'Passwords do not match.';

      const firstKey = Object.keys(errors)[0];
      if (firstKey) {
        for (const [key, message] of Object.entries(errors)) setFieldError(controls[key], errorEls[key], message);
        controls[firstKey].focus();
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Creating account…';
      try {
        await register({
          username: values.username.toUpperCase(),
          fullName: values.fullName,
          indexNumber: values.indexNumber.toUpperCase(),
          classYear: values.classYear,
          house: values.house,
          guardianName: values.guardianName,
          guardianPhone: values.guardianPhone,
          email: values.email || undefined,
          enrollmentCode: values.enrollmentCode,
          password: values.password,
        });
        toast('Account created — welcome to Entryout.', { type: 'success' });
        navigate('#/app');
      } catch (err) {
        if (err instanceof ApiError && err.errors) {
          for (const [key, message] of Object.entries(err.errors)) {
            if (controls[key]) setFieldError(controls[key], errorEls[key], message);
          }
        }
        formError.textContent = err instanceof ApiError ? err.message : 'Could not create the account. Please try again.';
        formError.hidden = false;
        formError.scrollIntoView({ block: 'nearest' });
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Create account';
      }
    },
  },
    formError,
    h('div', { class: 'form-section' },
      h('h3', null, 'Your school details'),
      h('p', { class: 'section-desc' }, 'These details appear on your exeat requests and passes.'),
      make('enrollmentCode', { type: 'text', placeholder: 'Code from the school', autocomplete: 'off' }, { label: 'Enrolment code', hint: 'Given to you by the school office.' }),
      make('username', { type: 'text', placeholder: 'MFS/26/0123', autocapitalize: 'characters' }, { label: 'Student ID' }),
      make('indexNumber', { type: 'text', placeholder: 'MFS/26/0123', autocapitalize: 'characters' }, { label: 'Index number' }),
      make('fullName', { type: 'text', placeholder: 'Your full name', autocomplete: 'name' }, { label: 'Full name' }),
      h('div', { class: 'form-grid form-grid-2' },
        makeSelect('classYear', CLASS_YEARS, { label: 'Year group', placeholder: 'Select year' }),
        makeSelect('house', HOUSES, { label: 'House', placeholder: 'Select house' }))),
    h('div', { class: 'form-section' },
      h('h3', null, 'Parent or guardian'),
      h('p', { class: 'section-desc' }, 'Used for external exeats and approved-pass notifications.'),
      make('guardianName', { type: 'text', placeholder: 'Parent or guardian name' }, { label: 'Guardian name' }),
      make('guardianPhone', { type: 'tel', inputmode: 'tel', placeholder: '024 123 4567' }, { label: 'Guardian phone' })),
    h('div', { class: 'form-section' },
      h('h3', null, 'Sign-in details'),
      make('email', { type: 'email', autocomplete: 'email', placeholder: 'Optional' }, { label: 'Email (optional)', required: false }),
      make('password', { type: 'password', autocomplete: 'new-password', placeholder: 'At least 8 characters' }, { label: 'Password' }),
      make('confirm', { type: 'password', autocomplete: 'new-password' }, { label: 'Confirm password' })),
    submitBtn);

  return h('div', { class: 'auth-wrap reveal', style: { 'max-width': '32rem' } },
    h('div', { class: 'card auth-card' },
      h('h1', null, 'Create your student account'),
      h('p', { class: 'auth-sub' }, 'Registration needs the enrolment code issued by the school.'),
      form,
      h('div', { class: 'auth-alt' },
        h('span', null, 'Already registered? ', h('a', { href: '#/signin?role=student' }, 'Sign in')))));
}
