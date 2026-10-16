import { Router } from 'express';
import { getDb } from '../db.js';
import { CATEGORIES } from '../config.js';
import { asyncHandler, notFound } from '../middleware/errors.js';
import { requireAuth } from '../middleware/auth.js';

export const publicRouter = Router();

publicRouter.get('/health', (req, res) => {
  res.json({ ok: true, service: 'entryout-api', time: new Date().toISOString() });
});

publicRouter.get('/config', (req, res) => {
  res.json({
    app: 'Entryout',
    categories: CATEGORIES,
    registrationEnabled: true,
  });
});

publicRouter.get('/announcements', (req, res) => {
  const rows = getDb().prepare('SELECT id, title, body, level, created_at FROM announcements WHERE active = 1 ORDER BY created_at DESC').all();
  res.json({
    announcements: rows.map((r) => ({ id: r.id, title: r.title, body: r.body, level: r.level, createdAt: r.created_at })),
  });
});

publicRouter.get('/policies', (req, res) => {
  res.json({ emergencyContactPhone: process.env.EMERGENCY_CONTACT_PHONE || null });
});
