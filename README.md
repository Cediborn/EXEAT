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

## Configuration

Copy `.env.example` → `.env`. Everything (ports, CORS origins, cookie security, session TTL,
enrolment code, school policy defaults, notification webhook) is env-driven — see
[docs/deployment.md](docs/deployment.md) for the production checklist, including the
`API_BASE_URL` Pages variable that connects the hosted frontend to the API.

## Status

- ✅ 50/50 automated tests passing (auth, workflow, security, validation, static)
- ✅ 28/28 browser end-to-end checks passing (headless Edge)
- ✅ Frontend deploys to GitHub Pages via GitHub Actions
- ⏳ API hosting + outbound SMS/email webhook still to be provisioned
