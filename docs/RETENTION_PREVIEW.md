# ATLAS retention impact preview (read-only)

This is an **operator-only planning feature**, not an enabled retention policy. FaxingPro does not delete fax records, encrypted PDF files, database rows, backups, or Docker volumes as a result of a preview. No retention cleanup job or purge endpoint is provided.

## Use in ATLAS

Open **Backup & Recovery** and choose an age threshold of **30, 90, 180, 365, 730, or 1825 days**. The preview shows the number of fax records created before the cutoff, including:

- **Archived terminal** — archived records with status `received`, `delivered`, or `failed`.
- **Active terminal** — records in those same states that have not been archived.
- **Nonterminal** — any other status, including unknown, queued, or in-progress transmissions.
- **With documents** — records whose database entry references a stored document. This is a record count, not a verified filesystem inventory.

Counts can overlap across categories: document count is a subset of total and includes any status. The three status/archive categories partition the total. This preview does not verify legal retention obligations, actual document integrity, backup completeness, or delivery status.

## API and permissions

`GET /api/retention/preview?days=365` requires a valid **operator** session or operator bearer token. Read-only integration tokens are deliberately denied. `days` defaults to 365 when omitted; only the six listed integer values are accepted. Multiple `days` parameters, unsupported values, and non-GET methods are rejected.

The endpoint performs a parameterized PostgreSQL aggregate SELECT on `faxes.created_at`. It returns `readOnly: true`, `policyEnabled: false`, the selected days and cutoff, aggregate counts, and an explicit no-deletion notice. It does not persist a preference or update any record.

## Production prerequisites before enabling any future retention policy

A separate design and security review must address record holds, jurisdictional obligations, audit trails, document/backups consistency, explicit operator approvals, reversible staging, tested isolated restores, and nonterminal transmission exclusions. A later destructive implementation must **not** be inferred from this preview. No retention cleanup or deletion is authorized by this milestone.

## Verification

The isolated Telnyx CI smoke test exercises authentication (401), restricted token denial (403), invalid and duplicate age parameters (400), method rejection (405), synthetic records of different ages/statuses, and a before/after fax record comparison to prove preview reads do not mutate records. Production deployment and actual-record verification are separate operator-controlled steps.
