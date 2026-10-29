# FaxingPro — Operator login security and session management

## Current single-operator protections

The self-hosted backend exchanges the existing `API_TOKEN` for a server-side session in PostgreSQL and sends it as an HttpOnly, Secure, SameSite=Strict cookie with a maximum lifetime of seven days. Session IDs are stored as SHA-256 hashes in the database, and are not saved to browser localStorage.

Invalid JSON login attempts to `POST /api/session` are now counted in a **rolling 15-minute window** in PostgreSQL. The eighth and subsequent invalid submissions return HTTP 429 and a `Retry-After: 900` response. **A correct operator token remains usable during throttling**, to prevent an external attacker from permanently locking out the operator. This is a conservative, instance-wide limit: the existing reverse-proxy chain does not yet provide a verified, spoof-resistant individual source IP to the API. This mechanism is *not* full per-IP abuse mitigation; use a managed edge/WAF and monitoring for additional controls.

The backend records login successes, the first eight failures in each window, logout events, and bulk session revocation in an `operator_security_events` table. Audit data does not contain raw tokens or client IP addresses.

ATLAS → **Security** now shows active browser session counts and the latest security events, and includes an explicit confirmation step for **Sign out all sessions**. This revokes all database-backed sessions (including your current browser) and requires the existing `API_TOKEN` to sign in again. Automation scripts using the API_TOKEN as a Bearer token remain authorized; revoke or rotate that secret separately when needed.


## API Token Manager (read-only integration credentials)

Open **ATLAS → Security → API tokens** while signed in as the primary operator. This is a separate feature from the `.env` master `API_TOKEN`.

1. Choose a descriptive name (for example `Reports dashboard`), read-only scopes, and 7/30/90-day expiration.
2. Click **Generate read-only token**. Copy the `fpx_...` credential **once** and save it in your private password manager. Do not paste it in chat, CI logs, browser developer console or source control.
3. Supply the token only as `Authorization: Bearer fpx_...` when calling your trusted HTTPS FaxingPro host. The token's scope is checked on every request, and use updates `last_used_at`.
4. Later, use **Revoke** in ATLAS. Revocation immediately disables that integration token. Creation and revocation are auditable operator events. An expired token is unusable even before it is deleted.

| Scope | Allowed GET operations |
| --- | --- |
| `faxes:read` | `/api/faxes`, `/api/stats`, `/api/faxes/:id/events` |
| `contacts:read` | `/api/contacts` |
| `reports:read` | `/api/reports/daily` |

Integration tokens never authorize document/PDF decryption, editing contacts, sending faxes, downloading backups, managing keys, changing settings, or logging in to ATLAS. Every token has a random 32-byte secret with a `fpx_` prefix; the database saves its SHA-256 hash only. List responses show metadata and a partial prefix, never the original secret. There are at most 10 concurrently active tokens.

**Administrator-only operations**: `GET /api/tokens` lists token metadata; `POST /api/tokens` creates a token once and returns the original secret in that one response; `DELETE /api/tokens/:id` revokes it. Mutating API-token requests require the `X-FaxingPro-Action: token-manager` header, to add an anti-CSRF barrier for browser sessions. The backend rejects unauthorized origins. If an `Authorization` header explicitly supplies an integration token, the server will not escalate it using a simultaneously present operator cookie.

**Master administrator token rotation** remains a VPS-only operation. Example for an existing installation in `~/FaxingPro`:

~~~bash
cd ~/FaxingPro
openssl rand -hex 32
# Privately store the new value and replace only API_TOKEN in the protected .env.
sudo nano deployment/telnyx/.env
docker compose -f deployment/telnyx/compose.yaml \
  --env-file deployment/telnyx/.env up -d --no-deps --force-recreate api
curl -fsS https://fax.mttechservicesllc.com/healthz
~~~

Changing the master token invalidates existing browser sessions because session validation checks its fingerprint. **It does not delete or rotate previously generated integration tokens**—revoke those individually if compromise is suspected. Changing `STORAGE_ENCRYPTION_KEY` is a separate, potentially destructive recovery-key migration and must never be used as a routine login-token rotation.

**Current limitations:** No MFA, individual named user accounts, delegated write scopes, automatic secrets rotation, or per-user role assignments. This remains a single-operator pilot. A full production deployment requires layered edge/rate protections, audit retention, tested recovery and a security review.

## Deploy the update

In `root@mttech-vps`:

~~~bash
cd ~/FaxingPro
git pull --ff-only
docker compose -f deployment/telnyx/compose.yaml --env-file deployment/telnyx/.env up -d --no-deps --build api web
docker compose -f deployment/telnyx/compose.yaml --env-file deployment/telnyx/.env restart web
curl -fsS https://fax.mttechservicesllc.com/healthz
~~~

The migrations add two small tables (`operator_login_failures`, `operator_security_events`) without deleting existing fax rows, encrypted document storage, backups, or active operator sessions. The API restart is brief; sending rules remain enforced by `SEND_ENABLED` and `TEST_DESTINATION`.

## Important limitations and next steps

- This remains a **single-operator pilot**, not a ready-made multi-user or regulated-document application. Individual accounts and MFA have not been implemented.
- The global failed-login window is not a substitute for IP-aware edge restrictions, brute-force monitoring, or DDoS resistance.
- The audit table records only bounded failed-login events during a throttle window and needs retention/alerting as the project grows.
- The seven-day cookie sessions are bearer-like credentials and need normal browser hardening, revocation, and TLS.
- Offsite Google Drive archives should be confirmed separately by checking ATLAS → Backup & Recovery, downloading an encrypted backup to a trusted device, and validating its decryption. A Drive upload record proves only that the encrypted archive matched at upload time; it does not prove a full restore.
