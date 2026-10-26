# FaxingPro

ATLAS — premium self-hosted fax management workspace.

> **Version 0.1: desktop/web UI foundation and self-hosted server starter.** No real PSTN/T.38 fax sending or receiving is enabled yet. All example faxes and volume metrics in the interface are clearly labeled as demo data.

## Supported interfaces
- Web application: React, TypeScript, Vite and ATLAS design system
- Desktop applications: Electron on Windows, macOS (Apple silicon + Intel) and Linux
- Server starter: Node.js HTTP API with bearer auth and explicit disabled fax transport
- Docker Compose: Nginx web frontend and private API service

## Quick start

```bash
git clone https://github.com/migtam628/FaxingPro.git
cd FaxingPro
npm install
npm run dev
```

For a local API + production-style web build:

```bash
cp .env.example .env
# Generate and set API_TOKEN with: openssl rand -hex 32
docker compose up --build -d
```

See [Developer Guide](docs/DEVELOPMENT.md) and [Architecture](docs/ARCHITECTURE.md).

## Desktop releases
[GitHub Actions](https://github.com/migtam628/FaxingPro/actions/workflows/release.yml) builds executables on Windows, macOS, and Linux runners. Successful builds from `main` publish preview assets to [GitHub Releases](https://github.com/migtam628/FaxingPro/releases), while tags beginning with `v` publish stable releases.

**Current limitations**: no actual phone-number provisioning, no external fax gateway, no document byte persistence, no production accounts, no live fax receipts. Do not use the v0.1 preview to transmit sensitive/regulated material.

## Design
ATLAS: midnight navy left navigation, cloud-white cards, teal actions, consistent document-focused views. Workspace pages include Dashboard, Inbox, Sent Faxes, Composer, Contacts, Documents, Numbers, Team, Reports, Fax Server, SIP/T.38, Queue, Security and Settings.

## Licensing
Copyright retained by project owner. Third-party dependencies remain under their respective licenses; evaluate telephony components' licenses before integrating them.
