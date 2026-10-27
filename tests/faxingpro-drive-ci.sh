#!/usr/bin/env bash
# Mock OAuth transport on isolated CI; no Google credentials or network needed.
set -Eeuo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[[ $# -eq 1 ]] || { echo "Usage: $0 ENCRYPTED_BACKUP_ROOT" >&2; exit 2; }
backup_root="$1"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin" "$tmp/drive"
printf "mock-only\n" > "$tmp/rclone.conf"
printf "FAXINGPRO_DRIVE_REMOTE=faxingpro-drive:FaxingPro-Encrypted-Backups\nRCLONE_CONFIG=%s\n" "$tmp/rclone.conf" > "$tmp/drive.env"
cat > "$tmp/bin/rclone" <<'MOCK'
#!/usr/bin/env bash
set -Eeuo pipefail
if [[ "${1:-}" == "--config" ]]; then shift 2; fi
operation="$1"; shift
case "$operation" in
  listremotes) echo "faxingpro-drive:";;
  config) echo "type = drive";;
  lsf) : ;;
  copy)
    source="$1"; target="$2"; stamp="${target##*/}"
    mkdir -p "$TEST_DRIVE_DIR/$stamp"
    for name in database.dump.age documents.tar.age config.env.age SHA256SUMS; do
      cp "$source/$name" "$TEST_DRIVE_DIR/$stamp/$name"
    done;;
  check)
    source="$1"; target="$2"; stamp="${target##*/}"
    [[ "${TEST_FAIL_CHECK:-0}" == 0 ]] || exit 9
    for name in database.dump.age documents.tar.age config.env.age SHA256SUMS; do
      cmp "$source/$name" "$TEST_DRIVE_DIR/$stamp/$name" || exit 10
    done;;
  *) echo "Unexpected rclone command $operation" >&2; exit 11;;
esac
MOCK
chmod +x "$tmp/bin/rclone"
export PATH="$tmp/bin:$PATH"
export RCLONE_CONFIG="$tmp/rclone.conf" FAXINGPRO_DRIVE_ENV="$tmp/drive.env"
export FAXINGPRO_BACKUP_DIR="$backup_root" TEST_DRIVE_DIR="$tmp/drive"
bash "$root/scripts/faxingpro-drive-upload.sh" --check
bash "$root/scripts/faxingpro-drive-upload.sh" --upload-pending
compose=(docker compose -f "$root/deployment/telnyx/compose.yaml" --env-file "$root/deployment/telnyx/.env")
count="$("${compose[@]}" exec -T db psql -U faxingpro -d faxingpro -tAc "SELECT count(*) FROM backup_offsite_uploads WHERE provider='google-drive'")"
[[ "$count" == 1 ]]
bash "$root/scripts/faxingpro-drive-upload.sh" --upload-pending
count="$("${compose[@]}" exec -T db psql -U faxingpro -d faxingpro -tAc "SELECT count(*) FROM backup_offsite_uploads WHERE provider='google-drive'")"
[[ "$count" == 1 ]]
node "$root/tests/telnyx-drive-monitor.mjs"
echo "PASS: mocked Google Drive copy/check, offsite ledger and idempotent rerun"
