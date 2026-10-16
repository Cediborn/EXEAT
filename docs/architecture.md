# Architecture

```
EXEAT/
├── index.html              # single app shell (hash-routed SPA)
├── config.js               # runtime API base URL (window.ENTRYOUT_CONFIG)
├── src/
│   ├── css/                # tokens → base → layout → components → pages
│   └── js/
│       ├── app.js          # boot, route table, auth guards, container mount
│       ├── router.js       # minimal hash router (?query supported)
│       ├── api.js          # fetch wrapper, ApiError, health probe
│       ├── auth.js         # session store, signIn/signOut, homeRouteFor
│       ├── validation.js   # pure client-side validation (mirrors server rules)
│       ├── dom.js          # h() hyperscript helper — no innerHTML anywhere
│       ├── components/     # shell, ui (toast/dialog/field), requestCard, timeline, passCard
│       └── pages/          # landing, signin, register, dashboard, apply, detail, staff, gate, admin …
├── backend/
│   ├── server.js           # entrypoint (reads .env)
│   ├── app.js              # express app: security headers, routes, static, SPA fallback
│   ├── config.js           # env + school policy settings
│   ├── db.js               # node:sqlite, auto-migrates on boot, seeds settings
│   ├── routes/             # auth, public, requests, staff, gate, admin, notifications
│   ├── middleware/         # errors, auth+csrf+audit, rate limits
│   ├── services/           # auth (scrypt), workflow (state machine), passes, notifications, validate
│   └── scripts/            # migrate, seed, reset-db
├── database/migrations/    # 001_init.sql (forward-only schema)
├── tests/                  # node:test suites (API + security + validation + static)
└── scripts/browser-e2e.mjs # headless-Edge end-to-end UI check over CDP
```

## Frontend

- **Vanilla ES-module SPA, no build step.** Hash routing (`#/app/requests/:id`) so the same files work on GitHub Pages without rewrite rules.
- All DOM is created with the `h()` hyperscript helper; **no `innerHTML`** — user/server data can never inject markup.
- Pages are plain functions returning nodes; `app.js#render()` wraps them in the shared `.container`, enforces auth + role guards, and handles route errors.
- API base: `window.ENTRYOUT_CONFIG.apiBase` from `/config.js` (`''` = same origin). The deploy workflow rewrites it when the `API_BASE_URL` repository variable is set.
- If `/api/health` is unreachable the shell shows a persistent, honest banner; nothing is faked.

## Backend

- **Express 5 + `node:sqlite` (`DatabaseSync`)** — zero native dependencies; migrations run automatically on boot (`database/migrations/*.sql`, tracked in `schema_migrations`).
- JSON-only API under `/api/*`. Unknown `/api` paths 404 as JSON (never fall through to the HTML shell). Any other unknown path serves `index.html`.

### Data model (tables)

`users`, `students`, `staff_assignments` (role↔house), `sessions`, `exeat_requests`,
`approval_records`, `passes`, `movement_events`, `notifications`, `notification_deliveries`,
`announcements`, `settings`, `audit_log`.

### Roles

| Role | Can | Cannot |
|---|---|---|
| `student` | create/track/cancel own requests, view own pass | see others' requests, approve anything |
| `housemaster` | view+decide requests for assigned house(s), search own house only | other houses, record gate movements |
| `senior` | decide external requests at the second stage, gate verify | housemaster-stage decisions on internal |
| `gate` | verify pass codes, record departure/return | view request reasons, approve |
| `admin` | users, settings, announcements | **approve/reject requests (enforced)** |

### Request state machine

```
pending ──approve──▶ pending_senior (external only) ──approve──▶ approved ──pass──▶ completed
   │                      │                                      │
   ├──reject──▶ rejected  ├──reject──▶ rejected                  ├──gate depart──▶ … ──gate return──▶ completed
   ├──return──▶ returned (student edits & resubmits → pending)
   └──cancel──▶ cancelled (anytime before a decision)
```

- Passes are issued **at approval** (12-char code, expiry = authorised return time, window = `depart_at − early_departure_minutes` … `expires_at + grace`).
- Gate responses identify the student and window but **never** include the private reason.

## Configuration

Everything is env-driven (`.env.example`): port, CORS origins, cookie security, session TTL,
enrolment code, school policies (notice window, max duration, grace, early departure),
and the optional outbound-notification webhook. Admin-editable policies live in `settings`.
