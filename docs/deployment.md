# Deployment

Two independently deployable pieces:

| Piece | Where it runs | Trigger |
|---|---|---|
| Frontend (static SPA) | **GitHub Pages** via `.github/workflows/deploy-pages.yml` + **Vercel** (GitHub-connected, `vercel.json`) | push to `main` |
| API (Express + SQLite) | any Node ≥22.5 host (Render, Railway, Fly, VPS…) — *needs to be provisioned* | manual / host-native |
| CI | `.github/workflows/ci.yml` (tests on Linux, browser E2E on Windows) | push / PR |

## Frontend (GitHub Pages + Vercel)

Workflow stages a clean `dist/` (only `index.html`, `src/`, `public/`, generated `config.js`)
and deploys with the official Pages actions (OIDC — no tokens to store).

- Pages URL: `https://cediborn.github.io/EXEAT/`
- Vercel URL: `https://exeat-inky.vercel.app/`
- Hash routing means no 404/rewrite configuration is needed.
- **Demo mode is the shipped configuration**: both deploy pipelines write
  `demoMode: true, devBypassAuth: false` into the generated `config.js`, so every API call
  is served in-browser by the demo adapter (`src/js/demo/api.js`) from localStorage —
  no backend, no external auth, per-browser data. Nothing is ever faked invisibly: the app
  shows a "Demo mode" banner and a `Demo · <Role>` header badge.
- To wire a real backend instead: set `demoMode: false` and point `apiBase` at the API's
  public URL in the generated config (`deploy-pages.yml` printf / `scripts/vercel-build.mjs`),
  and set `API_BASE_URL` if you reintroduce a variable-driven `apiBase`.
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
3. Point the frontend at it: set `demoMode: false` + `apiBase` (see above) and push — both
   hosts redeploy.
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
