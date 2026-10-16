# Testing

Four layers, all runnable locally with **no extra services**:

```bash
npm test                      # 1) API + security + validation + static suites (node:test)
node scripts/browser-e2e.mjs  # 2) full browser end-to-end (headless Edge + CDP)
```

The E2E script expects the API on `http://localhost:8787` (`node backend/server.js`).

## 1. API / workflow suite (`tests/*.test.js`)

`node --test "tests/**/*.test.js"` — each suite boots an **ephemeral server on a random port
with a throwaway SQLite file** (`tests/setup-env.js` sets this before anything else), so tests
are parallel-safe and never touch `data/entryout.sqlite`.

| File | Covers |
|---|---|
| `auth.test.js` | login success/failure without leaking which field was wrong, `/me`, logout, 401s, registration + duplicate rules |
| `workflow.test.js` | full internal flow submit → housemaster approve → pass issued → gate depart → return → completed; external second (senior) stage; reject; return-for-correction + resubmit; cancel; idempotent resubmission; 24-hour notice; expired pass; notifications |
| `security.test.js` | IDOR on request ids, self-approval, CSRF rejection, house scoping, admin-cannot-approve, gate privacy, pass-code guessing, students cannot record movements, settings endpoint cannot change statuses |
| `validation.test.js` | pure server rules: required fields, return-after-departure, past departure, max duration, urgent-only-for-medical, trimming/lengths, date parsing, phone/email |
| `static.test.js` | app shell served, correct content types, API never falls through to HTML, backend/env files never served as code, security headers, **every frontend file parses as valid JS** |

## 2. Browser end-to-end (`scripts/browser-e2e.mjs`)

Launches Edge headless with the Chrome DevTools Protocol (no npm deps — Node's built-in
WebSocket) and drives the real UI:

landing (desktop + mobile, 375px overflow check) → student sign-in → dashboard →
empty-form validation → submit request → sign out → housemaster sign-in → queue →
approve via confirm dialog → pass issued → student sees pass + QR → sign out →
gate sign-in → verify code inside its window → record departure → "already departed" →
activity log → announcements → how-it-works → 404 → role-bounce check (`/gate` session
cannot open `/#/admin`).

Run: `node scripts/browser-e2e.mjs [baseUrl]` — prints `PASS/FAIL` per check and exits
non-zero on failure. Screenshots land in `%TEMP%/entryout-e2e/*.png` for visual review.

## 3. Static analysis

`static.test.js` syntax-checks all of `src/js/**` via `node --input-type=module --check`,
which is how frontend regressions are caught without a linter dependency.

## Conventions

- Assertions are specific (state, privacy, headers) rather than "did not throw".
- No test depends on wall-clock tricks beyond each suite's own fixtures.
- Known limitation: the in-memory rate limiter is per-process — tests that intentionally hit
  login limits restart isolation via separate ephemeral servers.
