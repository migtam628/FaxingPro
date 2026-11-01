# FaxingPro — opt-in browser-session TOTP hardening (not full MFA)

This feature adds an optional RFC 6238 SHA-1 six-digit TOTP challenge to **browser cookie session issuance**. It is **disabled by default**. It does not add named user accounts, password recovery codes, role-based access controls or complete MFA protection.

**Critical limitation in the default legacy configuration:** `Authorization: Bearer API_TOKEN` retains full operator privileges without TOTP. This is an administrative bypass unless the separately opt-in [master Bearer lockdown](MASTER_BEARER_LOCKDOWN.md) is enabled. In lockdown, privileged master-bearer API requests are rejected and old sessions without matching TOTP assurance are invalidated. Full user-account MFA, individual identity management, role controls and account recovery remain future work. Scoped read-only `fpx_` integration tokens are unchanged.

## Enabling deliberately on the existing VPS

1. Obtain a local console/SSH session on your own `mttech-vps`. Ensure the host clock is synchronized (`timedatectl`) and you know the current master `API_TOKEN` without exposing it in logs or chat.
2. Generate a fresh secret **locally** using the Node script supplied in the repository (no external QR code service):

   ~~~bash
   cd ~/FaxingPro
   node --input-type=module -e "import {generateTotpSecret} from './server/operator-totp.mjs'; console.log(generateTotpSecret())"
   ~~~

   Save the new secret in a password manager and manually add it to a trusted authenticator app as a **time-based 6-digit SHA-1 code, 30-second period**, account `FaxingPro operator`. Do not use a third-party QR generator, expose the secret via screenshots or paste it into chat. Treat it as a second privileged secret.
3. Privately edit `deployment/telnyx/.env`, adding `OPERATOR_TOTP_SECRET=YOUR_GENERATED_BASE32_SECRET` as a single line (unquoted uppercase Base32, 32 characters for the generated 160-bit key). Do not replace `API_TOKEN`, `STORAGE_ENCRYPTION_KEY` or Telnyx keys.
4. First verify backup/Drive health, then recreate only the API service to load the new environment:

   ~~~bash
   docker compose -f deployment/telnyx/compose.yaml --env-file deployment/telnyx/.env up -d --no-deps --force-recreate api
   curl -fsS https://fax.mttechservicesllc.com/healthz
   ~~~

5. Reopen the self-hosted HTTPS site in a **private browser window**. The sign-in screen should request your master operator API_TOKEN and a six-digit authenticator code. Verify successful sign-in and sign-out before revoking existing sessions. The code is never persisted in browser localStorage.

Do **not** enable this automatically when pulling or deploying updates. This is an operator-controlled security rollout and changes the sign-in process. If the operator loses access to the authenticator, recovery requires secure VPS administrator access to the protected `.env`; it cannot be performed from the web UI.

## Security behavior and guardrails

- New browser sessions require both API_TOKEN and a current or adjacent 30-second TOTP code (±1 step clock drift). A successful time step is recorded atomically in PostgreSQL and cannot be replayed to issue another session, even across API instances. Wrong codes consume the existing rolling login-failure budget.
- The database stores only a fingerprint of the configured TOTP key and the last accepted time step. The secret stays in the protected `.env` and is included only in the already age-encrypted backup config archive; do not put it in GitHub Actions, issues or chat.
- Removing TOTP while `OPERATOR_BEARER_MODE=disabled` is set makes API startup **fail closed**; follow the trusted [lockdown rollback procedure](MASTER_BEARER_LOCKDOWN.md) and explicitly restore legacy mode first if recovery is unavoidable.
- Existing 7-day cookies remain compatible in legacy mode. Lockdown rejects sessions that lack current TOTP assurance. The API reports `browser-session-only` for legacy mode or `operator-session-required` for lockdown, without implying named-user MFA.
- Optional lockdown now mitigates the master Bearer bypass for new requests. Full production identity protection still requires multiple named accounts, role-scoped credentials, reliable enrollment/recovery and independent security review.

## Test evidence

`tests/operator-totp.test.mjs` validates RFC 6238 public SHA-1 vectors, strict key formatting and time-window handling. `tests/telnyx-totp-smoke.mjs` runs **only on disposable CI credentials**, configures a test-only secret, checks rejected missing/invalid codes, successful cookie issuance, atomic replay rejection, logout, and explicitly asserts that legacy Bearer API_TOKEN remains a bypass. The main Telnyx CI remains isolated with sending disabled.
