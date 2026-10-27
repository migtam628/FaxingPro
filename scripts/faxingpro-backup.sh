#!/usr/bin/env bash
# FaxingPro: authenticated age-encrypted backup, without plaintext archive files.
set -Eeuo pipefail
umask 077
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${FAXINGPRO_ENV_FILE:-$repo/deployment/telnyx/.env}"
backup_root="${FAXINGPRO_BACKUP_DIR:-$HOME/faxingpro-backups}"
recipient="${FAXINGPRO_AGE_RECIPIENT:-${1:-}}"
if [[ ! "$recipient" =~ ^age1[a-z0-9]{30,}$ ]]; then
  echo "ERROR: supply your off-VPS age1... PUBLIC recipient in FAXINGPRO_AGE_RECIPIENT" >&2; exit 2
fi
for binary in docker age sha256sum; do
  command -v "$binary" >/dev/null || { echo "ERROR: missing command: $binary" >&2; exit 2; }
done
[[ -f "$env_file" ]] || { echo "ERROR: missing $env_file" >&2; exit 2; }
grep -q '^STORAGE_ENCRYPTION_KEY=' "$env_file" || { echo "ERROR: PDF storage key not found" >&2; exit 2; }
compose=(docker compose -f "$repo/deployment/telnyx/compose.yaml" --env-file "$env_file")
"${compose[@]}" config --quiet
volume="faxingpro-telnyx_fax_documents"
docker volume inspect "$volume" >/dev/null
mkdir -p "$backup_root"; chmod 0700 "$backup_root"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
out="$backup_root/$stamp"
work="$(mktemp -d "$backup_root/.${stamp}.partial.XXXXXXXX")"
cleanup(){ [[ ! -d "$work" ]] || rm -rf -- "$work"; }
trap cleanup EXIT

echo "Streaming PostgreSQL dump into age encryption..."
"${compose[@]}" exec -T db pg_dump -U faxingpro -d faxingpro -Fc |
  age -r "$recipient" -o "$work/database.dump.age"
echo "Streaming document volume into age encryption..."
docker run --rm --network none --read-only \
  -v "$volume:/data:ro" --entrypoint tar postgres:17-alpine \
  -C /data -cf - . |
  age -r "$recipient" -o "$work/documents.tar.age"
echo "Encrypting all deployment secrets, including PDF recovery key..."
age -r "$recipient" -o "$work/config.env.age" "$env_file"
(cd "$work" && sha256sum database.dump.age documents.tar.age config.env.age > SHA256SUMS)
for archive in database.dump.age documents.tar.age config.env.age; do
  [[ -s "$work/$archive" ]] || { echo "ERROR: empty $archive" >&2; exit 1; }
done
chmod 0600 "$work"/*
mv -- "$work" "$out"
trap - EXIT
"${compose[@]}" exec -T db psql -U faxingpro -d faxingpro -v ON_ERROR_STOP=1 \
  -c "INSERT INTO backup_runs(name) VALUES('$stamp') ON CONFLICT(name) DO NOTHING" >/dev/null
echo "Encrypted archives created at: $out"
echo "Important: copy the complete directory offsite and verify it on a separate trusted device."
