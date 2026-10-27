# FaxingPro — Google Drive encrypted offsite backups

FaxingPro uploads **only encrypted backup archives** (three `.age` files and a SHA256 manifest) to Google Drive using [rclone](https://rclone.org/drive/). The private `age` recovery identity remains OFF the VPS, preferably on your Mac with an offline second copy. This integration never uploads raw fax PDFs or your plaintext Telnyx `.env`, and never deletes local or Drive backups.

## 1. Authorize your Google account on the VPS

Install rclone on Ubuntu on `mttech-vps`:

~~~bash
sudo apt-get update
sudo apt-get install -y rclone
rclone version
~~~

As of 2026, rclone is retiring its shared Google Drive OAuth client ID. Use **your own Google Cloud OAuth client ID** rather than leaving `client_id` blank. See the official [rclone custom client guide](https://rclone.org/drive/#making-your-own-client-id).

In Google Cloud Console ([console.cloud.google.com](https://console.cloud.google.com/)), create a project for FaxingPro backup access, enable **Google Drive API**, configure the OAuth consent screen, and create an **OAuth desktop application** client. Copy the OAuth **client ID and secret privately** when `rclone config` requests them. For a long-running scheduled job, configure an appropriate publishing state; an OAuth app left in external **Testing** may have refresh tokens that expire after seven days. You must perform the Google authorization yourself. **Never send OAuth tokens or client secrets in chat.**

On the VPS, as the **same root account that runs FaxingPro's backup service**:

~~~bash
sudo -i
mkdir -p /root/.config/rclone
chmod 700 /root/.config/rclone
rclone config
~~~

Choose:
- `n` for new remote, name: **faxingpro-drive**.
- Storage type: **Google Drive (`drive`)**.
- Provide your own OAuth **client_id** and **client_secret** (from Google Cloud).
- Scope: **drive.file** (only files and folders created by this app; visible in Google Drive). This is preferable to full-Drive access.
- Service account: leave empty (unless you are deliberately configuring another supported account type).
- Headless authorization: answer **No** to the automatic browser question. Follow the exact on-screen instructions for **rclone authorize** using your Mac browser and rclone installed on the Mac. Complete Google sign-in yourself, then securely transfer the short-lived authorization result to your VPS terminal at the prompt. The resulting OAuth refresh token is stored in the root-only rclone configuration.
- Shared drive: No for a personal Drive account. Save the remote and exit.

Authoritative instructions: [headless remote setup](https://rclone.org/remote_setup/), [Google Drive backend](https://rclone.org/drive/), [rclone authorize](https://rclone.org/commands/rclone_authorize/).

Lock down the rclone config and test read access:

~~~bash
chmod 600 /root/.config/rclone/rclone.conf
rclone lsf faxingpro-drive: --max-depth 1
~~~

`rclone lsf` may display an empty result on a new `drive.file` remote — no error means the authorization worked. Do not paste your `rclone.conf` contents anywhere. If your Google OAuth refresh token expires/revokes, backups will remain local and systemd will report an upload failure.

## 2. Install the dedicated Google Drive backup hook

From the VPS root shell:

~~~bash
cd /root/FaxingPro
git pull --ff-only

# The local FaxingPro systemd backup timer must already be installed.
systemctl cat faxingpro-backup.service

bash scripts/install-faxingpro-drive.sh --check
bash scripts/install-faxingpro-drive.sh --install
~~~

The installer validates the rclone Google Drive backend, creates **faxingpro-drive:FaxingPro-Encrypted-Backups** (a dedicated folder in your Google Drive), stores the selected remote path in root-only `/etc/faxingpro/drive.env`, and adds an **ExecStartPost** hook to the existing `faxingpro-backup.service`. The original daily local backup timer is left in place; the Drive upload runs only after a successful local backup.

No permissions, webhook, fax documents, Telnyx credentials, or Docker volumes are changed by this installer.

## 3. Upload existing encrypted backups safely

After updating the v0.5 API and restarting FaxingPro to add its `backup_offsite_uploads` table:

~~~bash
cd /root/FaxingPro
bash scripts/faxingpro-drive-upload.sh --check
bash scripts/faxingpro-drive-upload.sh --upload-pending
~~~

The uploader scans timestamped, completed local encrypted backup directories, validates `SHA256SUMS`, copies **only** these files to the matching timestamp subfolder in Drive, runs `rclone check --checksum --one-way`, and only then records the Google Drive verification timestamp in PostgreSQL. It skips backups previously marked verified. It never calls `rclone sync`, `move`, `delete`, or removes local archives.

If upload or comparison fails, the script reports an error and keeps local archives. The systemd backup job records that failure in its journal. It may also report success for local archive creation independently; inspect both local and Drive status.

## 4. Confirm the next scheduled run

~~~bash
systemctl list-timers --all faxingpro-backup.timer
sudo systemctl start faxingpro-backup.service
sudo journalctl -u faxingpro-backup.service -n 80 --no-pager
~~~

Open **ATLAS → Backup & Recovery**. A successful Google Drive upload reports **Google Drive verified** next to the matching backup, including the latest copy.

Also sign in to [Google Drive](https://drive.google.com/drive/u/0/my-drive) and confirm **FaxingPro-Encrypted-Backups** contains timestamped folders with the `.age` files and `SHA256SUMS`.

**What verification means:** A recorded Drive checksum match is evidence encrypted files existed and matched the VPS archives **at upload time**. It does **not** guarantee a recovery key is accessible, Drive files remain present indefinitely, or restored PostgreSQL/PDF data can be used. Periodically download a copy onto another machine, verify its age decryption, and run a full isolated restoration rehearsal before relying on it as production disaster recovery.

## 5. Safety and operational limits

- **No retention or automatic deletion yet:** local disk and Google Drive storage may grow; monitor both manually.
- **No offsite secrets in the UI:** the dashboard shows encrypted-copy verification only.
- **No dependency on Drive for fax transmission:** if Google Drive authentication fails, local backups remain on disk and live fax service continues.
- **Single-account OAuth:** revoke access or rotate the Google Cloud app credentials if compromised. Keep the rclone config 0600 and root-only.
- **Daily timer still runs locally:** check its state using `systemctl`; ATLAS does not infer enabled timer status from backup records.
- **Sensitive documents:** single-operator FaxingPro still needs MFA, per-user roles, audit logs and a tested disaster recovery procedure before being used for regulated or high-risk data.

## Troubleshooting

If `rclone config` won't finish, consult [headless OAuth setup](https://rclone.org/remote_setup/). If the installer reports the wrong backend, check you configured `faxingpro-drive` as `drive`, not `local`. If a backup is shown as "Drive upload pending", check `journalctl -u faxingpro-backup.service -n 80 --no-pager` and rerun the uploader after repairing authorization.

**Never share OAuth tokens, your rclone configuration, or age private identity in a support request.**
