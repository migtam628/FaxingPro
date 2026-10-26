# Staged FreeSWITCH build (no live calls)

This directory contains a **build-only** FreeSWITCH image based on Debian 12 (Bookworm) that can run on the **Ubuntu 26.04** Docker host. It does not replace Ubuntu and does not affect existing MooBee containers.

**This is not a configured or deployable production fax engine.** Do not start the included vanilla PBX on the public network. No Telnyx SIP routing, DID-specific dialplan, media firewall, database, authenticated fax API, or hardened Event Socket exists yet.

## Why this approach

- Native `apt-cache policy freeswitch freeswitch-mod-spandsp` on Ubuntu 26.04 reported no candidates.
- The official FreeSWITCH Docker approach supports a Debian Bookworm base.
- SignalWire requires a personal access token to access official precompiled FreeSWITCH Debian packages. **Telnyx API keys and credits cannot replace this token.**
- The build uses BuildKit's **secret mount**, not `--build-arg TOKEN=`, and removes package authentication before ending its build step.

## Build safely

1. In your SignalWire account, create a **Personal Access Token** using the official instructions: https://signalwire.com/docs/platform/freeswitch/installing-freeswitch
2. Keep the token private.
3. On the VPS:

~~~bash
cd ~/FaxingPro
git pull --ff-only
bash scripts/build-freeswitch-image.sh
~~~

The script asks for the token without echoing it. Do not paste the token into chat, GitHub, terminal history, or a Docker command's build argument.

If the build succeeds, verify the binary image (still no SIP server running):

~~~bash
docker image ls faxingpro-freeswitch
docker run --rm --network none faxingpro-freeswitch:bookworm dpkg-query -W freeswitch-mod-spandsp
docker run --rm --network none faxingpro-freeswitch:bookworm sh -c 'command -v freeswitch'
~~~

If the repository returns HTTP 401/403, verify the SignalWire account, token access, and FreeSWITCH community package entitlements. If the Bookworm package name or availability changes, **stop rather than using older Debian/Ubuntu repos**. Do not bypass TLS verification.

## Later phases (not completed)

1. Stage a restricted FreeSWITCH configuration with unique admin/internal SIP credentials, Event Socket on loopback, no sample toll dialplans, and Sofia external profile on the agreed port.
2. Validate active SIP/media ports and restrict access using Telnyx's current signaling/media CIDRs (https://sip.telnyx.com/).
3. Attach the Telnyx DID **only once the inbound test path is ready**.
4. Verify a one-page inbound and outbound TIFF fax with protocol-confirmed success before enabling FaxingPro Send.
5. Build the authenticated persistent document/job API and private TLS frontend. Keep the public GitHub Pages site demo-only.

## Network observations from your VPS (Oct 26, 2026)

- Public IPv4 reported: `209.159.148.172`; confirm it is static with your VPS host.
- Existing public ports 80/443 are bound by MooBee Caddy; do not deploy another Caddy/Nginx on those ports.
- `127.0.0.1:8080` is a MooBee container, **not FaxingPro**.
- `127.0.0.1:8091` belongs to `moobee-fetch-web`; its UFW allow rule is broader than needed for a loopback-bound service.
- Host SIP ports 5060/5080 had no listeners at the time of inspection.
- The presence of Docker-published ports is not guaranteed to be fully described by `ufw status`; review Docker packet-filter rules before exposing SIP.

References:
- https://github.com/signalwire/freeswitch/blob/master/docker/README.md
- https://github.com/signalwire/freeswitch/blob/master/docker/master/Dockerfile
- https://signalwire.com/docs/platform/freeswitch/installing-freeswitch
