# Development and Deployment

## Requirements
- Node.js 22+, npm.
- For desktop packaging: Windows, macOS, or Linux (GitHub Actions automates each OS).
- Docker Engine and Compose for self-hosted web and API.

## Local web client
```bash
npm install
npm run dev
```
Visit http://localhost:4173. The UI includes visibly synthetic demo records and local draft metadata.

## Electron on local computer
Terminal 1: `npm run dev`
Terminal 2: `FAXINGPRO_DEV_URL=http://localhost:4173 npm run desktop`
On Windows PowerShell, use `$env:FAXINGPRO_DEV_URL='http://localhost:4173'; npm run desktop`.

To create desktop packages locally: `npm run build && npm run dist`.

## Self-hosted UI + API
```bash
cp .env.example .env
# edit .env: change API_TOKEN to output of: openssl rand -hex 32
docker compose up --build -d
```
Web at http://127.0.0.1:8080 (host-local only); Node API on the private Compose network.
Deploy HTTPS via Caddy or another secure reverse proxy before enabling access beyond the machine. Never publish port 8080 broadly without TLS.

The API refuses to start with a short secret and refuses to enable a fax transport that has not been implemented. Configure 'API Connection' in the app using the HTTPS server address and API_TOKEN to perform a health check. Cross-origin API calls require ALLOWED_ORIGINS to explicitly permit the requesting origin (for file:// Electron this may be the string 'null' but enabling null origins has security implications; production should use a dedicated authenticated intermediary).

## HTTP endpoints
- `GET /healthz` (unauthenticated transport status)
- `GET /api/capabilities` (requires Bearer API_TOKEN)
- `GET /api/faxes` (requires Bearer API_TOKEN; empty until persistent storage implemented)
- `POST /api/faxes` (requires Bearer API_TOKEN; currently always HTTP 503 by design)

## GitHub Actions release flow
Every main push runs tests, builds installers on three operating systems and, **only if all package jobs succeed**, creates a versioned preview release (v0.1.0-preview.<run_number>). A pushed tag matching `v*` builds a stable release. Pull requests validate and build artifacts but do not publish releases.

GitHub repo > Actions > Build and Release for logs and temporary artifacts. GitHub repo > Releases for the downloadable installers:
- Windows x64 NSIS `.exe`
- macOS x64 and arm64 `.dmg`
- Linux x64 `.AppImage` and `.deb`

Binaries are unsigned initially: Windows SmartScreen and macOS Gatekeeper may warn. Code signing/notarization are separate launch requirements.

## Release security
Use GitHub's Actions workflow permissions to allow contents:write for release creation. Keep signing keys, SIP credentials and carrier secrets out of Git. Tagged stable releases should be cut only after test verification and actual end-to-end fax transport validation.
