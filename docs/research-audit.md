# Research & audit — original Entryout site

Source audited: `https://entryout.netlify.app/` (static Netlify site, captured during the rebuild).

## What existed

Four static pages, no visible backend:

| Route | Purpose |
|---|---|
| `/` | Marketing homepage — hero, "how it works", feature highlights |
| `/internal` | Internal exeat flow explainer (within local area) |
| `/external` | External exeat flow explainer (outside local area) |
| `/announcement` | Announcements page |

Navigation: Home · Internal · External · Announcements.

## Verified product facts carried over

- **Approval chain:** internal exeat → Housemaster only; external exeat → Housemaster **and** Senior Housemaster.
- **Parents:** the site claims guardians are notified by SMS when a pass is approved.
- **Announcements (2 live at capture):**
  1. No exeats are to be granted during the mid-term examinations.
  2. External exeat requests need at least **24 hours' notice**.
- **Houses:** the eight real Mfantsipim School houses (Acquaah, Balmer-Acquaah, Cowey, Dilly, Halm-Addo, Odoi, Sarbah, Vidal) — preserved exactly in the rebuild.
- **Gate pass:** a printed/scannable pass is the end state of a successful approval.
- No authentication UI was reachable without credentials; no public API documentation.

## Problems found (and how the rebuild addresses them)

| Issue in old site | Rebuild response |
|---|---|
| Static only — forms could not actually submit | Full API-backed workflows (submit → approve → pass → gate depart/return) |
| No real sign-in, roles, or access control | Session auth with four roles; house-scoped staff visibility |
| "Class" dropdown contained garbage values (`S1`–`V2`, `MFS`, etc.) | Replaced with accurate `SHS 1/2/3` (documented change) |
| No parent/guardian data on requests | Guardian name/phone captured; required for external exeats |
| No audit trail | `audit_log` + `approval_records` for every state change |
| Announcements were free-text with no provenance | Announcement records with author + timestamps, served by the API |
| Passes were not verifiable at the gate | 12-character codes + QR (SVG) verified server-side, with movement log |

## Explicit non-goals

- No imitation of the old site's broken class dropdown.
- No demo/fake data in the UI: when the API is unreachable the app shows an honest banner instead.
- SMS/email sending is out of scope for the client; the API exposes a webhook hook (`NOTIFY_WEBHOOK_URL`) that a server-side provider integration can consume later.
