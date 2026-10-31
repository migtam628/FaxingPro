#!/usr/bin/env bash
# Offline mocked backup-health tests. No network, fax data or Drive credentials.
set -Eeuo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin" "$tmp/backups"
printf 'mock-only\n' > "$tmp/rclone.conf"
printf 'FAXINGPRO_DRIVE_REMOTE=faxingpro-drive:FaxingPro-Encrypted-Backups\nRCLONE_CONFIG=%s\n' "$tmp/rclone.conf" > "$tmp/drive.env"
cat > "$tmp/bin/systemctl" <<'MOCK'
#!/usr/bin/env bash
if [[ "$1" == is-active ]]; then [[ "${TEST_TIMER_OFF:-0}" == 0 ]]; exit; fi
if [[ "$1" == is-failed ]]; then [[ "${TEST_JOB_FAILED:-0}" == 1 ]]; exit; fi
exit 12
MOCK
cat > "$tmp/bin/rclone" <<'MOCK'
#!/usr/bin/env bash
set -Eeuo pipefail
[[ "${1:-}" == --config ]] && shift 2
op="${1:-}"; shift
case "$op" in
  config) echo 'type = drive';;
  lsf) [[ "${TEST_DRIVE_DOWN:-0}" == 0 ]];;
  check) [[ "${TEST_DRIVE_MISMATCH:-0}" == 0 ]];;
  *) exit 13;;
esac
MOCK
cat > "$tmp/bin/curl" <<'MOCK'
#!/usr/bin/env bash
printf 'alert\n' >> "$TEST_WEBHOOK_RECEIPTS"
MOCK
chmod +x "$tmp/bin/"*
export PATH="$tmp/bin:$PATH" FAXINGPRO_BACKUP_DIR="$tmp/backups"
export FAXINGPRO_DRIVE_ENV="$tmp/drive.env" TEST_WEBHOOK_RECEIPTS="$tmp/receipts"
export FAXINGPRO_BACKUP_ALERT_WEBHOOK='https://alerts.example.invalid/hook'
export FAXINGPRO_HEALTH_NOW_EPOCH=1793484000
stamp="$(date -u -d "@$((FAXINGPRO_HEALTH_NOW_EPOCH-10800))" +%Y%m%dT%H%M%SZ)"
mkdir -p "$tmp/backups/$stamp"
for file in database.dump.age documents.tar.age config.env.age; do
  printf 'synthetic encrypted-backup fixture only\n' > "$tmp/backups/$stamp/$file"
done
(cd "$tmp/backups/$stamp" && sha256sum *.age > SHA256SUMS)
monitor="$root/scripts/faxingpro-backup-health.sh"
bash "$monitor" --check | grep -q 'local=healthy drive=verified'
if TEST_JOB_FAILED=1 bash "$monitor" --check; then echo 'Missed failed backup job' >&2; exit 1; fi
if TEST_DRIVE_DOWN=1 bash "$monitor" --check; then echo 'Missed Drive outage' >&2; exit 1; fi
if TEST_DRIVE_MISMATCH=1 bash "$monitor" --check; then echo 'Missed Drive checksum mismatch' >&2; exit 1; fi
if TEST_TIMER_OFF=1 bash "$monitor" --check; then echo 'Missed disabled timer' >&2; exit 1; fi
if FAXINGPRO_HEALTH_NOW_EPOCH=$((FAXINGPRO_HEALTH_NOW_EPOCH+40*3600)) bash "$monitor" --check; then echo 'Missed stale archive' >&2; exit 1; fi
if FAXINGPRO_DRIVE_ENV="$tmp/no-file" bash "$monitor" --check; then echo 'Missed unconfigured Drive' >&2; exit 1; fi
[[ ! -e "$tmp/receipts" ]] || { echo 'Unexpected alert delivery in --check mode' >&2; exit 1; }
if TEST_DRIVE_MISMATCH=1 bash "$monitor" --monitor; then echo 'Expected monitor failure' >&2; exit 1; fi
[[ "$(wc -l < "$tmp/receipts")" == 1 ]] || { echo 'Expected one webhook alert' >&2; exit 1; }
rm "$tmp/backups/$stamp/documents.tar.age"
if bash "$monitor" --check; then echo 'Missed incomplete snapshot' >&2; exit 1; fi
printf 'synthetic encrypted-backup fixture only\n' > "$tmp/backups/$stamp/documents.tar.age"
(cd "$tmp/backups/$stamp" && sha256sum *.age > SHA256SUMS)
export FAXINGPRO_HEALTH_NOW_EPOCH="$((FAXINGPRO_HEALTH_NOW_EPOCH-7200))"
bash "$monitor" --check | grep -q 'drive=pending'
echo 'PASS: local integrity/freshness, Drive verification/outages, timer/job faults, grace period, webhook'
