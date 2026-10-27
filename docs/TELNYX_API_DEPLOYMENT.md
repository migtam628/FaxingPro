# FaxingPro v0.3: Telnyx API deployment and first-use wizard

**Status:** The existing installation at https://fax.mttechservicesllc.com has completed real inbound and outbound fax tests. This guide also covers new installations. The public GitHub Pages build is static and has no fake fax records or server backend.

## Architecture and isolation

- Telnyx manages the fax calls, using its Programmable Fax Application. FreeSWITCH and SignalWire are not needed.
- The dedicated Docker Compose project is named faxingpro-telnyx, with isolated PostgreSQL 17 and persistent PDF volumes.
- The web UI binds ONLY to host loopback 127.0.0.1:8092. Postgres is not published.
- Existing MooBee services (Caddy 80/443, MooBee Nginx 8080, databases) are unchanged.
- Backend validates Ed25519-signed Telnyx webhooks and records unique webhook IDs.
- Received PDF URLs are downloaded into an AES-256-GCM encrypted PDF volume; outbound PDFs use expiring HMAC-signed URLs. Protect and back up the separate storage encryption key.
- Outbound sending requires an explicit SEND_ENABLED=true and can reach only TEST_DESTINATION.

## Initial setup wizard (new in v0.3)

- On first opening your self-hosted HTTPS site, ATLAS checks for a valid operator session.
- If no session exists, **Step 1: Connect** asks for the existing VPS `API_TOKEN` once. The token is exchanged for a 7-day HttpOnly, Secure, SameSite=Strict cookie; browser localStorage is never used for API credentials.
- **Step 2: Check gateway** verifies the five required Telnyx environment settings: V2 API key, Fax Application ID, DID, webhook signing key and public HTTPS origin. Only presence/format status and the phone number are shown; secret values are never returned to the frontend.
- **Step 3: Workspace** records the workspace name and timezone in the existing PostgreSQL database. It does not change Telnyx credentials, billing, or dial restrictions.
- Finishing setup is **persisted on the server**. Reloads open the real dashboard, not the wizard. Existing received/sent faxes and encrypted PDFs remain intact.
- Contacts, fax number provisioning, unread tracking and multi-user accounts are not yet implemented. They show truthful empty/informational states instead of fictitious records.

### Upgrade a running FaxingPro installation

The following update leaves the dedicated PostgreSQL database, encrypted PDF volume and existing MooBee/Caddy services running:

~~~bash
cd ~/FaxingPro
git pull --ff-only
docker compose -f deployment/telnyx/compose.yaml --env-file deployment/telnyx/.env up -d --no-deps --build api web
curl -fsS https://fax.mttechservicesllc.com/healthz
~~~

**The wizard will appear once even on an existing installation** because completion tracking is newly introduced; it will not delete or reset fax history. Sign in with your current operator token, verify Telnyx settings, choose your workspace name and click Finish.

## 1. Prepare the VPS

~~~bash
cd ~/FaxingPro
git pull --ff-only
cp deployment/telnyx/.env.example deployment/telnyx/.env
chmod 600 deployment/telnyx/.env
~~~

Run openssl four times and use FOUR DIFFERENT outputs:

~~~bash
openssl rand -hex 32
openssl rand -hex 32
openssl rand -hex 32
openssl rand -hex 32
~~~

Put these in DB_PASSWORD, API_TOKEN, MEDIA_SIGNING_SECRET and STORAGE_ENCRYPTION_KEY respectively. Use hex for DB_PASSWORD. Do not expose these or your Telnyx API key.

## 2. Configure Telnyx (do not reassign the DID yet)

1. In Telnyx Mission Control, open Programmable Fax → Applications and create FaxingPro-Production. Copy its Application ID to TELNYX_FAX_APP_ID.
2. Under API Keys, create an API V2 key. Save it on your VPS only as TELNYX_API_KEY.
3. Under account Keys & Credentials → Public Key, copy the Ed25519 webhook verification public key into TELNYX_PUBLIC_KEY. The portal typically displays a Base64-encoded public key (44 characters ending in '='). The API now accepts Base64, hex, or PEM. This public key is not an API token; don't rotate it merely to set up FaxingPro.
4. Set your purchased DID in E.164 format (+1...) as TELNYX_FROM_NUMBER.
5. Choose an HTTPS hostname that you own, e.g. fax.example.com, and set TELNYX_PUBLIC_BASE_URL to that exact HTTPS origin. Replace the example value.
6. Connect the Fax Application to an Outbound Voice Profile. Limit destinations and expenditures for pilot testing.
7. Only after HTTPS and signature rejection are verified, set Telnyx webhook URL to https://YOUR-FAX-HOST/webhooks/telnyx and assign the existing DID to that Fax Application.

Official: https://support.telnyx.com/en/articles/4394516-configuring-programmable-fax-applications
Sending: https://developers.telnyx.com/docs/programmable-fax/send-a-fax-api
Receiving: https://developers.telnyx.com/docs/programmable-fax/receive-a-fax-api
Webhooks: https://developers.telnyx.com/docs/programmable-fax/receiving-webhooks

## 3. Start ONLY the separate FaxingPro Compose stack

~~~bash
docker compose -f deployment/telnyx/compose.yaml --env-file deployment/telnyx/.env config --quiet
docker compose -f deployment/telnyx/compose.yaml --env-file deployment/telnyx/.env up -d --build
docker compose -f deployment/telnyx/compose.yaml --env-file deployment/telnyx/.env ps
curl -fsS http://127.0.0.1:8092/healthz
~~~

Expected: transport telnyx-fax-api, faxEnabled false. That proves only database/API startup, not carrier connectivity.

## 4. Reuse MooBee's existing Caddy for HTTPS

DO NOT start a second proxy on ports 80/443 or overwrite the MooBee Caddyfile. Find its mounted configuration first:

~~~bash
docker inspect streamboss-server-caddy-1 --format '{{json .Mounts}}'
docker network ls --filter name=faxingpro-telnyx
~~~

The existing Caddy container cannot reach the host's 127.0.0.1:8092 through its own loopback. After backing up and reviewing its config, connect the Caddy container to the FaxingPro Docker network:

~~~bash
docker network connect faxingpro-telnyx_default streamboss-server-caddy-1
~~~

Add a NEW site block to the original Caddyfile, leaving every MooBee site intact:

~~~caddy
fax.your-real-domain.example {
    encode zstd gzip
    reverse_proxy faxingpro-telnyx-web-1:80
}
~~~

Configure DNS A to the VPS public IP 209.159.148.172. Reload Caddy using the EXISTING MooBee deployment procedure and verify TLS. For persistence across recreation, declare the external network in Caddy's original Compose file.

## 5. Validate webhook security before pointing the DID

~~~bash
curl -i -X POST https://fax.your-real-domain.example/webhooks/telnyx -H 'Content-Type: application/json' -d '{"data":{"event_type":"fax.received"}}'
~~~

Expected HTTP 401. Then use a real signed Telnyx test event and confirm its state appears in PostgreSQL. Telnyx webhook signing key is public; never substitute the Telnyx API secret.

## 6. Access private ATLAS and verify inbox

Via your private HTTPS hostname, open ATLAS → Settings → API Connection. Use the same origin and your VPS API_TOKEN, then select **Sign in & connect**. The server issues a 7-day `Secure; HttpOnly; SameSite=Strict` cookie backed by PostgreSQL; your raw API_TOKEN is cleared from the form and never saved to browser localStorage. Refresh the page or reopen the browser at the same hostname: the client calls `GET /api/session` to restore its live session automatically. The **Sign out** button revokes the session server-side. Use HTTPS; never sign in through the public GitHub Pages demo. If the API_TOKEN is rotated in your private `.env`, old sessions become invalid on API restart.

The login cookie uses the `__Host-` prefix and is explicitly marked Secure. Use the configured HTTPS hostname for the persistence feature; HTTP SSH tunnel browsers may reject Secure cookies. The legacy Bearer API_TOKEN header remains supported for controlled scripting and backwards-compatible clients. This is single-operator authentication, not multi-user login or MFA.

If the custom hostname is not ready, use a LOCAL SSH tunnel to view the site (Telnyx still needs public HTTPS for media/webhooks):

~~~bash
ssh -L 8092:127.0.0.1:8092 root@209.159.148.172
~~~

Open http://127.0.0.1:8092 on the computer where the tunnel is running and enter that exact URL in ATLAS API Connection. Never enter your operator token on the public GitHub Pages demo.

## 7. First real fax tests

1. With outbound still off, set the HTTPS webhook and route your DID to the Fax Application. Send a benign one-page inbound test fax. Confirm the PDF is saved and appears in ATLAS.
2. Specify a known, explicitly authorized US test number in TEST_DESTINATION.
3. Confirm public media URL reachability, Telnyx credits/permissions, Fax Application ID, profile, HTTPS certificate and call costs.
4. Only then set SEND_ENABLED=true, restart the FaxingPro Compose services, and submit one PDF from the private ATLAS UI.
5. Observe queued → sending → delivered or failed. A Telnyx 202 acceptance is NOT fax delivery.
6. If submission reports unknown/502, reconcile Telnyx activity BEFORE retrying. No automatic retries of potentially accepted outbound calls.

## 8. Security limits and production blockers

This is a SINGLE-OPERATOR PILOT, not a certified production/healthcare platform. Missing protections include managed encryption key rotation, robust authentication and MFA, user/role management, virus scanning, external durable job queues, retention and deletion policies, audited backup restoration, and security review.

Use nonsensitive test documents only. Keep .env, PostgreSQL and the PDF volume private. Do not store PHI or regulated documents here. Maintain off-host backups with secure access before real business use.

Logs: docker compose -f deployment/telnyx/compose.yaml --env-file deployment/telnyx/.env logs --tail=100 api
