#!/usr/bin/env bash
# Read-only independent backup monitor: validate local archive and live Drive.
set -Eeuo pipefail
umask 077
mode="${1:---check}"
case "$mode" in --check|--monitor) ;; *) echo "Usage: $0 [--check|--monitor]" >&2; exit 2;; esac
backup_root="${FAXINGPRO_BACKUP_DIR:-/root/faxingpro-backups}"
drive_env="${FAXINGPRO_DRIVE_ENV:-/etc/faxingpro/drive.env}"
now="${FAXINGPRO_HEALTH_NOW_EPOCH:-$(date -u +%s)}"
[[ "$now" =~ ^[0-9]{10,}$ ]] || { echo "Invalid monitor clock" >&2; exit 2; }
local_status=missing; drive_status=unconfigured; timer_status=inactive; job_status=ok
failed=0
if systemctl is-active --quiet faxingpro-backup.timer; then timer_status=active; else failed=1; fi
if systemctl is-failed --quiet faxingpro-backup.service; then job_status=failed; failed=1; fi
snapshot=""; stamp=""; age_seconds=0
if [[ -d "$backup_root" ]]; then
  shopt -s nullglob
  for candidate in "$backup_root"/20*T*Z; do
    [[ -d "$candidate" && ! -L "$candidate" ]] || continue
    candidate_stamp="${candidate##*/}"
    [[ "$candidate_stamp" =~ ^20[0-9]{6}T[0-9]{6}Z$ ]] || continue
    if [[ -z "$stamp" || "$candidate_stamp" > "$stamp" ]]; then
      stamp="$candidate_stamp"; snapshot="$candidate"
    fi
  done
fi
if [[ -n "$snapshot" ]]; then
  local_status=incomplete
  complete=true
  for file in database.dump.age documents.tar.age config.env.age SHA256SUMS; do
    [[ -f "$snapshot/$file" && ! -L "$snapshot/$file" ]] || complete=false
  done
  if [[ "$complete" == true ]] && (cd "$snapshot" && sha256sum --status -c SHA256SUMS 2>/dev/null); then
    stamp_epoch="$(date -u -d "${stamp:0:4}-${stamp:4:2}-${stamp:6:2} ${stamp:9:2}:${stamp:11:2}:${stamp:13:2} UTC" +%s 2>/dev/null || true)"
    if [[ "$stamp_epoch" =~ ^[0-9]+$ ]]; then
      age_seconds=$((now-stamp_epoch))
      if (( age_seconds < -300 )); then local_status=clock-skew
      elif (( age_seconds > 36*3600 )); then local_status=stale
      else local_status=healthy
      fi
    fi
  fi
fi
[[ "$local_status" == healthy ]] || failed=1
if [[ -f "$drive_env" ]]; then
  # The root-owned Drive installer creates this trusted configuration file.
  source "$drive_env"
  remote="${FAXINGPRO_DRIVE_REMOTE:-}"
  config="${RCLONE_CONFIG:-/root/.config/rclone/rclone.conf}"
  if [[ "$remote" =~ ^[A-Za-z][A-Za-z0-9_-]*:FaxingPro-Encrypted-Backups$ ]] &&
    [[ -f "$config" ]] && command -v rclone >/dev/null && command -v timeout >/dev/null; then
    remote_name="${remote%%:*}"
    if timeout 45 rclone --config "$config" config show "$remote_name" 2>/dev/null | grep -Eq '^type = drive$' &&
      timeout 45 rclone --config "$config" lsf "$remote" --max-depth 1 >/dev/null 2>&1; then
      drive_status=pending
      if [[ -n "$snapshot" && "$local_status" != incomplete && "$local_status" != clock-skew ]]; then
        if (( age_seconds >= 2*3600 )); then
          filelist="$(mktemp)"
          trap 'rm -f "$filelist"' EXIT
          printf '%s\n' database.dump.age documents.tar.age config.env.age SHA256SUMS > "$filelist"
          if timeout 180 rclone --config "$config" check "$snapshot" "$remote/$stamp" \
            --files-from "$filelist" --checksum --one-way >/dev/null 2>&1; then
            drive_status=verified
          else
            drive_status=missing-or-mismatch
          fi
        fi
      fi
    else
      drive_status=unavailable
    fi
  else
    drive_status=misconfigured
  fi
fi
# The existing two-hour upload grace avoids a false missing-copy alert.
case "$drive_status" in verified|pending) ;; *) failed=1;; esac
printf 'FaxingPro backup health: timer=%s job=%s local=%s drive=%s\n' \
  "$timer_status" "$job_status" "$local_status" "$drive_status"
if (( failed != 0 )); then
  echo 'Backup monitoring degraded; encrypted archives and production data were not changed.' >&2
  if [[ "$mode" == --monitor && -n "${FAXINGPRO_BACKUP_ALERT_WEBHOOK:-}" ]]; then
    webhook="$FAXINGPRO_BACKUP_ALERT_WEBHOOK"
    if [[ "$webhook" =~ ^https://[^/[:space:]@]+/[^[:space:]]*$ ]] &&
      ! [[ "$webhook" == *'@'* ]]; then
      payload="{\"event\":\"faxingpro.backup_health\",\"status\":\"degraded\",\"timer\":\"$timer_status\",\"job\":\"$job_status\",\"local\":\"$local_status\",\"drive\":\"$drive_status\"}"
      if ! curl -fsS --max-time 12 -H 'Content-Type: application/json' \
        --data "$payload" "$webhook" >/dev/null 2>&1; then
        echo 'Backup alert webhook delivery failed.' >&2
      fi
    else
      echo 'Backup alert webhook must be an HTTPS URL without embedded credentials.' >&2
    fi
  fi
  exit 1
fi
exit 0
