# Signed Telnyx webhook reliability (ATLAS v0.8 hardening)

**Scope:** FaxingPro's existing single-operator Telnyx API. This hardening changes only how signed webhook events update fax rows and extends ephemeral CI verification. It does **not** enable sending, retry unknown submissions, alter production records, migrate tables, or change the encryption key.

## Event handling invariants

- The raw webhook body must pass Telnyx Ed25519 signature verification and timestamp checks before any fax database mutation.
- `webhook_events.id` is unique; a replay with the same event ID returns `duplicate:true` without reapplying the event.
- Unique but **older** signed events remain visible in the timeline but cannot regress status, inflate page counts, replace failure reasons, or trigger a new inbound media download.
- Once a fax is `delivered`, `received`, or `failed`, later events cannot replace its status **or its associated mutable event metadata**. Terminal results are deliberately conservative; a conflicting terminal event requires manual investigation.
- An event with a direction that does not match the existing fax row cannot change that row.
- A valid outbound `client_state` UUID may still establish the Telnyx ID for correlation without changing an already confirmed outcome.
- If the first inbound event is a terminal failure, its failure reason is captured on the initial insert rather than lost.
- Inbound PDF capture remains subject to the existing HTTPS host allowlist, size validation and AES-GCM encryption.

## What CI proves

`tests/telnyx-smoke.mjs` posts signed webhook fixtures to an isolated PostgreSQL-backed Docker Compose stack. It checks duplicate event IDs, out-of-order failure before receipt, terminal receipt followed by newer failure/progress, direction mismatch, unchanged page count and failure metadata, and a single receipt in the event timeline. The test's private signing key is ephemeral and never a production Telnyx key.

`tests/faxingpro-drive-ci.sh` additionally uses a **mock rclone remote** and a second synthetic encrypted backup snapshot. It forces checksum verification to fail, confirms the uploader exits nonzero, confirms the latest snapshot is `pending` and has **no offsite success row**, and then confirms a later successful verification can record the retry. No real Google Drive credentials or files are touched.

## Operator reconciliation still required

A Telnyx 202 response means only acceptance, **not delivery**. An HTTP timeout or unknown outcome may mean Telnyx accepted the fax; do not resubmit automatically. Review Telnyx activity and the signed event timeline first, then decide whether a new explicitly authorized submission is appropriate. `SEND_ENABLED` and `TEST_DESTINATION` remain the outbound safety gate.

These tests do not prove real-world provider ordering behavior, network resilience, complete restore drills, or automated alerting on failed local backups. The full #4 acceptance checklist remains open until independent restore and monitoring work passes.
