# FaxingPro · ATLAS

**Self-hosted fax management with live Telnyx transport, encrypted documents, and Google Drive recovery copies.**

[![Pages](https://github.com/migtam628/FaxingPro/actions/workflows/pages.yml/badge.svg)](https://github.com/migtam628/FaxingPro/actions/workflows/pages.yml)
[![Release](https://github.com/migtam628/FaxingPro/actions/workflows/release.yml/badge.svg)](https://github.com/migtam628/FaxingPro/actions/workflows/release.yml)
[![Backend](https://github.com/migtam628/FaxingPro/actions/workflows/telnyx-ci.yml/badge.svg)](https://github.com/migtam628/FaxingPro/actions/workflows/telnyx-ci.yml)

[**Public product website**](https://migtam628.github.io/FaxingPro/) · [**Desktop releases**](https://github.com/migtam628/FaxingPro/releases) · [**Telnyx deployment**](docs/TELNYX_API_DEPLOYMENT.md) · [**Google Drive backup guide**](docs/GOOGLE_DRIVE_BACKUPS.md)

> **Development status — ATLAS v0.6.** The API and ATLAS interface work with genuine stored fax records; there is **no demo dataset** in the live application. Real fax transmission requires your own running Telnyx account and self-hosted HTTPS VPS. This is still a **single-operator pilot**, not a multi-tenant or regulated-document-certified product. See [known limitations](#known-limitations).

![ATLAS visual concept](docs/images/atlas-dashboard.svg)

*Illustrative ATLAS design direction; the image is not a screenshot of real fax activity. The production interface displays only records received from the server.*

## Features

| Capability | Status | Implementation |
| --- | --- | --- |
| First-run setup wizard | Implemented | Operator authentication, Telnyx configuration checks and persistent workspace preferences |
| Inbound and outbound faxes | Implemented | Telnyx Programmable Fax API and signature-verified webhooks |
| Fax transmission safety | Implemented | VPS `SEND_ENABLED` and exact `TEST_DESTINATION` checks before sending |
| Inbox, Sent, Documents | Implemented | Genuine PostgreSQL records, status updates and searchable history |
| In-app PDF viewer | Implemented | Authenticated original PDF download/preview and browser printing |
| Encryption at rest | Implemented | AES-256-GCM document encryption in persistent Docker volume |
| Contacts | Implemented in v0.6 | Private PostgreSQL contact create, edit, search and delete |
| Read/unread and archive | Implemented in v0.6 | Database-backed inbound read state and reversible fax archive |
| Sessions and security history | Implemented | Seven-day secure cookie, failed-login throttling, session counts, revoke-all and operator audit |
| Encrypted local backups | Implemented | Streamed PostgreSQL, fax-volume and env archives encrypted to off-VPS age recipient |
| Google Drive backup integration | Implemented | rclone uploader, checksum comparison, offsite status and scheduled post-backup hook |
| Full disaster-recovery rehearsal | Operator action | Independently restore both DB and files on a separate isolated staging host |
| MFA, user roles, retention policy | Future work | Not ready for shared or regulated operations |

## Screens and workflows

ATLAS provides Dashboard, Inbox, Sent Faxes, New Fax, Contacts, Documents, Archive, Fax Numbers, Reports, Fax Transport, Queue, Security, Backup & Recovery, and Settings.

**Contacts:** Save a name, fax number (international E.164), optional email, company and notes. Selecting *Send fax* fills the compose recipient, but does **not** bypass the sending allowlist.

**Inbox:** New inbound records start unread. Opening the original fax marks it read. You can mark it unread again, archive it without deleting PDFs, restore it, or search by title, fax number, and transmission ID. API history searches return at most 250 rows per request; server pagination is available for extensions.

**Documents:** Original encrypted PDFs are decrypted by the authenticated API only when requested; the web app uses an ephemeral object URL for preview. Documents are not served directly from the host filesystem.

**Security:** A single operator signs in using `API_TOKEN` in a same-origin HTTPS session; invalid-token submissions are throttled and security events are recorded in PostgreSQL. Neither the bearer key nor the Google Drive private tokens should be committed to source control.

## Deployment: Docker and Telnyx

Requirements: Ubuntu or equivalent Docker host, Docker Compose, Telnyx Fax API credentials, public HTTPS reverse proxy, and secrets stored only in `deployment/telnyx/.env`.

~~~bash
git clone https://github.com/migtam628/FaxingPro.git
cd FaxingPro
cp deployment/telnyx/.env.example deployment/telnyx/.env
# Set strong unique secrets, Telnyx credentials, public HTTPS URL and DID.
# Do not commit or print the actual .env.
docker compose -f deployment/telnyx/compose.yaml \
  --env-file deployment/telnyx/.env up -d --build
curl -fsS http://127.0.0.1:8092/healthz
~~~

The compose stack runs `web`, `api`, and `db`; **the 8092 frontend port is bound to localhost by default** for use behind your existing HTTPS reverse proxy. All fax records and documents live in named persistent Docker volumes. An API rebuild should never destroy those volumes.

**On an existing VPS**:

~~~bash
cd ~/FaxingPro
git pull --ff-only
docker compose -f deployment/telnyx/compose.yaml \
  --env-file deployment/telnyx/.env up -d --no-deps --build api web
docker compose -f deployment/telnyx/compose.yaml \
  --env-file deployment/telnyx/.env restart web
~~~

> **Safety:** Do not run `docker compose down -v` or rotate `STORAGE_ENCRYPTION_KEY` unless you are performing a fully planned recovery or key migration. Rebuilding the API introduces additive contact and fax-state columns; it does not clear old transmissions. `SEND_ENABLED` and `TEST_DESTINATION` are deliberately not changed by application updates.

For complete Telnyx webhook and Caddy details, read [Telnyx deployment](docs/TELNYX_API_DEPLOYMENT.md).

## Public GitHub Pages site

**https://migtam628.github.io/FaxingPro/**

The [Pages workflow](.github/workflows/pages.yml) builds the public **product landing page**, accessible without private credentials. It presents the architecture, features and release links. Pages serves **static assets only** and does not connect to your fax API, collect operator credentials, or contain sample fax records.

Under GitHub repository Settings → Pages, select **Source: GitHub Actions**. The workflow runs on commits to `main`, validates Vite assets and deploys the `/FaxingPro/` project path.

## Desktop application: Windows, macOS and Linux

Visit [GitHub Releases](https://github.com/migtam628/FaxingPro/releases) for preview installer builds:

- **Windows** — NSIS `.exe`
- **macOS** — Intel and Apple silicon `.dmg`
- **Linux** — AppImage and Debian `.deb`

On first launch, enter your **existing self-hosted HTTPS FaxingPro server origin**, such as `https://fax.yourdomain.com`. The Electron shell opens that website in a sandboxed Chromium window. Its session cookies belong to your HTTPS server. The chosen URL is remembered locally (not the operator token); access can be revoked from ATLAS → Security.

The desktop installer **does not run PostgreSQL, Telnyx, or a fax gateway by itself**. Local `file://` authentication is not used. Preview installers are currently unsigned/unnotarized and automated updates are not configured; follow your OS security procedures and verify the release source.

You can build a local development copy with:

~~~bash
npm install
npm run build
npm run desktop
~~~

## Backup & Recovery

The system preserves three independent recovery components: **PostgreSQL database**, **AES-GCM encrypted PDF volume**, and **VPS encryption/configuration secrets**. The [Backup & Recovery runbook](docs/BACKUP_RECOVERY.md) uses an off-VPS `age` private identity to encrypt and validate archives. The optional [Google Drive integration](docs/GOOGLE_DRIVE_BACKUPS.md) uses rclone with your own Google OAuth app to upload encrypted archives, verify checksums and show per-snapshot offsite status.

**Important:** Google Drive verification proves the encrypted bytes matched at upload time; it is **not** an isolated restoration test. The Google Drive OAuth configuration and age private identity must never be committed or exposed in logs, screenshots or tickets. Scheduled backups do not delete old archives automatically; monitor storage growth.

## Development and CI

~~~bash
npm install
npm test
npm run build
npm run dev
~~~

| Workflow | Purpose |
| --- | --- |
| [Deploy ATLAS Website](.github/workflows/pages.yml) | Build/test static product landing page and publish GitHub Pages |
| [Validate Telnyx Fax Backend](.github/workflows/telnyx-ci.yml) | Node and API smoke tests, isolated Docker Compose, signed webhooks, database migrations, age backup, mocked Drive checks |
| [Build and Release](.github/workflows/release.yml) | Run tests; build Windows, macOS and Linux installers; publish preview release assets |

Deployment to your VPS remains **manual** and isolated from your other services: pushing to GitHub does not automatically restart your production FaxingPro containers.

## Known limitations

- Currently **single-operator**. MFA, separate user accounts and per-role authorization are not implemented.
- Outbound faxing is constrained to the configured test destination until a dedicated sender-safety rollout is approved.
- Contact changes are not automatically synchronized with Telnyx or external CRMs.
- Historical reports beyond aggregate counters, notifications, retention policies and controlled sending retries still need implementation.
- The public website and desktop installers are not themselves a fax service. The HTTPS VPS and Telnyx backend must be available.
- Document viewer and encrypted cloud backup are functional, but **independent restoration and security audits** remain outstanding before using this for regulated workflows.

## Documentation

- [Deployment and Telnyx API](docs/TELNYX_API_DEPLOYMENT.md)
- [Security and operator sessions](docs/SECURITY_SESSIONS.md)
- [PostgreSQL and encrypted document recovery](docs/BACKUP_RECOVERY.md)
- [Google Drive setup](docs/GOOGLE_DRIVE_BACKUPS.md)
- [Developer environment](docs/DEVELOPMENT.md)
- [System architecture](docs/ARCHITECTURE.md)
- [Published releases](https://github.com/migtam628/FaxingPro/releases)

---

**FaxingPro ATLAS** — self-hosted, operator-controlled fax operations.