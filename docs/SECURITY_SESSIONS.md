# FaxingPro — Operator login security and session management

## Current single-operator protections

The self-hosted backend exchanges the existing `API_TOKEN` for a server-side session in PostgreSQL and sends it as an HttpOnly, Secure, SameSite=Strict cookie with a maximum lifetime of seven days. Session IDs are stored as SHA-256 hashes in the database, and are not saved to browser localStorage.

Invalid JSON login attempts to `POST /api/session` are now counted in a **rolling 15-minute window** in PostgreSQL. The eighth and subsequent invalid submissions return HTTP 429 and a `Retry-After: 900` response. **A correct operator token remains usable during throttling**, to prevent an external attacker from permanently locking out the operator. This is a conservative, instance-wide limit: the existing reverse-proxy chain does not yet provide a verified, spoof-resistant individual source IP to the API. This mechanism is *not* full per-IP abuse mitigation; use a managed edge/WAF and monitoring for additional controls.

The backend records login successes, the first eight failures in each window, logout events, and bulk session revocation in an `operator_security_events` table. Audit data does not contain raw tokens or client IP addresses.

ATLAS → **Security** now shows active browser session counts and the latest security events, and includes an explicit confirmation step for **Sign out all sessions**. This revokes all database-backed sessions (including your current browser) and requires the existing `API_TOKEN` to sign in again. Automation scripts using the API_TOKEN as a Bearer token remain authorized; revoke or rotate that secret separately when needed.

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
