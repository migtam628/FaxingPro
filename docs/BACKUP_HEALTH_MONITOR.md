# FaxingPro — Independent backup health monitor (opt-in)

ATLAS already shows database-ledger backup notifications. This **separate** read-only monitor checks actual encrypted local files, the backup timer and last job state, current Google Drive read access, and the newest encrypted offsite copy. It never writes to the database, archives, PDFs, Docker containers, credentials, Telnyx settings, or Google Drive.

## Checks

- The existing systemd `faxingpro-backup.timer` must be active, and `faxingpro-backup.service` must not be failed.
- The latest timestamped local backup directory must have `database.dump.age`, `documents.tar.age`, `config.env.age`, and `SHA256SUMS`, with no symlinked files. SHA-256 must verify and age must be at most **36 hours** (or no more than five minutes into the future).
- Root's configured rclone remote must use Google Drive and answer an actual read-only `rclone lsf` request.
- Once a local archive is **at least two hours old**, the same-named Drive folder must pass `rclone check --checksum --one-way` for the four expected files. Until then `drive=pending` explicitly does **not** mean verified. An unavailable Drive remote is always a failure, even during the grace period.
- Any failure exits nonzero and logs a generic summary; `--monitor` optionally sends an external HTTPS JSON alert independent of ATLAS. Neither mode uploads, retries, deletes, or changes backup files.

This is **not a disaster-recovery test**. It does not decrypt archives, verify the recovery identity, restore PostgreSQL, prove legal compliance, or promise that Drive will stay available.

## Existing VPS installation

Use the existing checkout, not the fresh VPS installer:

~~~bash
cd /root/FaxingPro  # or your existing checkout
sudo bash scripts/install-faxingpro-health-timer.sh --check
sudo bash scripts/faxingpro-backup-health.sh --check
# Review before opting in:
sudo bash scripts/install-faxingpro-health-timer.sh --install
sudo bash scripts/install-faxingpro-health-timer.sh --status
sudo journalctl -u faxingpro-backup-health.service -n 80 --no-pager
~~~

The optional separate timer runs daily around **05:05 America/New_York**, after the primary 03:15 backup and upload hook. A failed invocation remains visible in systemd. Neither the existing timer nor the Drive uploader is modified. Run a manual check at any time with `sudo bash scripts/faxingpro-backup-health.sh --check`.

## Independent external alerts (optional)

To POST a generic status-only JSON event to your **own compatible HTTPS webhook**, create root-only `/etc/faxingpro/backup-health.env`:

~~~ini
FAXINGPRO_BACKUP_ALERT_WEBHOOK='https://YOUR-ALERT-ENDPOINT.example/hook'
~~~

Set `chmod 600 /etc/faxingpro/backup-health.env`. The URL itself may contain a private token: never paste it into GitHub or chat. HTTP and embedded username/password URLs are refused. The JSON contains only `event`, `status`, `timer`, `job`, `local`, and `drive`; no fax names, PDFs, recipients or credentials. The monitor sends only on failure in `--monitor` mode. Alerts can repeat on each scheduled failure; there is no deduplication. Not all chat services accept a generic JSON webhook without an adapter.

## Troubleshooting

- `timer=inactive` / `job=failed`: inspect `systemctl status faxingpro-backup.timer faxingpro-backup.service` and the backup service journal.
- `local=missing|incomplete|stale|clock-skew`: inspect the backup root, manifest, disk space and server clock. Do not remove backups to clear alerts.
- `drive=unconfigured|misconfigured|unavailable`: check root-owned `/etc/faxingpro/drive.env`, rclone configuration and OAuth; do not expose `rclone.conf`.
- `drive=missing-or-mismatch`: examine upload logs and actual Drive contents. Only the existing safe uploader can retry; the monitor never repairs anything.
- `drive=pending`: remote read access passed, but the archive is inside the two-hour grace period and its offsite checksum has not been checked yet.

CI verifies simulated failures and webhook invocation without real credentials or network access. Staging verification with real OAuth and external delivery is still required before calling this operationally proven. Production is not changed merely by merging the feature branch.
