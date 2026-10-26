# FaxingPro Architecture & Integration Roadmap

## Current v0.1 deliverables
- ATLAS React/Vite client with Dashboard, Inbox, Sent, Composer, Contacts, Document Viewer, Numbers, Reports, and administrative screens.
- Electron desktop shell (sandboxed, no Node integration).
- Express-free minimal Node HTTP API starter with explicit bearer authentication, health check, capability reporting, and safe rejection of outbound fax requests.
- Dockerized API and web reverse proxy.
- GitHub Actions tests, build matrix, and Release assets.

## Deliberate boundaries
**No live fax delivery, no receiving, no persistent attachments, no user login, and no production database in v0.1.** All displayed sample records are visibly marked as demo data. Local draft metadata only is stored in localStorage; attachment bytes are not stored. Sending always stays disabled until a tested gateway reports enabled.

## Target self-hosted topology
Browser / Electron -> TLS reverse proxy -> API + auth + PostgreSQL -> Redis / job workers -> FreeSWITCH + SpanDSP -> SIP provider (T.38 preferred with G.711 fallback) -> PSTN. Received documents -> fax processor -> private encrypted object storage -> inbox.

## Planned phases
1. Replace preview data with authenticated real API resources, PostgreSQL migrations, durable object storage and audit history.
2. Integrate FreeSWITCH using its event socket over an isolated private connection. Configure SIP trunk, RTP port ranges, codecs, T.38 negotiation and timeout behaviour. Implement fax result reconciliation and idempotent jobs.
3. Add inbound DID routing, TIFF/PDF conversion, OCR, attachments, cover-sheet generation, receipts and fault-tolerant retries.
4. Add scoped multiuser and multi-tenant permissions, encrypted-at-rest storage, secret management, rate limiting and retention controls.
5. Add real operational dashboards and monitoring, delivery evidence, backup restoration testing, code-signing and app auto-update.

## Important safety rules
- Never report a fax as delivered when it has merely been submitted. Only report confirmed receipt after fax protocol success.
- Never make SIP credentials or PSTN routing publicly accessible.
- Validate file type using file signatures on the server, scan uploads, isolate converters, and cap document size.
- Validate E.164 destinations, outbound dial permissions and cost limits before offering real transport.
- In production, require HTTPS; prevent browser token storage; implement session management, MFA and per-user authorisation.
- All managed medical data must undergo separate regulatory/privacy assessments.
