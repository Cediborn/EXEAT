import { h, qs } from '../dom.js';
import { session } from '../auth.js';
import { apiGet, apiPost, apiPatch, apiPut } from '../api.js';
import { setTitle } from '../components/shell.js';
import { pageHead, loadingBlock, toast, statusBadge, alertBox } from '../components/ui.js';
import { HOUSES, CLASS_YEARS } from '../validation.js';
import { formatDateTime } from '../format.js';

export function adminPage() {
  setTitle('Administration');
  const root = h('div', { class: 'reveal' });
  const statsSlot = h('div', { class: 'stat-grid' }, h('div', { class: 'skeleton skeleton-card' }));
  const usersSlot = h('div', null, loadingBlock('Loading users…'));
  const announceSlot = h('div', null, loadingBlock('Loading announcements…'));
  const settingsSlot = h('div', null, loadingBlock('Loading settings…'));

  root.append(
    pageHead('Administration', 'Accounts, announcements and school policies.'),
    alertBox('info', 'Administrators cannot approve exeats',
      'Approval decisions belong to Housemasters and the Senior Housemaster. This screen manages access and content.'),
    statsSlot,
    h('div', { class: 'section card' },
      h('div', { class: 'card-header' }, h('h2', null, 'Accounts')),
      h('div', { class: 'card-body' }, usersSlot)),
    h('div', { class: 'section card' },
      h('div', { class: 'card-header' }, h('h2', null, 'Announcements')),
      h('div', { class: 'card-body' }, announceSlot)),
    h('div', { class: 'section card' },
      h('div', { class: 'card-header' }, h('h2', null, 'School policies')),
      h('div', { class: 'card-body' }, settingsSlot)));

  loadStats();
  loadUsers();
  loadAnnouncements();
  loadSettings();
  return root;

  async function loadStats() {
    try {
      const data = await apiGet('/api/admin/stats');
      const total = Object.values(data.byStatus || {}).reduce((a, b) => a + b, 0);
      statsSlot.replaceChildren(
        stat(total, 'Total requests'),
        stat(data.students || 0, 'Active students'),
        stat((data.staff?.housemaster || 0) + (data.staff?.senior || 0) + (data.staff?.gate || 0), 'Staff accounts'),
        stat(data.byStatus?.pending || 0, 'Awaiting housemaster', true));
    } catch (err) {
      statsSlot.replaceChildren(alertBox('warning', 'Stats unavailable', err.message));
    }
  }

  function stat(value, label, accent) {
    return h('div', { class: `stat ${accent ? 'stat-accent' : ''}` },
      h('div', { class: 'stat-value' }, String(value)),
      h('div', { class: 'stat-label' }, label));
  }

  async function loadUsers() {
    try {
      const data = await apiGet('/api/admin/users');
      usersSlot.replaceChildren(userForm(data.options), userTable(data.users));
    } catch (err) {
      usersSlot.replaceChildren(alertBox('danger', 'Could not load accounts', err.message));
    }
  }

  function userForm(options) {
    const username = h('input', { class: 'input', id: 'nu-username', placeholder: 'e.g. HM-ODUA' });
    const fullName = h('input', { class: 'input', id: 'nu-name', placeholder: 'Full name' });
    const email = h('input', { class: 'input', id: 'nu-email', type: 'email', placeholder: 'Optional' });
    const password = h('input', { class: 'input', id: 'nu-password', type: 'password', placeholder: 'At least 8 characters' });
    const role = h('select', { class: 'select', id: 'nu-role' },
      options.roles.map((r) => h('option', { value: r }, {
        student: 'Student', housemaster: 'Housemaster / Housemistress', senior: 'Senior Housemaster', gate: 'Gate officer', admin: 'Administrator',
      }[r] || r)));
    const housesBox = h('div', { class: 'form-grid form-grid-2' },
      options.houses.map((house) => h('label', { class: 'checkbox' },
        h('input', { type: 'checkbox', value: house, class: 'nu-house' }),
        h('span', { class: 'checkbox-text' }, house))));
    const studentFields = h('div', { class: 'form-grid form-grid-2' },
      h('div', { class: 'field' }, h('label', { for: 'nu-index' }, 'Index number'),
        h('input', { class: 'input', id: 'nu-index', placeholder: 'MFS/26/0009' })),
      h('div', { class: 'field' }, h('label', { for: 'nu-class' }, 'Year group'),
        h('select', { class: 'select', id: 'nu-class' }, options.classYears.map((c) => h('option', { value: c }, c)))),
      h('div', { class: 'field' }, h('label', { for: 'nu-house' }, 'House'),
        h('select', { class: 'select', id: 'nu-house' }, options.houses.map((c) => h('option', { value: c }, c)))),
      h('div', { class: 'field' }, h('label', { for: 'nu-guardian' }, 'Guardian name'),
        h('input', { class: 'input', id: 'nu-guardian' })),
      h('div', { class: 'field' }, h('label', { for: 'nu-guardian-phone' }, 'Guardian phone'),
        h('input', { class: 'input', id: 'nu-guardian-phone', type: 'tel' })));

    const syncVisibility = () => {
      studentFields.hidden = role.value !== 'student';
      housesBox.hidden = role.value !== 'housemaster';
    };
    role.addEventListener('change', syncVisibility);
    syncVisibility();

    const form = h('form', {
      onsubmit: async (event) => {
        event.preventDefault();
        const payload = {
          username: username.value.trim().toUpperCase(),
          fullName: fullName.value.trim(),
          email: email.value.trim(),
          password: password.value,
          role: role.value,
        };
        if (role.value === 'student') {
          Object.assign(payload, {
            indexNumber: qs('#nu-index').value.trim(),
            classYear: qs('#nu-class').value,
            house: qs('#nu-house').value,
            guardianName: qs('#nu-guardian').value.trim(),
            guardianPhone: qs('#nu-guardian-phone').value.trim(),
          });
        }
        if (role.value === 'housemaster') {
          payload.houses = [...housesBox.querySelectorAll('.nu-house:checked')].map((c) => c.value);
        }
        try {
          await apiPost('/api/admin/users', payload);
          toast('Account created.', { type: 'success' });
          loadUsers();
          loadStats();
        } catch (err) {
          toast(err.message || 'Could not create the account.', { type: 'error' });
        }
      },
    },
      h('h3', { style: { 'margin-bottom': 'var(--space-4)' } }, 'Create an account'),
      h('div', { class: 'form-grid form-grid-2' },
        h('div', { class: 'field' }, h('label', { for: 'nu-role' }, 'Role'), role),
        h('div', { class: 'field' }, h('label', { for: 'nu-username' }, 'Username'), username)),
      h('div', { class: 'form-grid form-grid-2' },
        h('div', { class: 'field' }, h('label', { for: 'nu-name' }, 'Full name'), fullName),
        h('div', { class: 'field' }, h('label', { for: 'nu-email' }, 'Email (optional)'), email)),
      h('div', { class: 'field' }, h('label', { for: 'nu-password' }, 'Temporary password'), password),
      role.value === 'student' ? studentFields : null,
      role.value === 'housemaster' ? h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Assigned houses'), housesBox) : null,
      h('button', { class: 'btn', type: 'submit' }, 'Create account'));

    // Re-render role-dependent sections when the role changes.
    role.addEventListener('change', () => {
      form.replaceChildren(
        h('h3', { style: { 'margin-bottom': 'var(--space-4)' } }, 'Create an account'),
        h('div', { class: 'form-grid form-grid-2' },
          h('div', { class: 'field' }, h('label', { for: 'nu-role' }, 'Role'), role),
          h('div', { class: 'field' }, h('label', { for: 'nu-username' }, 'Username'), username)),
        h('div', { class: 'form-grid form-grid-2' },
          h('div', { class: 'field' }, h('label', { for: 'nu-name' }, 'Full name'), fullName),
          h('div', { class: 'field' }, h('label', { for: 'nu-email' }, 'Email (optional)'), email)),
        h('div', { class: 'field' }, h('label', { for: 'nu-password' }, 'Temporary password'), password),
        role.value === 'student' ? studentFields : null,
        role.value === 'housemaster' ? h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Assigned houses'), housesBox) : null,
        h('button', { class: 'btn', type: 'submit' }, 'Create account'));
    });

    return h('div', { style: { 'margin-bottom': 'var(--space-8)' } }, form);
  }

  function userTable(users) {
    const head = h('thead', null, h('tr', null,
      ['Name', 'Username', 'Role', 'Details', 'Status', 'Actions'].map((label) => h('th', { scope: 'col' }, label))));

    const rows = users.map((u) => {
      const toggle = h('button', {
        class: 'btn btn-secondary btn-sm',
        type: 'button',
        onclick: async () => {
          try {
            await apiPatch(`/api/admin/users/${u.id}`, { active: !u.active });
            toast(u.active ? 'Account disabled.' : 'Account re-enabled.', { type: 'success' });
            loadUsers();
          } catch (err) {
            toast(err.message || 'Update failed.', { type: 'error' });
          }
        },
      }, u.active ? 'Disable' : 'Enable');

      return h('tr', null,
        h('td', null, u.fullName),
        h('td', null, u.username),
        h('td', null, u.role),
        h('td', null, u.role === 'student' ? `${u.classYear} · ${u.house}` : (u.houses.join(', ') || '—')),
        h('td', null, u.active
          ? h('span', { class: 'badge badge-approved' }, 'Active')
          : h('span', { class: 'badge badge-rejected' }, 'Disabled')),
        h('td', null, toggle));
    });

    return h('div', { class: 'table-wrap' },
      h('table', { class: 'table' }, head, h('tbody', null, rows)));
  }

  async function loadAnnouncements() {
    try {
      const data = await apiGet('/api/admin/announcements');
      const title = h('input', { class: 'input', id: 'an-title', placeholder: 'Announcement title' });
      const body = h('textarea', { class: 'textarea', id: 'an-body', placeholder: 'What should students know?' });
      const level = h('select', { class: 'select', id: 'an-level' },
        h('option', { value: 'info' }, 'Information'),
        h('option', { value: 'policy' }, 'Policy'),
        h('option', { value: 'urgent' }, 'Urgent'));
      const form = h('form', {
        onsubmit: async (event) => {
          event.preventDefault();
          try {
            await apiPost('/api/admin/announcements', {
              title: title.value.trim(), body: body.value.trim(), level: level.value,
            });
            toast('Announcement published.', { type: 'success' });
            loadAnnouncements();
          } catch (err) {
            toast(err.message || 'Could not publish.', { type: 'error' });
          }
        },
      },
        h('h3', { style: { 'margin-bottom': 'var(--space-4)' } }, 'Publish an announcement'),
        h('div', { class: 'form-grid form-grid-2' },
          h('div', { class: 'field' }, h('label', { for: 'an-title' }, 'Title'), title),
          h('div', { class: 'field' }, h('label', { for: 'an-level' }, 'Level'), level)),
        h('div', { class: 'field' }, h('label', { for: 'an-body' }, 'Message'), body),
        h('button', { class: 'btn', type: 'submit' }, 'Publish'));

      announceSlot.replaceChildren(
        form,
        h('div', { class: 'announce-list', style: { 'margin-top': 'var(--space-6)' } },
          (data.announcements || []).map((a) => h('article', { class: `announce announce-${a.level}` },
            h('div', { class: 'announce-head' },
              h('span', { class: `badge ${a.level === 'urgent' ? 'badge-urgent' : a.level === 'policy' ? 'badge-pending' : 'badge-neutral'}` }, a.level),
              h('h3', null, a.title),
              a.active ? null : h('span', { class: 'badge badge-neutral' }, 'Hidden'),
              h('button', {
                class: 'btn btn-secondary btn-sm',
                type: 'button',
                style: { 'margin-left': 'auto' },
                onclick: async () => {
                  try {
                    await apiPatch(`/api/admin/announcements/${a.id}`, { active: !a.active });
                    loadAnnouncements();
                  } catch (err) {
                    toast(err.message || 'Update failed.', { type: 'error' });
                  }
                },
              }, a.active ? 'Hide' : 'Show')),
            h('p', null, a.body),
            h('p', { style: { color: 'var(--text-muted)', 'font-size': 'var(--text-xs)', margin: '0.5rem 0 0' } },
              formatDateTime(a.createdAt))))));
    } catch (err) {
      announceSlot.replaceChildren(alertBox('warning', 'Announcements unavailable', err.message));
    }
  }

  async function loadSettings() {
    try {
      const data = await apiGet('/api/admin/settings');
      const fields = {
        external_min_notice_hours: { label: 'Minimum notice for external exeats (hours)', min: 0, max: 168 },
        max_duration_hours: { label: 'Duration review guidance (hours) — advisory, never blocking', min: 1, max: 720 },
        return_grace_minutes: { label: 'Grace period after expected return (minutes)', min: 0, max: 1440 },
        early_departure_minutes: { label: 'Early departure allowed (minutes)', min: 0, max: 720 },
        emergency_contact_phone: { label: 'Emergency contact number shown for urgent requests', text: true },
      };
      const inputs = {};
      const rows = (data.settings || [])
        .filter((s) => fields[s.key])
        .map((s) => {
          const meta = fields[s.key];
          const input = h('input', {
            class: 'input',
            id: `set-${s.key}`,
            type: meta.text ? 'tel' : 'number',
            value: s.value,
            min: meta.min,
            max: meta.max,
          });
          inputs[s.key] = input;
          return h('div', { class: 'field' },
            h('label', { for: `set-${s.key}` }, meta.label), input);
        });

      const form = h('form', {
        onsubmit: async (event) => {
          event.preventDefault();
          const payload = Object.fromEntries(Object.entries(inputs).map(([k, input]) => [k, input.value]));
          try {
            await apiPut('/api/admin/settings', payload);
            toast('Policies updated.', { type: 'success' });
          } catch (err) {
            toast(err.message || 'Could not update policies.', { type: 'error' });
          }
        },
      },
        h('p', { style: { color: 'var(--text-muted)', 'font-size': 'var(--text-sm)' } },
          'These values are validated by the server for every application.'),
        ...rows,
        h('button', { class: 'btn', type: 'submit' }, 'Save policies'));

      settingsSlot.replaceChildren(form);
    } catch (err) {
      settingsSlot.replaceChildren(alertBox('warning', 'Settings unavailable', err.message));
    }
  }
}
