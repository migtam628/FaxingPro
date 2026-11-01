# FaxingPro — staging-only Google Drive disaster recovery rehearsal

This procedure is intended for a **different, trusted Linux staging machine**, not `mttech-vps` or any live FaxingPro server. It automates download of a selected encrypted Google Drive backup, authenticated archive verification, and an ephemeral **network-isolated** PostgreSQL/document restoration. It does not start FaxingPro API, send faxes, use active Telnyx credentials, open ports, alter production volumes, change Google Drive contents, or write a live API configuration.

The existing archive/backups can contain private fax data and credentials **even though the Drive files are age encrypted**. Use a trusted staging host with encrypted disk and tightly controlled administration. The age private identity **must remain off the fax VPS and out of GitHub Actions, chat and project files**. Downloaded encrypted archives are intentionally kept locally until the operator decides how to dispose of them.

## Preconditions

1. Provision a **separate** Linux staging server or a dedicated Linux VM on your Mac, with Docker Engine, Node.js 20+, `age`, `rclone`, `openssl`, GNU tar and sha256sum. Prefer an isolated VM or dedicated machine without production mounts or credentials.
2. On staging, authorize a **read-only** Google Drive rclone remote with access to `FaxingPro-Encrypted-Backups` (or use your own limited Drive authorization). You can call it `google:`; do not copy the VPS's `rclone.conf` or OAuth tokens.
3. Securely bring your **existing age private recovery identity** onto the separate trusted machine (never the fax VPS). Verify its permissions and keep an offline copy.
4. Clone the public FaxingPro repository on staging. **Do not copy production `.env` into the repository.** Avoid running `scripts/install-vps.sh` here, which is not needed for recovery rehearsal.
5. Check that no `/etc/faxingpro` production backup setup or `faxingpro-telnyx_fax_documents` Docker volume exists. The staging script refuses production-like markers.

## Phase 1 — Download a specific verified archive

On the staging machine only:

```bash
git clone https://github.com/migtam628/FaxingPro.git
cd FaxingPro

# Example snapshot already checksum-verified in Google Drive:
# choose the newest archive from the existing production backup ledger.
export FAXINGPRO_STAGING_DRIVE_REMOTE='google:FaxingPro-Encrypted-Backups'
bash scripts/faxingpro-staging-recovery.sh --fetch 20261031T071952Z /home/staging/faxingpro-dr
```

The directory must be absolute, distinct from the live VPS filesystem, and under a securely controlled staging account. The script refuses to overwrite a timestamp folder, transfers only `database.dump.age`, `documents.tar.age`, `config.env.age` and `SHA256SUMS`, compares them with Drive, and validates a strictly bounded SHA-256 manifest. No files are deleted or changed in Google Drive.

## Phase 2 — Validate all three encrypted archives (without restoring)

```bash
bash scripts/faxingpro-staging-recovery.sh --verify \
  /home/staging/faxingpro-dr/20261031T071952Z \
  /secure/offline/faxingpro-recovery-identity.txt
```

This checks full authenticated age decryption, `pg_restore --list`, document tar readability, and presence of the storage encryption key **without printing or saving the key**.

## Phase 3 — Disposable isolated database and document recovery

```bash
bash scripts/faxingpro-staging-recovery.sh --rehearse \
  /home/staging/faxingpro-dr/20261031T071952Z \
  /secure/offline/faxingpro-recovery-identity.txt
```

This restores PostgreSQL into a **new uniquely named Docker volume and container with `--network none`**, unpacks the encrypted document archive to another uniquely named disposable volume, checks fax record count, and decrypts a selected recovered encrypted PDF in memory. The test checks that the PDF authenticates under AES-256-GCM and begins with a valid PDF header; it does **not** inspect the complete document visually or compare an externally saved plaintext digest for this production backup.

On success or failure, the script removes **only its newly created temporary DB container and volumes**. The encrypted archives remain in the staging directory, untouched. It does not run an ATLAS web frontend, connect a Telnyx endpoint, or transmit a fax. The script does not produce a decrypted `.env` or PDF on disk.

## Record evidence and limits

Privately record snapshot timestamp, download and verify outcome, restoration outcome, approximate elapsed seconds, number of recovered fax records, staging environment, and the next remediation action. Do not put actual fax records, patient/customer information, API tokens, age key, rclone credentials or decrypted PDFs in reports.

A successful drill confirms basic restore of one real archived dataset and one sampled original PDF on staging. It **does not** prove every document is recoverable, every recovered fax status is valid, or that the complete application will start and work after a full production disaster. A subsequent separate ATLAS application-layer staging test is still needed. Regulatory compliance and retention policy review are also still outstanding.

The synthetic CI regression invokes this script only with an ephemeral age key and disposable fake data. CI **never** downloads or decrypts production Drive archives.
