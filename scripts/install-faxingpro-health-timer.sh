#!/usr/bin/env bash
# Opt-in read-only health timer; never changes the existing fax/backup services.
set -Eeuo pipefail
umask 077
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mode="${1:---check}"
case "$mode" in --check|--install|--status) ;; *) echo "Usage: $0 [--check|--install|--status]" >&2; exit 2;; esac
if [[ "$mode" == --status ]]; then
  systemctl list-timers --all faxingpro-backup-health.timer --no-pager || true
  systemctl status faxingpro-backup-health.service --no-pager || true
  exit 0
fi
for cmd in systemctl rclone timeout sha256sum curl; do
  command -v "$cmd" >/dev/null || { echo "Missing required command: $cmd" >&2; exit 2; }
done
[[ -f /etc/systemd/system/faxingpro-backup.service &&
   -f /etc/systemd/system/faxingpro-backup.timer ]] || {
  echo 'Install the existing encrypted local backup timer first.' >&2; exit 2;
}
[[ -f /etc/faxingpro/drive.env ]] || {
  echo 'Configure the Google Drive encrypted backup uploader first.' >&2; exit 2;
}
if [[ "$mode" == --check ]]; then
  echo 'Preflight passed. A separate read-only monitor checks backup age, failed jobs and actual Drive access near 05:05 America/New_York.'
  echo 'Optional independent HTTPS alerts use root-only /etc/faxingpro/backup-health.env. No alerts are sent during preflight.'
  exit 0
fi
(( EUID == 0 )) || { echo 'Install as root.' >&2; exit 2; }
cat > /etc/systemd/system/faxingpro-backup-health.service <<UNIT
[Unit]
Description=FaxingPro independent encrypted backup health check
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=root
Environment=HOME=/root
EnvironmentFile=-/etc/faxingpro/backup-health.env
ExecStart=/usr/bin/bash $repo/scripts/faxingpro-backup-health.sh --monitor
TimeoutStartSec=240
UMask=0077
UNIT
cat > /etc/systemd/system/faxingpro-backup-health.timer <<'UNIT'
[Unit]
Description=FaxingPro independent daily backup health monitor

[Timer]
OnCalendar=*-*-* 05:05:00 America/New_York
Persistent=true
RandomizedDelaySec=5m
AccuracySec=1m
Unit=faxingpro-backup-health.service

[Install]
WantedBy=timers.target
UNIT
chmod 0644 /etc/systemd/system/faxingpro-backup-health.{service,timer}
systemctl daemon-reload
systemctl enable --now faxingpro-backup-health.timer
echo 'Read-only health timer installed. Existing local/Drive backup services unchanged.'
