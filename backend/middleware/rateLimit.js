/**
 * Small in-memory sliding-window rate limiter.
 * Suitable for a single-process deployment; for multi-instance production put
 * a shared limiter (e.g. Redis or your platform's WAF) in front of the API.
 */
const buckets = new Map();

export function rateLimit({ windowMs = 15 * 60 * 1000, max = 20, prefix = 'rl' } = {}) {
  return (req, res, next) => {
    const key = `${prefix}:${req.ip || req.socket.remoteAddress || 'unknown'}`;
    const now = Date.now();
    let hits = buckets.get(key) || [];
    hits = hits.filter((t) => now - t < windowMs);
    if (hits.length >= max) {
      const retryAfter = Math.ceil((windowMs - (now - hits[0])) / 1000);
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ error: 'Too many attempts. Please wait a moment and try again.' });
    }
    hits.push(now);
    buckets.set(key, hits);
    next();
  };
}

/** Stricter limiter for credential checks, keyed additionally by identifier. */
export function loginRateLimit({ windowMs = 15 * 60 * 1000, max = 8 } = {}) {
  const bucketsLocal = new Map();
  return (req, res, next) => {
    const identifier = String((req.body && (req.body.identifier || req.body.username)) || '').toLowerCase().slice(0, 120);
    const now = Date.now();
    const key = `${req.ip || 'unknown'}|${identifier}`;
    let hits = bucketsLocal.get(key) || [];
    hits = hits.filter((t) => now - t < windowMs);
    if (identifier && hits.length >= max) {
      const retryAfter = Math.ceil((windowMs - (now - hits[0])) / 1000);
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ error: 'Too many sign-in attempts for this account. Please wait a moment and try again.' });
    }
    if (identifier) {
      hits.push(now);
      bucketsLocal.set(key, hits);
    }
    next();
  };
}

/** Periodically drop empty buckets so memory stays bounded. */
export function startCleanupTimer(intervalMs = 10 * 60 * 1000) {
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, hits] of buckets) {
      const fresh = hits.filter((t) => now - t < 15 * 60 * 1000);
      if (fresh.length === 0) buckets.delete(key);
      else buckets.set(key, fresh);
    }
  }, intervalMs);
  timer.unref?.();
  return timer;
}
