#!/usr/bin/env bash
# Upload ONLY age-encrypted FaxingPro archives to a dedicated Google Drive folder.
# OAuth credentials are stored in the root-only rclone config, never in the repo.
set -Eeuo pipefail
umask 077
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mode="${1:---upload-pending}"
drive_env="${FAXINGPRO_DRIVE_ENV:-/etc/faxingpro/drive.env}"
case "$mode" in --auto|--check|--upload-pending) ;; *) echo "Usage: $0 [--check|--upload-pending|--auto]" >&2; exit 2;; esac
if [[ ! -f "$drive_env" ]]; then
  if [[ "$mode" == --auto ]]; then echo "Google Drive not configured; leaving encrypted local archives untouched."; exit 0; fi
  echo "Google Drive is not configured. Use scripts/install-faxingpro-drive.sh --install first." >&2; exit 2
fi
# Root-owned configuration contains only a remote name; OAuth tokens are in the rclone config.
source "$drive_env"
remote="${FAXINGPRO_DRIVE_REMOTE:-}"
config="${RCLONE_CONFIG:-/root/.config/rclone/rclone.conf}"
backup_root="${FAXINGPRO_BACKUP_DIR:-/root/faxingpro-backups}"
if [[ ! "$remote" =~ ^[A-Za-z][A-Za-z0-9_-]*:FaxingPro-Encrypted-Backups$ ]]; then
  echo "Refusing unsafe Google Drive destination. Use REMOTE:FaxingPro-Encrypted-Backups." >&2; exit 2
fi
[[ -f "$config" ]] || { echo "Missing rclone config. Authorize Google Drive first." >&2; exit 2; }
for cmd in rclone docker sha256sum flock; do command -v "$cmd" >/dev/null || { echo "Missing command: $cmd" >&2; exit 2; }; done
remote_name="${remote%%:*}"
if ! rclone --config "$config" listremotes | grep -Fxq "${remote_name}:"; then
  echo "Configured rclone remote not found: $remote_name" >&2; exit 2
fi
if ! rclone --config "$config" config show "$remote_name" | grep -Eq "^type = drive$"; then
  echo "Rclone remote must use Google Drive backend." >&2; exit 2
fi
if [[ "$mode" == --check ]]; then
  rclone --config "$config" lsf "${remote_name}:" --max-depth 1 >/dev/null
  echo "Google Drive OAuth/read access OK for $remote_name. No backups uploaded or deleted."
  exit 0
fi
[[ -d "$backup_root" ]] || { echo "Local encrypted backup directory not found." >&2; exit 3; }
[[ -f "$repo/deployment/telnyx/.env" ]] || { echo "FaxingPro deployment environment not found" >&2; exit 2; }
compose=(docker compose -f "$repo/deployment/telnyx/compose.yaml" --env-file "$repo/deployment/telnyx/.env")
# Only one offsite upload job runs at a time; never block local backups.
exec 8>"$backup_root/.drive-upload.lock"
flock -n 8 || { echo "Another Drive upload is running" >&2; exit 3; }
filelist="$(mktemp "$backup_root/.drive-filelist.XXXXXXXX")"
trap 'rm -f "$filelist"' EXIT
printf "%s\n" database.dump.age documents.tar.age config.env.age SHA256SUMS > "$filelist"
processed=0; failed=0
shopt -s nullglob
for snapshot in "$backup_root"/20*T*Z; do
  [[ -d "$snapshot" && ! -L "$snapshot" ]] || continue
  stamp="${snapshot##*/}"
  [[ "$stamp" =~ ^20[0-9]{6}T[0-9]{6}Z$ ]] || continue
  complete=true
  while IFS= read -r file; do
    [[ -f "$snapshot/$file" && ! -L "$snapshot/$file" ]] || complete=false
  done < "$filelist"
  if [[ "$complete" != true ]]; then echo "Skipping incomplete snapshot $stamp" >&2; failed=1; continue; fi
  if ! (cd "$snapshot" && sha256sum --status -c SHA256SUMS); then
    echo "Local encrypted snapshot failed SHA256 verification: $stamp" >&2; failed=1; continue
  fi
  recorded="$("${compose[@]}" exec -T db psql -U faxingpro -d faxingpro -tAc "SELECT count(*) FROM backup_offsite_uploads WHERE name='$stamp' AND provider='google-drive'")"
  if [[ "$recorded" == 1 ]]; then continue; fi
  target="$remote/$stamp"
  echo "Uploading encrypted archive $stamp to Google Drive..."
  if ! rclone --config "$config" copy "$snapshot" "$target" --files-from "$filelist" --checksum --immutable --transfers 2 --checkers 4 --retries 3; then
    echo "Upload failed for $stamp. Local archive preserved." >&2; failed=1; continue
  fi
  if ! rclone --config "$config" check "$snapshot" "$target" --files-from "$filelist" --checksum --one-way; then
    echo "Remote checksum verification failed for $stamp. No offsite success recorded." >&2; failed=1; continue
  fi
  "${compose[@]}" exec -T db psql -U faxingpro -d faxingpro -v ON_ERROR_STOP=1 -c \
    "INSERT INTO backup_offsite_uploads(name,provider,destination) VALUES('$stamp','google-drive','$target') ON CONFLICT(name,provider) DO UPDATE SET verified_at=now(),destination=EXCLUDED.destination" >/dev/null
  processed=$((processed+1))
  echo "Verified Google Drive encrypted archive: $stamp"
done
echo "New encrypted Google Drive archives verified: $processed"
if (( failed != 0 )); then echo "One or more uploads failed; check logs. No local data was deleted." >&2; exit 1; fi
echo "Local backups remain unchanged. Google Drive file verification is not the same as a successful recovery drill."
