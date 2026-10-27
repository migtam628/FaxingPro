#!/usr/bin/env bash
# Install a daily LOCAL encrypted-backup timer. It never configures offsite copy or deletion.
set -Eeuo pipefail
umask 077
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mode="${1:---check}"
backup_env="/etc/faxingpro/backup.env"
service="/etc/systemd/system/faxingpro-backup.service"
timer="/etc/systemd/system/faxingpro-backup.timer"
case "$mode" in
  --status)
    systemctl status faxingpro-backup.timer --no-pager || true
    systemctl list-timers --all faxingpro-backup.timer --no-pager || true
    exit 0;;
  --check|--install) ;;
  *) echo "Usage: $0 [--check|--install|--status]" >&2; exit 2;;
esac
[[ -f "$repo/deployment/telnyx/.env" ]] || { echo "Missing FaxingPro VPS env file" >&2; exit 2; }
for program in docker age flock systemctl; do
  command -v "$program" >/dev/null || { echo "Missing required command: $program" >&2; exit 2; }
done
recipient="${FAXINGPRO_AGE_RECIPIENT:-}"
if [[ ! "$recipient" =~ ^age1[a-z0-9]{30,}$ ]]; then
  echo "Set FAXINGPRO_AGE_RECIPIENT to your OFF-VPS age PUBLIC recipient (age1...)" >&2; exit 2
fi
if [[ "$mode" == "--check" ]]; then
  echo "Preflight OK. Installation will schedule encrypted LOCAL backups daily at 03:15 America/New_York."
  echo "Repository: $repo"
  echo "The private age identity must remain OFF this VPS. Offsite copy is NOT configured."
  exit 0
fi
(( EUID == 0 )) || { echo "Use sudo to install the timer" >&2; exit 2; }
install -d -o root -g root -m 0700 /etc/faxingpro
printf "FAXINGPRO_AGE_RECIPIENT=%s\nFAXINGPRO_BACKUP_DIR=/root/faxingpro-backups\n" "$recipient" > "$backup_env"
chmod 0600 "$backup_env"
cat > "$service" <<UNIT
[Unit]
Description=FaxingPro - age encrypted local database, fax file and secret backup
Wants=docker.service
After=docker.service

[Service]
Type=oneshot
User=root
WorkingDirectory=$repo
Environment=HOME=/root
EnvironmentFile=$backup_env
ExecStart=/usr/bin/bash $repo/scripts/faxingpro-backup.sh
TimeoutStartSec=3600
UMask=0077

UNIT
cat > "$timer" <<UNIT
[Unit]
Description=FaxingPro daily encrypted local backup timer

[Timer]
OnCalendar=*-*-* 03:15:00 America/New_York
Persistent=true
RandomizedDelaySec=10m
AccuracySec=1m
Unit=faxingpro-backup.service

[Install]
WantedBy=timers.target
UNIT
chmod 0644 "$service" "$timer"
systemctl daemon-reload
systemctl enable --now faxingpro-backup.timer
echo "Daily encrypted LOCAL timer enabled. No files are pruned, and no offsite upload was configured."
echo "Check: systemctl list-timers --all faxingpro-backup.timer"
echo "Logs: journalctl -u faxingpro-backup.service -n 60 --no-pager"
echo "The timer may immediately catch up on a missed scheduled run (Persistent=true)."
