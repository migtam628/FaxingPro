# FaxingPro ATLAS — Easy Ubuntu VPS Installer

The downloadable **`faxingpro-install.sh`** is the guided installer for a new Ubuntu VPS. It detects Docker and Compose, safely generates four independent encryption/authentication secrets, deploys the web/API/PostgreSQL stack, and can optionally start its *own* Caddy HTTPS gateway. It is not a Windows/macOS GUI installer for a remote server; it runs in an SSH terminal on an Ubuntu host.

## One download and one setup command

Connect to a **new Ubuntu VPS** with SSH. If your shell user has sudo privileges:

~~~bash
curl -fsSLo faxingpro-install.sh \
  https://raw.githubusercontent.com/migtam628/FaxingPro/main/scripts/install-vps.sh

# Optional security step: inspect before running a root-owned script
less faxingpro-install.sh

sudo bash faxingpro-install.sh
~~~

Or download the same script, plus `SHA256SUMS`, from [the latest GitHub Release](https://github.com/migtam628/FaxingPro/releases). Check its SHA-256 value before executing, especially on production servers. The script is open source; do not run an unreviewed `curl | sudo bash` pipeline.

**Supported:** Ubuntu VPS with root/sudo access and an internet connection. A typical minimal dedicated server needs ports 80 and 443 available for automatic HTTPS, and a publicly resolvable subdomain. Existing Docker/Compose installations are reused without replacement.

## What the wizard asks for

1. **Public hostname** (for example `fax.company.example`). First create its A/AAAA record with your DNS provider so it resolves to the VPS; you control the domain.
2. **HTTPS mode.** `auto` deploys an isolated Caddy service that obtains HTTPS certificates if 80/443 are open. `existing` is for servers already running Caddy, Nginx, Traefik, MooBee or other sites; the installer never edits that proxy. `none` exposes only loopback and requires separate HTTPS setup.
3. **Telnyx Ed25519 public webhook key.** This is **required to start the API**, even with sending disabled. Copy the actual **32-byte Base64 or 64-character hex** public key from Telnyx Mission Control. Never substitute a fake key. No Telnyx secret is displayed on the screen.
4. **Optional Telnyx settings.** API v2 key (hidden input), Fax Application ID and purchased DID (`+1XXXXXXXXXX`). If omitted, API can start but the initial ATLAS gateway checklist cannot be completed; add missing values to the protected `.env` afterward.
5. **Confirm the install plan.** Secrets are generated locally, stored with owner-only permissions and never uploaded to GitHub. Outbound sending stays locked.

The installer keeps the React/nginx frontend bound to **127.0.0.1:8092** by default. PostgreSQL is not publicly exposed. It verifies `/healthz` before reporting success. On a standalone VPS, Caddy handles the public HTTPS hostname; confirm DNS and firewall reachability before entering the operator token.

## Install on a server that already hosts websites

Use the `existing` proxy mode to avoid port collisions and avoid touching other projects:

~~~bash
sudo bash faxingpro-install.sh --domain fax.example.com --proxy existing
~~~

The private web endpoint binds to `127.0.0.1:8092` on the host. Point your **existing host-level reverse proxy** to this local port, under the selected hostname. If the existing reverse proxy runs inside another Docker network, it **cannot** reach its own `127.0.0.1` to get to FaxingPro; connect the proxy to the dedicated `faxingpro-telnyx_default` Docker network and proxy to `faxingpro-telnyx-web-1:80`, or configure an explicit trusted host gateway.

**Do not remove or overwrite** your existing proxy configuration. FaxingPro will not automatically alter Caddy, MooBee, OpenResty or the host firewall.

## Update, check, and troubleshoot

After a normal fresh install under `/opt/faxingpro`:

~~~bash
sudo bash /opt/faxingpro/scripts/install-vps.sh --status
sudo bash /opt/faxingpro/scripts/install-vps.sh --update
~~~

The update pulls the latest `main` fast-forward and rebuilds **only the web and API**. It does not replace `.env`, drop PostgreSQL, delete fax documents, or restart other Docker projects. It preserves an installer-created Caddy container by using the recorded install profile.

If you originally installed the repo in another directory, pass `--dir /your/path`. For a pre-existing manually deployed FaxingPro stack, `--update --dir /existing/FaxingPro` updates only API/web, without creating any new proxy. **Back up the database and encrypted PDFs before major application updates.**

Check the host environment safely:

~~~bash
bash faxingpro-install.sh --check
bash faxingpro-install.sh --self-test
sudo bash /opt/faxingpro/scripts/install-vps.sh --status
sudo docker compose -f /opt/faxingpro/deployment/telnyx/compose.yaml \
  --env-file /opt/faxingpro/deployment/telnyx/.env logs --tail=60 api web
~~~

The actual install settings are written into `deployment/telnyx/.env` and a local, nonsecret `.install-profile`. Both are excluded from Git; the API token can be retrieved **privately on the server** using:

~~~bash
sudo grep '^API_TOKEN=' /opt/faxingpro/deployment/telnyx/.env
~~~

Only enter it on the **HTTPS host you control**, never GitHub Pages. Do not post it in public tickets or chat.

## Headless VPS provisioning (for advanced administrators)

Use your own secure environment delivery (not public shell history) and pass:

~~~bash
sudo --preserve-env=FAXINGPRO_TELNYX_PUBLIC_KEY,FAXINGPRO_TELNYX_API_KEY,FAXINGPRO_TELNYX_APP_ID,FAXINGPRO_TELNYX_FROM_NUMBER \
  bash faxingpro-install.sh --yes --domain fax.example.com --proxy auto
~~~

Required variable: `FAXINGPRO_TELNYX_PUBLIC_KEY`. Optional: `FAXINGPRO_TELNYX_API_KEY`, `FAXINGPRO_TELNYX_APP_ID`, `FAXINGPRO_TELNYX_FROM_NUMBER`. Prefer a protected provisioner or interactive prompt for actual Telnyx secrets. This is intended for new/dedicated servers, not repeated reinstallations.

## What is NOT one-click yet

- Creating your DNS A record and opening firewall/provider ports 80/443.
- Purchasing a Telnyx DID, linking the Fax Application, and configuring real signed webhooks.
- Enabling outbound sending: it deliberately stays `SEND_ENABLED=false` and `TEST_DESTINATION=` blank until your test is approved. Never bypass that restriction with an installer.
- Configuring an `age` recovery identity off the VPS, scheduling encrypted backups, connecting Google Drive OAuth, and performing full restore drills. Follow [Backup & Recovery](BACKUP_RECOVERY.md) and [Google Drive Backup Setup](GOOGLE_DRIVE_BACKUPS.md).

**Safety:** The installer refuses to overwrite an existing checkout or detected FaxingPro named volumes. It never calls `docker compose down -v`, deletes Caddy volumes or modifies existing site routing. Never use this MVP single-operator pilot for regulated/healthcare documents without production security review and complete disaster-recovery validation.

Reference: [Docker Engine Ubuntu install](https://docs.docker.com/engine/install/ubuntu/) and [Docker Compose plugin](https://docs.docker.com/compose/install/linux/).
