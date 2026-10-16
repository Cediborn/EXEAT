import crypto from 'node:crypto';
import { getDb, newId, nowIso } from '../db.js';
import { config } from '../config.js';

/**
 * Create an in-app notification and, when a provider is configured, attempt
 * delivery over email/SMS. Delivery is never reported as successful unless the
 * provider accepted the message; without configuration the attempt is recorded
 * as "not_configured" so nobody is misled into thinking a message went out.
 */
export function notify({ userId, type, title, body, link = null, smsTo = null, emailTo = null }) {
  const db = getDb();
  const id = newId();
  const now = nowIso();
  db.prepare('INSERT INTO notifications (id, user_id, type, title, body, link, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, userId, type, title, body, link, now);

  if (smsTo) deliver(id, 'sms', smsTo, { title, body, type });
  if (emailTo) deliver(id, 'email', emailTo, { title, body, type });
  return id;
}

async function deliver(notificationId, channel, recipient, payload) {
  const db = getDb();
  const url = config.notify.webhookUrl;
  const status = 'queued';
  const record = (result, detail) => {
    db.prepare('INSERT INTO notification_deliveries (id, notification_id, channel, recipient, provider, status, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(newId(), notificationId, channel, recipient, url ? 'webhook' : 'none', result, detail, nowIso());
  };

  if (!url) {
    record('not_configured', 'No NOTIFY_WEBHOOK_URL configured; message kept in-app only.');
    return;
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(config.notify.webhookToken ? { authorization: `Bearer ${config.notify.webhookToken}` } : {}),
      },
      body: JSON.stringify({ channel, to: recipient, ...payload }),
      signal: AbortSignal.timeout(config.notify.timeoutMs),
    });
    if (res.ok) record('sent', `Provider accepted (HTTP ${res.status}).`);
    else record('failed', `Provider rejected (HTTP ${res.status}).`);
  } catch (err) {
    record('failed', `Provider unreachable: ${err.message}`);
  }
}

/** Notify every active user holding one of the given roles (optionally scoped to a house). */
export function notifyRoles(roles, { house = null, ...payload }) {
  const db = getDb();
  const placeholders = roles.map(() => '?').join(',');
  const users = db.prepare(`SELECT id, email FROM users WHERE active = 1 AND role IN (${placeholders})`).all(...roles);
  for (const user of users) {
    if (house) {
      const assigned = db.prepare('SELECT 1 FROM staff_assignments WHERE user_id = ? AND house = ?').get(user.id, house);
      if (!assigned && user.role !== 'senior' && user.role !== 'admin') continue;
    }
    notify({ userId: user.id, emailTo: user.email, ...payload });
  }
}

export function markAllRead(userId) {
  getDb().prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(nowIso(), userId);
}
