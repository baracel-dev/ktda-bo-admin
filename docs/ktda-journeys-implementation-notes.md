# KTDA journeys — implementation notes (back office)

Audience: the dev building the KTDA back office (`ktda-bo-admin`). This captures the four KTDA journeys,
what is **already built and live**, what **you build in the back office**, and the **backend contract**
each journey calls — including the backend work still outstanding, flagged clearly so nothing is assumed
done that isn't.

Last updated 2026-11-06.

---

## The model in one picture

A KTDA farmer has a **lifecycle**, and the key principle is that the **farmer record is created
separately from the wallet**:

```
  (1) REGISTERED                      (2) ACTIVATED                        funded
  basic details only       ──▶        farmer sets PIN         ──▶       wallet credited
  grower no, ID, name,                (self-onboard, app/web)            (bulk funding)
  phone, factory                      → KES wallet auto-created
  no wallet, no PIN                   → login usable
```

- **Journey 1 — Institution onboarding** (operator, back office): create the farmer *record* with basic
  details. **No wallet, no PIN yet.**
- **Journey 2 — Self-onboarding** (farmer, app/web — *not* the back office): a farmer who was registered
  in (1) sets their own PIN; **their KES wallet is created automatically** at that moment, and they can
  log in and see it.
- **Journey 3 — Bulk onboarding** (operator, back office): journey 1 for many farmers at once via CSV.
- **Journey 4 — Bulk funding** (operator, back office): credit many farmers' wallets from a CSV.

> **Why the split matters:** today's bulk flow fuses "create the farmer" and "open the wallet + a
> throwaway credential" into one step. The target model defers the wallet to self-onboard (journey 2).
> That changes what journeys 1 and 3 create, and makes journey 2 the point where the accounting wallet is
> opened. See **Backend work still outstanding**.

---

## Already built and LIVE (do not rebuild)

| Capability | Where | Status |
|---|---|---|
| Institution registry + scoping | omnichannel `GET /api/operator/institutions` | ✅ live. Every `/api/operator/*` call is scoped to the caller's institution (KTDA). |
| Bulk onboarding + bulk funding operator API | omnichannel `/api/operator/bulk-loads/*` | ✅ live, proven end-to-end in UAT (CSV → wallets + logins + profiles; funding reconciles to the cent). |
| Bulk UI (onboarding + payment) | `ktda-bo-admin/src/pages/ktda/BulkLoad.tsx` | ✅ built + deployed. |
| Farmer self-onboard / reset PIN | investor-api `/api/farmer/otp` + `/api/farmer/set-pin` | ✅ live (OTP dev-echo in UAT; grower number **required**). |
| Farmer app self-onboard wizard | `ktda-omnichannel-stub/apps/farmer-web` (Register) | ✅ wired + deployed (UAT `/farmerapp`). |
| KTDA back office | `ktda-bo-admin` | ✅ deployed UAT: `https://ktda-apps-lb-1116460916.us-east-1.elb.amazonaws.com/admin/` |

### How the back office reaches the backend (UAT)
- The box's nginx proxies the back office's calls over localhost (no CORS / no cert trouble):
  - `/admin/omni/*` → omnichannel `:8087` — **the proxy injects `X-Dev-Institution` (KTDA) and
    `X-Dev-Subject` itself**; never send institution/subject from the browser. The subject is the
    signed-in operator the app names in `X-Operator-Subject` (else the shared `ktda-operator`).
  - `/admin/tok/*` → the accounting engine `:8086/api/*` (sign-in / session).
- So from your code, call `/<base>/omni/api/operator/...` and `/<base>/tok/api/...`. The institution
  scoping is handled for you by the proxy.

---

## Back-office build checklist (what YOU build in `ktda-bo-admin`)

The back office owns the **operator** journeys (1, 3, 4). Journey 2 is the farmer app (`farmer-web`), not here.

- [ ] **Institution label** — read `GET …/omni/api/operator/institutions`, show the one KTDA entry (name).
- [ ] **Journey 1 — Register farmer (single)**: a form (grower no, national ID, name, phone, factory) → the
      single-register endpoint *(pending backend — see reference)*. Success → farmer in *Registered* state.
- [ ] **Farmers list/search** with lifecycle state (Registered → Activated → Funded) *(needs the backend
      state field — pending)*. This is where operators see who still needs to self-activate.
- [ ] **Journey 3 — Bulk onboarding**: `BulkLoad.tsx` (flow `ONBOARDING`) — upload → process → poll →
      counts. **Already built**; keep.
- [ ] **Journey 4 — Bulk funding**: `BulkLoad.tsx` (flow `PAYMENT`), gated on `…/bulk-loads/onboarding-status`.
      **Already built**; keep.
- [ ] **Always call through the proxy** (`/<base>/omni/...`, `/<base>/tok/...`). **Never** send
      `X-Dev-Institution` / `X-Dev-Subject` from the browser — the proxy sets them. Don't choose the
      institution client-side; it's fixed to KTDA by the deployment.

Everything below is the detail behind each item.

---

## Journey 1 — Institution onboarding (single farmer)  **← new back-office UI**

**Operator action:** register one farmer with basic details. No wallet, no PIN.

**UI to build (back office):** a "Register farmer" form:
- grower number (required, unique within KTDA), national ID, full name, phone (E.164 / KE mobile), factory.
- On submit → one API call; show success + the farmer's state = *Registered (awaiting activation)*.
- A farmers list/search (by grower no / name / phone) showing lifecycle state
  (Registered → Activated → Funded) — this is also where you'll link bulk runs.

**Backend contract — NOT YET BUILT (proposed; confirm with backend before wiring):**
```
POST /admin/omni/api/operator/farmers        (omnichannel operator; scoped to KTDA)
  body: { growerNo, nationalId, fullName, phone, factory }
  → creates the farmer RECORD only: accounting investor (no wallet) + a claimable login (no PIN).
  → idempotent on growerNo. 409 if the grower already exists with a different identity.
```
Until this exists, the single-farmer register has no endpoint — journey 1 can only be done in bulk
(journey 3) with the current flow. **Do not point the form at the bulk endpoint**; wait for the single
endpoint, or (interim) submit a 1-row CSV through the bulk path knowing it currently also opens the wallet.

---

## Journey 2 — Self-onboarding (farmer; app/web)  **← farmer-web, not the back office**

Documented here for context/dependencies; **you do not build this in the back office.**

- Farmer must already be **Registered (journey 1/3)**.
- Flow (farmer-web Register wizard): phone → OTP → **grower number** → set PIN → signed in.
- Backend (live): `POST /api/farmer/otp {phone}`; `POST /api/farmer/set-pin {phone, otp, pin, grower}` —
  resolves the account by `inv_ktda_<grower>`, verifies the OTP'd phone is the one registered to that
  grower, sets the PIN, signs in.
- **Wallet auto-creation at this step is the target behaviour but is NOT built yet** — today the wallet is
  pre-created by the bulk flow. See **Backend work still outstanding**. The back office's farmers list
  should reflect "Activated" once a farmer has set their PIN (and "wallet opened").

**Back-office dependency:** the farmers list should show which registered farmers have self-activated, so
operators can chase the rest. Expose this from the farmer record's state.

---

## Journey 3 — Bulk onboarding (CSV)  **← back office (already have BulkLoad.tsx)**

**Operator action:** upload a CSV to register many farmers at once (the bulk form of journey 1).

**UI:** `BulkLoad.tsx` already implements this (flow = `ONBOARDING`): upload → process → poll → counts +
reconciliation. Keep it; just align the **CSV columns** and copy with the register-only semantics once the
backend split lands.

**Backend contract — LIVE (current behaviour):**
```
POST   /admin/omni/api/operator/bulk-loads/upload   (multipart: file, flow=ONBOARDING, institutionId, currency)
POST   /admin/omni/api/operator/bulk-loads/{id}/process
GET    /admin/omni/api/operator/bulk-loads/{id}                 (poll; status COMPLETED/PARTIAL/FAILED + counts)
GET    /admin/omni/api/operator/bulk-loads/{id}/reconciliation
GET    /admin/omni/api/operator/bulk-loads                      (recent runs)
GET    /admin/omni/api/operator/bulk-loads/onboarding-status?institutionId=…   (gate for funding)
```
- Onboarding CSV columns **today**: `grower_no,national_id,full_name,msisdn`.
- **Today it creates investor + KES wallet + a claimable login per farmer** (farmer later sets PIN via
  journey 2). Under the target split it should create the **record only**; the wallet moves to journey 2.
  Treat the CSV + endpoint as stable; the *semantics* (wallet now vs at self-onboard) are the backend
  decision below.

---

## Journey 4 — Bulk funding (CSV)  **← back office (BulkLoad.tsx)**

**Operator action:** credit many farmers' wallets from a CSV.

**UI:** `BulkLoad.tsx` flow = `PAYMENT`. Gated: funding is refused (409) until an onboarding run has
COMPLETED for KTDA — use `GET …/bulk-loads/onboarding-status`.

**Backend contract — LIVE:** same `/bulk-loads/*` endpoints with `flow=PAYMENT`.
- Payment CSV columns: `grower_no,amount_kes,payment_ref` (`payment_ref` is the per-row idempotency key;
  amount < 1,000,000 approval threshold).
- **Credit-only:** a grower with no wallet is counted as a failure (never silently created) — so funding
  requires the wallet to exist. Under the target split, that means a farmer must have **self-onboarded**
  (wallet opened) before they can be funded, OR bulk onboarding must open the wallet. **This is the main
  reason the wallet-timing decision below matters.**

---

## Omnichannel operator API — reference

All paths are `/api/operator/*` on omnichannel. From the back office you call them **through the proxy**
as `/<base>/omni/api/operator/*` (the proxy adds the institution + subject headers; never send them from
the browser). All are **scoped to the caller's institution (KTDA)** — a run/record for another
institution is 404/403. Content type JSON unless noted.

### Institutions
```
GET /api/operator/institutions
→ 200 [ { "id": "2d878f14-…", "name": "KTDA", "localCurrency": "KES", "country": null, "status": "ACTIVE" } ]
```
In the dev profile this returns exactly the caller's one institution. Use it to label the UI.

### Bulk onboarding / funding

**1. Upload (stage a run)** — `multipart/form-data`:
```
POST /api/operator/bulk-loads/upload
  parts: file=<csv>,  flow=ONBOARDING|PAYMENT,  institutionId=<uuid>,
         institutionName=<string, optional>,     currency=KES
→ 202  BulkRun (status RUNNING, nothing processed yet)
   409  if flow=PAYMENT and no onboarding run has COMPLETED for the institution
   400  empty file
```

**2. Process (start the durable run)**:
```
POST /api/operator/bulk-loads/{runId}/process   → 200 BulkRun
```

**3. Poll** (every ~1s until a terminal status):
```
GET /api/operator/bulk-loads/{runId}            → 200 BulkRun
```

**4. Recent runs** / **5. Reconciliation** / **6. Funding gate**:
```
GET /api/operator/bulk-loads                                         → 200 [ BulkRun, … ] (latest 50)
GET /api/operator/bulk-loads/{runId}/reconciliation?expectedTotal=   → 200 BulkReconciliation
GET /api/operator/bulk-loads/onboarding-status?institutionId=<uuid>  → 200 { "onboardingCompleted": true|false }
```

**`BulkRun`** (poll this; terminal = COMPLETED | PARTIAL | FAILED):
```json
{ "runId":"…", "flow":"ONBOARDING", "institutionId":"2d878f14-…", "currency":"KES",
  "sourceName":"farmers.csv", "status":"RUNNING",
  "totalRows":0, "processedCount":0, "skippedCount":0, "failureCount":0, "totalAmount":0.00,
  "startedAt":"…Z", "completedAt":null, "message":null }
```
`processedCount` = wallets opened (ONBOARDING) / credited (PAYMENT); `skippedCount` = already applied
(idempotent re-run); `failureCount` = rejected rows; `message` = human summary on completion.

**`BulkReconciliation`** (the proof panel, to the cent):
```json
{ "runId":"…", "flow":"PAYMENT", "institutionId":"…", "institutionName":"KTDA", "status":"COMPLETED",
  "walletCount":123, "processedCount":123, "skippedCount":0, "failureCount":0,
  "creditedTotal":1234567.89, "depositDebitTotal":1234567.89, "depositCreditTotal":1234567.89,
  "doubleEntryBalanced":true, "expectedTotal":1234567.89, "matchesExpected":true }
```

**CSV formats:** ONBOARDING `grower_no,national_id,full_name,msisdn` · PAYMENT
`grower_no,amount_kes,payment_ref` (header row required; `payment_ref` is the idempotency key).

### SAP payment file and maker-checker (journey 4) — tokenization-omnichannel PR #98 (not merged yet)

The back office follows #98's contract (BulkLoadDtos, BulkLoadOperatorController, ErrorCode) and
feature-detects it from the answers, so an omnichannel without it keeps today's behaviour.

```
POST /bulk-loads/upload          + period=YYYY-MM (optional; else read from the file name, KTDA_GL_2026_10_….csv)
     PAYMENT → 202 status SUBMITTED   · 409 DUPLICATE_FILE (message names the earlier run)
     400 BAD_FILE (header, or a SAP file with no period) · 413 FILE_TOO_LARGE (omnichannel 200 MB; UAT nginx 100 MB)
POST /bulk-loads/{runId}/process → PAYMENT: 409 RELEASE_REQUIRED (other flows start here as before)
POST /bulk-loads/{runId}/release → 200 RUNNING · 403 MAKER_CHECKER (the uploader) · 409 not waiting for release
GET  /bulk-loads/{runId}/exceptions → text/csv line_no,grower_no,name,pay_to,amount_kes,code,reason (SAP runs; 409 otherwise)
```

- **Run fields** (`BulkRunResponse`): `submittedBy, submittedAt, releasedBy, releasedAt, fileSha256, fileFormat`
  (`"SAP"` or null), `period`, `payableCount/payableAmount` (WALLET lines that pass: what the run credits),
  `routedCount/routedAmount` (BANK/SACCO lines: not paid to wallets by this run), `heldCount/heldAmount`,
  `heldCodes` (`"E01_MALFORMED=1,E03_DUPLICATE=2"`). The reconciliation carries the same SAP fields.
  A run with held lines ends `PARTIAL`; one with no wallet line ends `FAILED` at upload.
- **Browser check:** the SAP file is checked first with the KTDA back office's rules (`src/lib/file-rules.ts` +
  `bulk-file.ts`, copied verbatim from `baracel/ktda` apps/backoffice-web; run in a worker by
  `src/lib/sapPaymentFile.ts`), the same six rules omnichannel applies (E01, E03, E04, E07, E08, E09; neither
  checks the register). It shows to wallets / bank-SACCO / held, counts by rule, an exception CSV in
  omnichannel's columns, the pay period (from the name, or a month picker), and an optional `<file>.control.json`
  (lines, total, SHA-256; a mismatch blocks Submit). Files over 100 MB are refused before upload.
- **Expected total** sent to the reconciliation = `payableAmount` from omnichannel, or the browser's own
  wallet-line sum (integer cents) where omnichannel sends none (the plain file: rows that will be credited).
- **Maker-checker:** the uploader sees Release disabled with the reason; a different signed-in operator releases.
  A SAP file on an omnichannel whose run has no `fileFormat` is stored but not started.
- **Ledger refusals** (accounting tokenization-project#52, passed on by omnichannel #98 commit 9ffefef):
  `refusedCount`/`refusedAmount` on the run and the reconciliation, and `matchRule` on the reconciliation; the
  core's `matchesExpected` is posted + already applied + refused == expected. The result shows refused lines as
  their own total, apart from held and bank/SACCO, with a "Refused lines" download from
  `GET …/bulk-loads/{runId}/rows?outcome=REFUSED` with `Accept: text/csv`
  (`lineNo,grower_no,payment_ref,amount,outcome,reason`; JSON pages of ≤100 otherwise; 404 when the run has not
  reached the ledger or the core keeps counts only). Refused lines are also in `/exceptions` as `LEDGER_REFUSED`.
  Without the fields the page reconciles as before. omnichannel also sends `warningCount` (W01, paid) and
  `checksNotRun` (e.g. E05), shown under its check of the file.
- **Payment issues:** `GET /payments/issues` has the kind `PAYOUT_UNCONFIRMED` (a payout still PENDING with no
  gateway answer after `PAYMENT_UNCONFIRMED_AFTER`, 30 min). Token console → Transactions → Issues shows it as
  "may or may not have been paid: check with the gateway first" with Confirm sent (`POST /payments/{id}/confirm-sent`
  `{receipt}` → SENT) and Confirm not sent (`/confirm-not-sent` `{note}` → FAILED, then a PAYOUT_FAILED to retry or
  resolve), each behind a confirmation dialog with the text required; no Retry (omnichannel refuses one, 409).
- **Farmers:** state `CLASH` (phone already another farmer's login) with `clashReason`; `/farmers/summary` has
  `clash`. The Farmers page has a Clash tab where omnichannel counts them; a registration run's result and the
  journey page link to it.
- **Who acts:** every omnichannel call carries `X-Operator-Subject: staff:<email>`; the UAT nginx forwards it
  as `X-Dev-Subject` (see deploy/README.md). UAT-only; production uses real staff tokens.

### Single-farmer register (journey 1) — PROPOSED, not built
```
POST /api/operator/farmers   { growerNo, nationalId, fullName, phone, factory }
→ 201 { growerNo, status:"REGISTERED", … }   (idempotent on growerNo; 409 on identity clash)
```

### Farmer self-service (journey 2) — investor-api, used by the FARMER APP, not the back office
```
POST /api/farmer/otp      { phone }                         → { ok:true, devCode?:"123456" }  (devCode only outside prod)
POST /api/farmer/set-pin  { phone, otp, pin, grower }       → { ok:true, tokens:{accessToken,…}, investor:{id:"inv_ktda_<grower>"} }
     404 grower not registered · 409 grower registered to a different phone · 401 bad OTP
```
Listed for completeness; the back office doesn't call these.

### Error envelope (all services)
```json
{ "timestamp":"…Z", "status":409, "error":"Conflict", "message":"…human text…" }
```
Show `message` to the operator; branch on `status`.

---

## Backend work still outstanding (flag to the backend team)

The target model needs these; **they are not built yet** and the back office UI for journey 1 (and the
exact journey-3 semantics) depend on them:

1. **Single-farmer register** — `POST /api/operator/farmers` (basic details, no wallet, no PIN), scoped to
   KTDA, idempotent on grower number.
2. **Split "create investor" from "open wallet" in accounting** — today `wallet-loads?mode=CREATE` opens
   the investor **and** the `CASH-KES` wallet. Need: create investor (registered, no wallet); and a
   separate "open wallet for grower" used by journey 2.
3. **Wallet auto-creation at self-onboard** — investor-api `set-pin` (or omnichannel) must, on first PIN
   set, trigger accounting to open the farmer's `CASH-KES` wallet if it doesn't exist.
4. **Farmer lifecycle state** exposed to the back office (Registered / Activated / Funded) for the
   farmers list.

**Open decision (needed before the above is designed):** where the journey-1 record lives (accounting
investor without a wallet, vs investor-api, vs omnichannel), and whether **bulk onboarding (journey 3)
opens wallets immediately** (so funding can run before farmers self-activate) or **defers every wallet to
self-onboard** (then funding only reaches activated farmers). Recommendation: journey 3 opens wallets in
bulk (keeps funding operable), journey 1-single defers to self-onboard; journey 2 opens the wallet
idempotently if not already there. Confirm with the product owner.

---

## UAT wiring reference

- Back office (this app): `…/admin/` on the shared ALB `ktda-apps-lb`. nginx `:8185` on the box; proxies
  `/admin/omni`→omni:8087 (injects KTDA `X-Dev-Institution` + static `X-Dev-Subject`), `/admin/tok`→engine:8086.
- Farmer app: `…/farmerapp/` (nginx :8186; forwards the *farmer's own* `X-Dev-Subject`).
- KTDA institution id (UAT accounting core): `2d878f14-0d76-4aa0-b9d7-ffe4ace1562e`.
- omnichannel in UAT runs its **dev profile**: operator identity comes from `X-Dev-Subject` +
  `X-Dev-Institution` (both set by the proxy). **Security:** this leaves the operator surface open to
  anyone who reaches the URL — acceptable for UAT only; production uses the secured profile + real staff
  JWTs, at which point the proxy stops injecting a static subject.
- The back-office pipeline needs repo secret `UAT_EC2_SSH_KEY` on `baracel-dev/ktda-bo-admin` (not set yet;
  the current UAT instance was deployed out-of-band). Set it to enable `deploy-ec2.yml`.
```
