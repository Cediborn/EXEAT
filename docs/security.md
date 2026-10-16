# Security

Threat model: a shared school deployment — students (untrusted), staff (partially trusted),
gate officers (limited scope), admins (trusted but must not be able to approve their own
family's requests), plus anyone who can reach the public URL.

## Authentication

- **Passwords:** `crypto.scryptSync` (N=16384, r=8, p=1) with a per-user random salt; constant
  work on both success and failure paths so login timing does not leak which field was wrong.
- **Sessions:** server-side `sessions` table; cookie `entryout_sid` is **httpOnly + SameSite=Lax**
  (`Secure` when `COOKIE_SECURE=true`), TTL `SESSION_TTL_HOURS`. Logout deletes the row, so the
  cookie alone is worthless afterwards.
- **Rate limits** (in-memory sliding window, env-tunable): login `LOGIN_RATE_LIMIT_MAX` (8) per
  identifier and `LOGIN_RATE_LIMIT_IP_MAX` (30) per IP / 15 min; all `/api` traffic
  `RATE_LIMIT_API_MAX` (300) / min.

## Authorization

- Every protected route runs the shared `requireAuth` middleware → `{ role, houses[] }` claims
  resolved from `staff_assignments`, never from client input.
- **House scoping:** housemasters only see/search requests for houses they are assigned to.
- **Role guards in the workflow service, not just routes:** students cannot approve, seniors
  cannot decide at the housemaster stage, and **admins cannot approve at all** — each returns
  a uniform 403.
- **Gate privacy:** `/api/gate/*` responses carry identity + window + status only. The reason
  for leaving is stripped; this is asserted by tests.
- IDOR: request reads are always `WHERE id = ? AND student_id = ?` for students — knowing a
  UUID is not enough.

## CSRF & XSS

- **Double-submit CSRF:** an `entryout_csrf` cookie (readable by JS) must be echoed in the
  `X-CSRF-Token` header on every mutating request; mismatches are rejected before handlers run.
- **XSS:** the frontend builds DOM exclusively through the `h()` helper (text nodes); `innerHTML`
  is not used anywhere (the one occurrence found during audit was removed). API errors are
  rendered as text.

## Transport & headers

- Security headers on every response: `X-Content-Type-Options: nosniff`, `Referrer-Policy`,
  `X-Frame-Options: DENY`, a conservative `Content-Schema`/CSP (`default-src 'self'`,
  Google Fonts allowed, no inline script execution beyond the existing nonce-free app model).
- CORS is credential-aware and **explicitly allow-listed** (`ALLOWED_ORIGINS`); the wildcard is
  never used with `credentials: true`.

## Data protection

- Enumeration-safe errors: uniform `{ error, errors? }` shape; login never reveals whether the
  identifier or password was wrong.
- Pass codes: 12 characters from an unambiguous alphabet (Crockford-style, no `I/L/O/0`),
  generated with `crypto.randomBytes` and looked up in constant-ish time; guessing is bounded
  by the same rate limiter as `/api`.
- `audit_log` records actor, action, and target for authentication and state-changing events.
- `.env` is git-ignored (verified) and secrets are never logged; the repo contains only
  `.env.example`.
- SQLite file lives under `data/` (git-ignored) — file permissions are the deployment's job.

## Out of scope / accepted risks (documented, not hidden)

- No 2FA — acceptable for this pilot; sessions expire after 12 h.
- In-memory rate limiting resets on restart and does not coordinate across instances.
- SMS/email delivery requires an external webhook (`NOTIFY_WEBHOOK_URL`); in-app notifications
  are authoritative until one is configured — nothing claims "SMS sent" otherwise.
- QR codes encode only the public pass code (no student data beyond what the gate already sees).
