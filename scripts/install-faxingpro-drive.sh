#!/usr/bin/env bash
# Opt-in Google Drive backup destination; no deletion or full-Drive syncing.
set -Eeuo pipefail
umask 077
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mode="${1:---check}"
case "$mode" in --check|--install|--status) ;; *) echo "Usage: $0 [--check|--install|--status]" >&2; exit 2;; esac
if [[ "$mode" == --status ]]; then
  systemctl cat faxingpro-backup.service --no-pager 2>/dev/null | grep -E "^ExecStart(Post)?=" || true
  [[ -f /etc/faxingpro/drive.env ]] && echo "Drive upload configured (remote OAuth health not tested)" || echo "Drive upload not configured"
  exit 0
fi
for cmd in rclone systemctl; do command -v "$cmd" >/dev/null || { echo "Install $cmd first" >&2; exit 2; }; done
config="${RCLONE_CONFIG:-/root/.config/rclone/rclone.conf}"
remote="${FAXINGPRO_DRIVE_REMOTE:-faxingpro-drive:FaxingPro-Encrypted-Backups}"
[[ "$remote" =~ ^[A-Za-z][A-Za-z0-9_-]*:FaxingPro-Encrypted-Backups$ ]] || { echo "Invalid remote destination" >&2; exit 2; }
[[ -f "$config" ]] || { echo "Rclone config missing at $config. Run: sudo -i; rclone config" >&2; exit 2; }
remote_name="${remote%%:*}"
rclone --config "$config" listremotes | grep -Fxq "${remote_name}:" || { echo "Rclone remote not found" >&2; exit 2; }
rclone --config "$config" config show "$remote_name" | grep -Eq "^type = drive$" || { echo "Only Google Drive type is supported" >&2; exit 2; }
rclone --config "$config" lsf "${remote_name}:" --max-depth 1 >/dev/null || { echo "OAuth access failed; complete rclone authorization first" >&2; exit 2; }
if [[ "$mode" == --check ]]; then
  echo "Google Drive OAuth verified. Install will create only $remote and add a post-backup upload hook."
  echo "Local encrypted archives are preserved and will never be deleted by this tool."
  exit 0
fi
(( EUID == 0 )) || { echo "Run --install as root (the same user that configured rclone)" >&2; exit 2; }
[[ -f /etc/systemd/system/faxingpro-backup.service ]] || { echo "Install the existing FaxingPro local backup timer first" >&2; exit 2; }
install -d -m 0700 -o root -g root /etc/faxingpro
install -d -m 0755 -o root -g root /etc/systemd/system/faxingpro-backup.service.d
chmod 0600 "$config"
# Create the destination folder using the already-authorized Drive remote.
rclone --config "$config" mkdir "$remote"
printf "FAXINGPRO_DRIVE_REMOTE=%s\nRCLONE_CONFIG=%s\n" "$remote" "$config" > /etc/faxingpro/drive.env
chmod 0600 /etc/faxingpro/drive.env
cat > /etc/systemd/system/faxingpro-backup.service.d/drive-upload.conf <<UNIT
[Service]
ExecStartPost=/usr/bin/bash $repo/scripts/faxingpro-drive-upload.sh --auto
UNIT
chmod 0644 /etc/systemd/system/faxingpro-backup.service.d/drive-upload.conf
systemctl daemon-reload
echo "Google Drive sync attached to successful daily local backup runs."
echo "No remote or local deletion enabled. Now run: bash $repo/scripts/faxingpro-drive-upload.sh --upload-pending"
echo "Verify status in ATLAS Backup & Recovery and with the Google Drive folder."
