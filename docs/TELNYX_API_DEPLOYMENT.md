# FaxingPro v0.2: Telnyx Programmable Fax API Pilot

**Status:** Code is committed. The live backend is not deployed or linked to your Telnyx account. Outbound sending is OFF by default. Public GitHub Pages remains demo-only.

## Architecture and isolation

- Telnyx manages the fax calls, using its Programmable Fax Application. FreeSWITCH and SignalWire are not needed.
- The dedicated Docker Compose project is named faxingpro-telnyx, with isolated PostgreSQL 17 and persistent PDF volumes.
- The web UI binds ONLY to host loopback 127.0.0.1:8092. Postgres is not published.
- Existing MooBee services (Caddy 80/443, MooBee Nginx 8080, databases) are unchanged.
- Backend validates Ed25519-signed Telnyx webhooks and records unique webhook IDs.
- Received PDF URLs are downloaded into the dedicated volume; outbound PDFs use expiring HMAC-signed URLs.
- Outbound sending requires an explicit SEND_ENABLED=true and can reach only TEST_DESTINATION.

## 1. Prepare the VPS

~~~bash
cd ~/FaxingPro
git pull --ff-only
cp deployment/telnyx/.env.example deployment/telnyx/.env
chmod 600 deployment/telnyx/.env
~~~

Run openssl three times and use THREE DIFFERENT outputs:

~~~bash
openssl rand -hex 32
openssl rand -hex 32
openssl rand -hex 32
~~~

Put these in DB_PASSWORD, API_TOKEN and MEDIA_SIGNING_SECRET respectively. Use hex for DB_PASSWORD. Do not expose these or your Telnyx API key.

## 2. Configure Telnyx (do not reassign the DID yet)

1. In Telnyx Mission Control, open Programmable Fax → Applications and create FaxingPro-Production. Copy its Application ID to TELNYX_FAX_APP_ID.
2. Under API Keys, create an API V2 key. Save it on your VPS only as TELNYX_API_KEY.
3. Under account Keys & Credentials → Public Key, copy the Ed25519 webhook verification public key into TELNYX_PUBLIC_KEY.
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

Via your private HTTPS hostname, open ATLAS → Settings → API Connection. Use the same origin and your VPS API_TOKEN. Verify the dashboard changes from DEMO DATA to LIVE RECORDS and shows database counts.

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

This is a SINGLE-OPERATOR PILOT, not a certified production/healthcare platform. Missing protections include encrypted document storage at rest, robust authentication and MFA, user/role management, virus scanning, external durable job queues, retention and deletion policies, audited backup restoration, and security review.

Use nonsensitive test documents only. Keep .env, PostgreSQL and the PDF volume private. Do not store PHI or regulated documents here. Maintain off-host backups with secure access before real business use.

Logs: docker compose -f deployment/telnyx/compose.yaml --env-file deployment/telnyx/.env logs --tail=100 api
