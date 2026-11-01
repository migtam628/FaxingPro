# FaxingPro ATLAS — actor-attributed operational audit (first milestone)

This feature extends the existing `operator_security_events` ledger to record a durable actor context and target object identifier on selected successful security and workspace actions. The event feed is visible to administrators on **Security & Sessions**.

## Recorded fields

`event_type`, `created_at`, `actor_kind` (`owner`, `team`, `system`, or `integration`), optional `actor_user_id` and `actor_role`, optional `target_type` and `target_id`. The Security API joins the current team-user display name for presentation. If a user no longer exists, a generic former-member label is shown. No passwords, authenticator seeds, API tokens, fax phone numbers, emails, document bytes, or request payloads are written to this ledger.

New fields are added by idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` migrations on API startup; existing rows remain and are classified `system` / unknown (they **cannot** be retroactively attributed).

## Recorded event categories

- Owner and named team successful sign-ins and sign-outs, alongside already-existing failed/replay login events.
- Team account provisioning, role changes, enable/disable and password/TOTP rotation; the target is the member UUID.
- Integration API token create/revoke (token UUID only); global browser-session revocation.
- Contact creation, edits, and deletion (contact UUID only).
- Fax read/unread and archive/unarchive actions, and the creation of an outbound submission record (fax UUID only). **A submission record is not proof of delivery.** The existing Telnyx status/webhook verification remains authoritative.

All these events are generated only after authorization, and selected mutation events are recorded on successful database writes. The read-only security feed returns up to the 50 newest events, ordered newest first. It is not intended as a bulk forensic export.

## Safety boundaries

This is **partial operational audit coverage**, not a tamper-proof or fully compliant audit trail. Administrators still control the PostgreSQL database and can affect records. No independent write-once storage, retention expiry, cryptographic sealing, SOC 2/HIPAA audit certification, complete actor tagging on every read/view, full provider-side fax history, or SIEM integration is implemented. System/background-origin events intentionally remain `system`. Anonymous failed sign-in attempts are not attributed to a claimed username/email; doing so would allow spoofed actor attribution.

The existing owner API_TOKEN still works in legacy bearer mode, and actions from that credential are recorded as `owner`, not an individual named employee. Strict bearer lockdown can be activated separately after private operator preflight.

## Rollout and verification

After PR CI passes and changes are merged, update your VPS only with a working owner recovery method and verified recent local/Google Drive backups. No live secrets belong in GitHub or chat. On an operator-approved maintenance update, the API creates additive columns and the web interface displays the new fields. The data and backup volumes must never be removed as part of deployment.

Verify a named user can sign in; an administrator can view **Security & Sessions**; and newly generated team-account or contact events display the correct actor. Avoid sending a real fax merely to test the event ledger. Use the synthetic integration test in CI for fax submission and existing Telnyx protection tests.

The next audit phases should include immutable/remote event delivery, separate roles for security officers, broader read-access accounting, tamper detection, retention, and reliable event exports.
