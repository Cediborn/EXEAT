# Entryout

Digital exeat management for boarding schools — students request permission, housemasters and
the senior housemaster approve, and the gate verifies a time-boxed digital pass (code + QR).
Rebuilt from the original `entryout.netlify.app` marketing site into a working full-stack app.
Mfantsipim School pilot (`Dwen Hwe Kan`).

**Docs:** [Research/audit](docs/research-audit.md) · [Architecture](docs/architecture.md) ·
[Security](docs/security.md) · [Deployment](docs/deployment.md) · [Testing](docs/testing.md)

## Quick start

```bash
npm ci
npm run seed      # creates data/entryout.sqlite with demo data
npm start         # API + site on http://localhost:8787
```

Open `http://localhost:8787` and sign in:

| Role | Username | Password |
|---|---|---|
| Student | `MFS/26/0001` | `Entryout!2026` |
| Student | `MFS/26/0002` | `Entryout!2026` |
| Housemaster (Balmer-Acquaah) | `HM-BALMER` | `Entryout!2026` |
| Housemaster (Pickard) | `HM-PICKARD` | `Entryout!2026` |
| Senior Housemaster | `SNR-HOUSE` | `Entryout!2026` |
| Gate officer | `GATE01` | `Entryout!2026` |
| Admin | `ADMIN01` | `Entryout!2026` |

> Demo accounts are seeded data — change `STUDENT_ENROLLMENT_CODE` and do **not** seed in
> production. Admins can manage users/settings/announcements but can never approve requests.

## How it fits together

- **Frontend:** vanilla ES-module SPA (`index.html` + `src/`), hash routing, no build step —
  deploys to GitHub Pages as-is. Every page renders through the shared layout container; DOM is
  built with a hyperscript helper (no `innerHTML` anywhere).
- **Backend:** Express 5 + `node:sqlite`, forward-only SQL migrations (auto-run on boot),
  scrypt passwords, DB-backed sessions, CSRF double-submit, rate limits, audit log.
- **Workflow:** `pending → (pending_senior for external) → approved → pass issued →
  gate departure → return → completed`, with reject / return-for-correction / cancel branches.
  See [docs/architecture.md](docs/architecture.md).

```
src/            frontend (css, js pages/components)
backend/        API (routes, services, middleware, scripts)
database/       migrations
tests/          node:test suites (50 tests)
scripts/        browser-e2e.mjs (headless Edge end-to-end)
docs/           research, architecture, security, deployment, testing
.github/        CI + GitHub Pages workflows
```

## Scripts

| Command | What it does |
|---|---|
| `npm start` | run the API (serves the site too) |
| `npm run dev` | run with `--watch` |
| `npm run seed` | create/migrate + insert demo data |
| `npm run migrate` | apply migrations only |
| `npm run reset-db` | delete and recreate the database |
| `npm test` | full test suite (`node --test`) |
| `node scripts/browser-e2e.mjs` | end-to-end UI check in headless Edge (API must be running) |
| `node scripts/dev-bypass-e2e.mjs` | portal-button bypass check (set `EXPECT_BYPASS=off` to test the fallback) |

## Configuration

Copy `.env.example` → `.env`. Everything (ports, CORS origins, cookie security, session TTL,
enrolment code, school policy defaults, notification webhook) is env-driven — see
[docs/deployment.md](docs/deployment.md) for the production checklist, including the
`API_BASE_URL` Pages variable that connects the hosted frontend to the API.

## Development bypass (temporary)

For local demos, the homepage **Student portal** and **Staff sign-in** buttons open the real
dashboards directly via `POST /api/auth/dev-session` — no password needed. The identity is
auto-created (`MFS/26/0001` student, `HM-BALMER` housemaster with
`Entryout!2026`-style credentials never involved); sessions are ordinary DB sessions with the
same cookies, CSRF and authorization checks as a normal login.

Safety layers (all must hold for the bypass to work):

1. **Server** — `config.devBypassAuth` is hard-off when `NODE_ENV=production`; otherwise
   `DEV_BYPASS_AUTH=false|0|off|no` disables it (then `/api/auth/dev-session` is not even
   registered → plain 404).
2. **Frontend** — `window.ENTRYOUT_CONFIG.devBypassAuth` must be strictly `true` (the Pages
   workflow writes `false` into the generated config); otherwise the buttons behave exactly
   as before and navigate to `#/signin`.
3. **Fallback** — any server error/404 on the dev-session call falls back to the original
   sign-in pages.

To restore the classic flow locally: set `DEV_BYPASS_AUTH=false` in `.env` and restart the
API — the buttons then always show the sign-in pages. Normal password login, logout,
registration and every authorization rule are untouched in all modes.

## Status

- ✅ 65/65 automated tests passing (auth, workflow, security, validation, static, dev bypass incl. kill-switch + production hard-off)
- ✅ 28/28 browser end-to-end checks passing (headless Edge) + 32/32 bypass-on, 19/19 bypass-off
- ✅ Frontend deploys to GitHub Pages via GitHub Actions
- ⏳ API hosting + outbound SMS/email webhook still to be provisioned
