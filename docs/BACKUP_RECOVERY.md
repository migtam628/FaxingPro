# FaxingPro v0.4 — Backup & Recovery Runbook

FaxingPro has **three essential recovery components**: the PostgreSQL database, the `fax_documents` Docker volume containing AES-GCM-encrypted original PDFs, and the `STORAGE_ENCRYPTION_KEY` in the VPS `deployment/telnyx/.env` file. A database dump alone cannot recover documents.

## 1. Generate recovery keys on another computer

On a separate trusted computer, install [age](https://github.com/FiloSottile/age) and run:

~~~bash
age-keygen -o faxingpro-recovery-identity.txt
~~~

Write down the PUBLIC recipient starting with `age1`. Store the PRIVATE identity outside the VPS in a tightly access-controlled offline location with a redundant copy. **Never put the age private key or decrypted fax secrets in GitHub, chat, or on your fax VPS.** Losing this identity makes the encrypted backup unreadable.

## 2. Create an encrypted local backup

On the VPS, install `age`:

~~~bash
sudo apt-get update
sudo apt-get install -y age
cd ~/FaxingPro
git pull --ff-only
~~~

Update the FaxingPro API to v0.4 before backing up, because the backup script records success in its `backup_runs` database table.

~~~bash
export FAXINGPRO_AGE_RECIPIENT='age1YOUR-REAL-PUBLIC-RECIPIENT'
bash scripts/faxingpro-backup.sh
unset FAXINGPRO_AGE_RECIPIENT
~~~

Replace the example recipient with the public value generated on your other computer. The script creates `$HOME/faxingpro-backups/<UTC-TIMESTAMP>/` (override with `FAXINGPRO_BACKUP_DIR`). This folder contains:

| File | Contents |
|---|---|
| `database.dump.age` | Entire PostgreSQL database in encrypted custom-format archive |
| `documents.tar.age` | Complete fax document volume, including encrypted originals |
| `config.env.age` | Encrypted deployment environment, including the PDF storage encryption key, Telnyx and operator secrets |
| `SHA256SUMS` | Hashes of the encrypted archives |

Database, documents, and configuration are streamed into age; plaintext backup archives are **never written to the VPS filesystem**. Restrictive filesystem permissions are applied. The Backup & Recovery Center displays the timestamp only after all three encrypted archives were created and the database record was saved.

**Important caveat:** The database dump is transactionally consistent on its own, but the PDF volume is captured separately while the app may be running. A fax arriving during the backup could produce a file/dataset mismatch. Make backups during quiet periods and rehearse full restores.

## 3. Copy to a separate offsite location

Copy each complete timestamped backup directory to a separate access-controlled storage account or secure remote host. `rsync`, `rclone`, or an encrypted object-storage service are appropriate options. **Local archives are not disaster recovery until they are copied off the VPS.** These scripts intentionally do not assume or configure a specific offsite provider, and they do not automatically delete old backups.

Do not put `faxingpro-recovery-identity.txt` on the VPS or at the same location as the archive backups.

## 4. Validate on the separate trusted computer

Install age, the PostgreSQL `pg_restore` client, tar, awk, and SHA utilities. After copying the archives to that computer:

~~~bash
bash scripts/faxingpro-verify-backup.sh \
  /path/to/copied/backup/20261027T030000Z \
  /path/to/faxingpro-recovery-identity.txt
~~~

The verifier checks encrypted archive hashes, validates age authenticated decryption of all three archives, parses the PostgreSQL dump catalog, lists the volume tar archive and confirms the encryption key is present without printing its value.

This verifies archive structure but **does not prove full recovery**. A complete restore rehearsal must also test that stored PDFs decrypt correctly and that saved fax records are accessible in ATLAS.

## 5. Safe restoration rehearsal

**Never rehearse restoring into the live FaxingPro instance.** Use an entirely isolated staging VPS, with **separate Docker Compose volumes/project names**, no live incoming DID routing, and `SEND_ENABLED=false`. Confirm the database and document storage are empty or backed up before restoration.

In the isolated environment only, an operator with the offline age identity can decrypt `config.env.age` into a temporary mode-0600 staging configuration, run `pg_restore` against the staging database, and unpack `documents.tar.age` into the **staging** fax document volume. Reconnect the staging API to that database and storage, then test the restored inbox, outbound records, and downloadable PDFs. The storage key must match the one that encrypted the old PDFs.

Because a restoration may overwrite all existing fax data and expose production credentials, this project deliberately **does not offer a destructive “Restore” button** in its public web interface.

## 6. Scheduling and limitations

Only after running the backup and offline verifier successfully, schedule `scripts/faxingpro-backup.sh` through a restricted systemd timer or root-managed cron job. Monitor its exit code; a passing `/healthz` request does not guarantee a good backup.

**Current status:** ATLAS displays local encrypted-backup records. Offsite uploads, retention, scheduled backup management, and full restore testing still require operator configuration. Do not treat the Backup & Recovery Center as proof of offsite disaster recovery until those are configured and validated.
