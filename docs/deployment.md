# Deployment

Two independently deployable pieces:

| Piece | Where it runs | Trigger |
|---|---|---|
| Frontend (static SPA) | **GitHub Pages** via `.github/workflows/deploy-pages.yml` | push to `main` |
| API (Express + SQLite) | any Node ≥22.5 host (Render, Railway, Fly, VPS…) — *needs to be provisioned* | manual / host-native |
| CI | `.github/workflows/ci.yml` (tests on Linux, browser E2E on Windows) | push / PR |

## Frontend (GitHub Pages)

Workflow stages a clean `dist/` (only `index.html`, `src/`, `public/`, generated `config.js`)
and deploys with the official Pages actions (OIDC — no tokens to store).

- Site URL: `https://cediborn.github.io/EXEAT/`
- Hash routing means no 404/rewrite configuration is needed.
- **`API_BASE_URL` repository variable** (Settings → Secrets and variables → Actions →
  Variables): set it to the public base URL of the hosted API, e.g.
  `https://entryout-api.onrender.com`. The workflow writes it into `dist/config.js`.
  If unset, the site still runs but shows the "server not reachable" banner — by design,
  never fake data.
- GitHub Pages must be enabled with source **GitHub Actions** (done via
  `POST /repos/Cediborn/EXEAT/pages {"build_type":"workflow"}`).

## Backend (still to be provisioned)

No hosting credentials exist yet — this is the one **external dependency** left:

1. Provision any Node host, set `NODE_ENV=production`, `COOKIE_SECURE=true`,
   `API_PUBLIC_URL=<public URL>`, `ALLOWED_ORIGINS=https://cediborn.github.io`
   (plus your dev origins), `DATABASE_PATH` on a persistent volume, and
   `STUDENT_ENROLLMENT_CODE` to the school's code.
2. Start with `npm ci && npm start` — migrations run automatically on boot;
   `npm run seed` creates demo data (never run seed in production).
3. Set `API_BASE_URL` (step above) to that host's URL and push — Pages redeploys.
4. Point `NOTIFY_WEBHOOK_URL` at a provider forwarder (Africa's Talking / Twilio / Resend)
   if SMS/email alerts are wanted; in-app notifications work with no configuration.

### Local full-stack (already works today)

```bash
npm ci
npm run seed          # creates data/entryout.sqlite with demo accounts
npm start             # serves API + site on http://localhost:8787
```

### Verifying a deployment

```bash
curl -fsS https://cediborn.github.io/EXEAT/ -I                 # 200, text/html
curl -fsS <api>/api/health                                      # {"ok":true,...}
node scripts/browser-e2e.mjs https://cediborn.github.io/EXEAT   # frontend-only checks
```
