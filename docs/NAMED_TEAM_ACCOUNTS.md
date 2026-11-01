# FaxingPro ATLAS — named team accounts and role-based access

This milestone extends the existing single-owner pilot with **administrator-provisioned named accounts**, each using an independent high-entropy generated password **plus mandatory TOTP**. Every named account is stored in the existing PostgreSQL database. Roles are enforced by the backend, not only by ATLAS navigation.

## Supported roles

| Action | Administrator | Operator | Viewer |
| --- | --- | --- | --- |
| Read inbox, reports, contacts, fax PDFs and events | Yes | Yes | Yes |
| Send a fax (still subject to existing Telnyx allowlist) | Yes | Yes | No |
| Mark read/archive or edit contacts | Yes | Yes | No |
| Manage API tokens, users, backups, security and setup | Yes | No | No |
| Disable/enable, change roles and rotate another member's credentials | Yes | No | No |

The owner authenticated with the original `API_TOKEN` is an administrator. In default `OPERATOR_BEARER_MODE=legacy`, that secret still authorizes master bearer API calls; deploy the optional [master Bearer lockdown](MASTER_BEARER_LOCKDOWN.md) only after verifying an operator TOTP and a tested recovery procedure. Named accounts cannot use that master Bearer credential.

## Creating a team member

1. On the HTTPS self-hosted ATLAS interface, sign in as owner or a named administrator, then open **Team Members**.
2. Enter a name and email, choose `viewer`, `operator`, or `admin`, and create the member.
3. The server generates a **unique 32-character password** and a 160-bit Base32 authenticator key. Both appear in the administrator's browser **once**. Store them in a secure password manager and transfer them privately (not via a public issue, chat message, email thread or GitHub).
4. The recipient selects **Named team account** on the sign-in screen, enters their email, generated password and TOTP code from a trusted authenticator. TOTP uses six digits, SHA-1, 30-second steps.
5. The browser receives a secure, HttpOnly, same-origin session cookie for up to seven days. The password and TOTP are not stored in browser localStorage.

The database stores a salted `scrypt` password hash and the authenticator key encrypted with the existing server-side `STORAGE_ENCRYPTION_KEY`. The API never exposes the stored hash or encrypted key in list responses. Rotating the document encryption key without a planned re-encryption procedure can break team sign-in as well as document access; do not change it casually.

## Updating or disabling members

The administrator can change a member's role or disable their account. Role changes take effect on the next request. Disabling deletes all sessions tied to that account immediately. The API also checks the account's active state on every request, not only when a browser first signs in. The UI prevents an administrator from changing their own role or disabling themselves.

The **Rotate credentials** action generates a replacement password and TOTP key, resets the TOTP replay state, revokes every existing member session, and displays replacement credentials once. This is the supported administrator-assisted recovery path when an authenticator is lost. There is currently no user self-service password change or invitation email.

## Safe rollout

A Git pull or new GitHub Release does not automatically deploy to your VPS. On `mttech-vps`, verify recent offsite backup health, a working owner login, available Docker capacity and no active fax processing before a controlled update. The current deployment uses the existing `/root/FaxingPro` checkout, `deployment/telnyx/.env`, Postgres and persistent encrypted document volumes.

```bash
cd /root/FaxingPro
git pull --ff-only
sudo bash scripts/faxingpro-backup-health.sh --check
docker compose -f deployment/telnyx/compose.yaml --env-file deployment/telnyx/.env config --quiet
# Once the health check and owner recovery are confirmed, at a maintenance window:
docker compose -f deployment/telnyx/compose.yaml --env-file deployment/telnyx/.env up -d --no-deps --build api web
curl -fsS https://fax.mttechservicesllc.com/healthz
```

This updates the API and static web app without deleting volumes. A database schema extension occurs when the API starts. The update briefly recreates containers; it is **not guaranteed zero downtime**. For a production disaster, verify recovery using the separate [offsite staging rehearsal](STAGING_RECOVERY_REHEARSAL.md).

## What remains

This is the **first named-user RBAC milestone**, not a completed regulated multi-tenant deployment. It does not yet provide email invitations, SSO, password self-service, per-fax ownership segregation, some operational event categories and complete per-user historical attribution, enforceable record retention policies or independent user data isolation. All users in a role see the same workspace's faxes. Existing integrations use independent read-only `fpx_` API tokens. Owners should configure secure HTTPS, rate limiting, recovery and outbound fax permissions before shared use.

CI tests use disposable users, passwords, TOTP keys and Docker volumes. No real customer account is created by a repository update.
