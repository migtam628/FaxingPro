# FaxingPro ATLAS — opt-in master Bearer API_TOKEN lockdown

This milestone closes the **legacy master Bearer-token bypass** for the single operator **only when deliberately enabled**. It complements the existing TOTP authenticator challenge. It is **disabled by default** and does not introduce named users, recovery codes, user roles, or multi-tenant authorization.

## Modes

| OPERATOR_BEARER_MODE | New browser login | Master Authorization: Bearer API_TOKEN | Read-only `fpx_` tokens |
| --- | --- | --- | --- |
| `legacy` (default) | API_TOKEN; TOTP if configured | Full operator access (legacy bypass) | Existing read-only scope checks |
| `disabled` | API_TOKEN **and configured TOTP** | HTTP 403 on protected API routes | Existing read-only scope checks |

When `disabled`, a valid session cookie issued with the **current** TOTP secret is required for operator API access. A supplied master Bearer header is **always rejected**, even if the request also carries a valid cookie. Existing sessions that do not have a matching TOTP-assurance fingerprint are rejected until the operator signs in again. Insecure or mistyped modes fail API startup instead of silently re-enabling master Bearer access. The API also refuses to start with `disabled` unless `OPERATOR_TOTP_SECRET` is configured. `GET /healthz` and signed Telnyx webhooks do not change their authorization behavior.

This does not eliminate **all** single-factor uses: integration tokens remain intentionally scoped, read-only API credentials; Telnyx signed media URL access is governed separately. One master operator identity still exists, and secure enrollment/recovery and individual accounts remain future requirements.

## Preflight and careful rollout on your production VPS

**Do not execute this procedure until you have verified the off-VPS age recovery identity, a valid recent backup, the exact TOTP authenticator, and working SSH access.** This changes how operator scripts authenticate and can interrupt integrations. Keep a VPS root console open for rollback. No secret should be pasted into chat, GitHub Issues, CI, or logs.

1. Update your checkout without deploying, review the change, and inspect the configuration **without printing secrets**:

   ~~~bash
   cd ~/FaxingPro
   git pull --ff-only
   git log -1 --oneline
   sudo bash scripts/faxingpro-backup-health.sh --check
   grep -q '^OPERATOR_TOTP_SECRET=[A-Z2-7]\{32\}$' deployment/telnyx/.env && echo 'TOTP configured' || echo 'TOTP missing or invalid'
   grep '^OPERATOR_BEARER_MODE=' deployment/telnyx/.env | sed 's/=.*/=<redacted>/'
   ~~~

2. First enroll/test the TOTP authenticator as described in [OPERATOR_TOTP.md](OPERATOR_TOTP.md). If that is not already done, enable it **without changing bearer mode yet**, privately verify a successful browser login, then return to this step.
3. Inventory scripts and integrations calling the protected API using the master `Authorization: Bearer API_TOKEN` header. Such requests will stop working in strict mode. Prefer existing scoped `fpx_` integration tokens for supported read-only endpoints; browser operator tasks must use a TOTP-assured cookie. Do not put operator cookies in environment files or unattended scripts.
4. In a protected console, edit only `deployment/telnyx/.env`, setting exactly one `OPERATOR_BEARER_MODE=disabled` line while retaining the existing TOTP secret and every other key. Review the edit without displaying private values.
5. Recreate **only** the API container after staging or backup checks:

   ~~~bash
   docker compose -f deployment/telnyx/compose.yaml \
     --env-file deployment/telnyx/.env up -d --no-deps --build --force-recreate api
   curl -fsS https://fax.mttechservicesllc.com/healthz
   ~~~

6. Use a **private browser window** on your normal HTTPS FaxingPro site, enter the operator token and current 6-digit code, and verify inbox access, PDF preview and Security status. Security must show master Bearer **Disabled**, browser TOTP enabled, and `operator-session-required` scope. Inspect `docker compose ... logs api` for errors without posting credentials.
7. Verify your known existing master-token API scripts now receive HTTP 403 and migrate them before depending on strict mode. Do **not** send fax requests to test this.

## Recovery / rollback

If browser TOTP login fails, recover from your root console. Safely set `OPERATOR_BEARER_MODE=legacy` and recreate only the API container; this explicitly **re-enables single-factor bearer administrator access**, so only use it for controlled recovery and audit the reason. If the TOTP clock is incorrect, correct it (`timedatectl`) rather than changing server time unexpectedly. If the authenticator secret is lost, use the protected secret escrow/recovery process described in [OPERATOR_TOTP.md](OPERATOR_TOTP.md); do not post the secret externally.

Never change `STORAGE_ENCRYPTION_KEY`, Telnyx settings, or database volumes as part of auth rollback. This project does not provide a self-service web recovery bypass.

## Verification and limits

Synthetic CI validates default backward compatibility, configured TOTP session challenges, strict-mode denial of privileged master bearer calls (including a request with a valid cookie), rejection of legacy sessions without TOTP assurance, and continued isolation of read-only integration tokens. CI never touches a real fax, production DB, user TOTP or Google Drive credentials. Actual production strict-mode deployment remains **operator action**. This is single-operator hardening, **not** finished independent user identity, per-role authorization, formal MFA recovery, or regulatory certification.
