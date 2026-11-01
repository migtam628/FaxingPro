#!/usr/bin/env bash
# FaxingPro DR rehearsal — staging machine ONLY. Never use on the fax VPS.
# Downloads only encrypted Drive archives; temporary restore is network-isolated.
set -Eeuo pipefail
umask 077
usage() {
  cat <<'USAGE'
Usage:
  faxingpro-staging-recovery.sh --fetch YYYYMMDDTHHMMSSZ ABSOLUTE_STAGING_DIR
  faxingpro-staging-recovery.sh --verify ABSOLUTE_ARCHIVE_DIR AGE_PRIVATE_IDENTITY
  faxingpro-staging-recovery.sh --rehearse ABSOLUTE_ARCHIVE_DIR AGE_PRIVATE_IDENTITY

Run ONLY on a separate, trusted Linux staging host. --fetch needs a staging
rclone Google Drive remote (FAXINGPRO_STAGING_DRIVE_REMOTE, default:
google:FaxingPro-Encrypted-Backups). --verify/--rehearse require the off-VPS age
private identity and Docker. --rehearse creates and removes uniquely named,
network-isolated PostgreSQL and document volumes. Never upload keys to CI.
USAGE
}
if [[ "${1:-}" == --help || "${1:-}" == -h ]]; then usage; exit 0; fi
[[ $# == 3 ]] || { usage >&2; exit 2; }
mode="$1"
[[ "$mode" == --fetch || "$mode" == --verify || "$mode" == --rehearse ]] || { usage >&2; exit 2; }

# Defense in depth: production credentials/services must not exist on staging.
# CI is allowed its own synthetic Compose volume but never a production config.
for marker in /etc/faxingpro/backup.env /etc/faxingpro/drive.env \
  /etc/systemd/system/faxingpro-backup.service \
  /root/FaxingPro/deployment/telnyx/.env \
  /opt/faxingpro/deployment/telnyx/.env; do
  if [[ -e "$marker" ]]; then
    echo "REFUSED: production FaxingPro marker exists: $marker" >&2; exit 3
  fi
done
if command -v docker >/dev/null 2>&1 &&
  docker volume inspect faxingpro-telnyx_fax_documents >/dev/null 2>&1 &&
  ! [[ "${GITHUB_ACTIONS:-}" == true && "${CI:-}" == true ]]; then
  echo "REFUSED: live-looking FaxingPro Docker volume exists on this host." >&2
  exit 3
fi

for command_name in sha256sum age docker tar; do
  if [[ "$mode" == --fetch && "$command_name" != sha256sum ]]; then continue; fi
  command -v "$command_name" >/dev/null ||
    { echo "Missing required tool: $command_name" >&2; exit 2; }
done
files=(database.dump.age documents.tar.age config.env.age SHA256SUMS)
check_archive() {
  local directory="$1" file
  [[ -d "$directory" && ! -L "$directory" ]] ||
    { echo 'Archive directory missing or symlinked' >&2; return 1; }
  for file in "${files[@]}"; do
    [[ -s "$directory/$file" && ! -L "$directory/$file" ]] ||
      { echo "Encrypted archive is incomplete: $file" >&2; return 1; }
  done
  # Never allow a remote SHA256SUMS to reference arbitrary files/paths.
  awk '
    NF!=2 || length($1)!=64 || $1 !~ /^[[:xdigit:]]+$/ ||
    $2 !~ /^(database[.]dump[.]age|documents[.]tar[.]age|config[.]env[.]age)$/ {bad=1}
    {seen[$2]++}
    END {if (bad || NR!=3 || seen["database.dump.age"]!=1 ||
      seen["documents.tar.age"]!=1 || seen["config.env.age"]!=1) exit 1}
  ' "$directory/SHA256SUMS" ||
    { echo 'Untrusted or malformed SHA256 manifest' >&2; return 1; }
  (cd "$directory" && sha256sum --status -c SHA256SUMS) ||
    { echo 'Encrypted archive SHA256 mismatch' >&2; return 1; }
  echo 'PASS: encrypted archive contains the expected files and checksums.'
}
if [[ "$mode" == --fetch ]]; then
  stamp="$2"; destination_parent="$3"
  [[ "$stamp" =~ ^20[0-9]{6}T[0-9]{6}Z$ ]] ||
    { echo 'Invalid UTC archive timestamp' >&2; exit 2; }
  [[ "$destination_parent" == /* && "$destination_parent" != / ]] ||
    { echo 'Specify an absolute staging directory, never /' >&2; exit 2; }
  for command_name in rclone mktemp mv; do
    command -v "$command_name" >/dev/null ||
      { echo "Missing required tool: $command_name" >&2; exit 2; }
  done
  remote="${FAXINGPRO_STAGING_DRIVE_REMOTE:-google:FaxingPro-Encrypted-Backups}"
  [[ "$remote" =~ ^[A-Za-z][A-Za-z0-9_-]*:FaxingPro-Encrypted-Backups$ ]] ||
    { echo 'Invalid staging Drive remote' >&2; exit 2; }
  mkdir -p -- "$destination_parent"
  destination_parent="$(realpath -- "$destination_parent")"
  [[ "$destination_parent" != / ]] || exit 2
  final="$destination_parent/$stamp"
  [[ ! -e "$final" && ! -L "$final" ]] ||
    { echo 'Destination already exists; refusing overwrite.' >&2; exit 2; }
  partial="$(mktemp -d "$destination_parent/.faxingpro-dr-partial.XXXXXXXX")"
  cleanup_partial(){ [[ -z "${partial:-}" ]] || rm -rf -- "$partial"; }
  trap cleanup_partial EXIT
  filelist="$partial/.filelist"
  printf '%s\n' "${files[@]}" > "$filelist"
  echo 'Downloading selected encrypted archive to independent staging directory...'
  rclone copy "$remote/$stamp" "$partial" --files-from "$filelist" \
    --checksum --immutable --retries 2 --transfers 2
  rclone check "$remote/$stamp" "$partial" --files-from "$filelist" \
    --checksum --one-way >/dev/null
  rm -- "$filelist"
  check_archive "$partial"
  mv -- "$partial" "$final"
  partial=""
  trap - EXIT
  echo "PASS: encrypted offsite archive downloaded to $final"
  echo 'The off-VPS age private identity was not needed or accessed for download.'
  exit 0
fi

archive="$2"; identity="$3"
[[ "$archive" == /* && "$identity" == /* ]] ||
  { echo 'Archive and age identity paths must both be absolute' >&2; exit 2; }
[[ -f "$identity" && ! -L "$identity" ]] ||
  { echo 'Private age identity file missing or symlinked' >&2; exit 2; }
check_archive "$archive"

# Verify the entire encrypted PostgreSQL dump and document tar streams without
# extracting private data. The config key is detected but never printed.
age -d -i "$identity" "$archive/database.dump.age" |
  docker run --rm -i --network none postgres:17-alpine pg_restore --list >/dev/null
age -d -i "$identity" "$archive/documents.tar.age" | tar -tf - >/dev/null
age -d -i "$identity" "$archive/config.env.age" |
  awk '/^STORAGE_ENCRYPTION_KEY=/ {
    secret=substr($0,index($0,"=")+1)
    if(length(secret)==64 && secret ~ /^[[:xdigit:]]+$/) found=1
  } END{exit !found}'
echo 'PASS: offline age decryption, PostgreSQL catalog and encrypted document tar.'

if [[ "$mode" == --verify ]]; then
  echo 'This is archive verification, not yet an actual database/document restore.'
  exit 0
fi

for command_name in openssl node; do
  command -v "$command_name" >/dev/null ||
    { echo "Missing required tool: $command_name" >&2; exit 2; }
done
started="$SECONDS"
suffix="$(openssl rand -hex 8)"
db_container="faxingpro-dr-db-$suffix"
db_volume="faxingpro-dr-pg-$suffix"
file_volume="faxingpro-dr-files-$suffix"
created_db=0; created_files=0
cleanup() {
  docker rm -f "$db_container" >/dev/null 2>&1 || true
  if (( created_db )); then docker volume rm "$db_volume" >/dev/null 2>&1 || true; fi
  if (( created_files )); then docker volume rm "$file_volume" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT
docker volume create "$db_volume" >/dev/null; created_db=1
docker volume create "$file_volume" >/dev/null; created_files=1
docker run -d --name "$db_container" --network none \
  -e POSTGRES_USER=faxingpro -e POSTGRES_PASSWORD=staging-disposable-only \
  -e POSTGRES_DB=faxingpro -v "$db_volume:/var/lib/postgresql/data" \
  postgres:17-alpine >/dev/null
ready=0
for ((i=0;i<60;i++)); do
  if docker exec "$db_container" psql -U faxingpro -d faxingpro -tAc 'SELECT 1' \
    >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
(( ready )) || { echo 'Temporary staging PostgreSQL did not start.' >&2; exit 1; }
age -d -i "$identity" "$archive/database.dump.age" |
  docker exec -i "$db_container" pg_restore -U faxingpro -d faxingpro \
    --no-owner --no-privileges --exit-on-error >/dev/null
age -d -i "$identity" "$archive/documents.tar.age" |
  docker run --rm -i --network none -v "$file_volume:/data" \
    --entrypoint tar postgres:17-alpine -C /data -xf -
count="$(docker exec "$db_container" psql -U faxingpro -d faxingpro -Atqc \
  'SELECT COUNT(*) FROM faxes')"
[[ "$count" =~ ^[0-9]+$ && "$count" -gt 0 ]] ||
  { echo 'No fax database records were recovered.' >&2; exit 1; }
file_name="$(docker exec "$db_container" psql -U faxingpro -d faxingpro -Atqc \
  "SELECT file_name FROM faxes WHERE file_name ~ '^[0-9a-f-]{36}[.]pdf$' ORDER BY created_at DESC LIMIT 1")"
[[ "$file_name" =~ ^[0-9a-f-]{36}[.]pdf$ ]] ||
  { echo 'No decryptable PDF filename could be selected.' >&2; exit 1; }
key="$(age -d -i "$identity" "$archive/config.env.age" |
  awk -F= '$1=="STORAGE_ENCRYPTION_KEY" {print $2;exit}')"
[[ "$key" =~ ^[0-9a-fA-F]{64}$ ]] || { echo 'Missing recovery media key' >&2; exit 1; }
docker run --rm --network none -v "$file_volume:/data:ro" \
  --entrypoint cat postgres:17-alpine "/data/files/$file_name" |
  FAXINGPRO_RECOVERY_KEY="$key" node -e '
    const {createDecipheriv}=require("node:crypto");
    const parts=[];process.stdin.on("data",x=>parts.push(x));
    process.stdin.on("end",()=>{
      const data=Buffer.concat(parts);
      if(data.length<33||data.subarray(0,4).toString()!=="FP01")throw Error("Encrypted PDF header invalid");
      const d=createDecipheriv("aes-256-gcm",Buffer.from(process.env.FAXINGPRO_RECOVERY_KEY,"hex"),data.subarray(4,16));
      d.setAuthTag(data.subarray(16,32));
      const pdf=Buffer.concat([d.update(data.subarray(32)),d.final()]);
      if(pdf.length<20||pdf.length>10*1024*1024||pdf.subarray(0,5).toString()!=="%PDF-")
        throw Error("Restored PDF content invalid");
      console.log("PASS: restored encrypted PDF authenticates and decrypts to a valid PDF header.");
    });
  '
unset key
printf 'PASS: independent, network-isolated PostgreSQL and document volume restore; fax records=%s; elapsed_seconds=%s\n' "$count" "$((SECONDS-started))"
echo 'The temporary database, document volume and container are removed automatically.'
echo 'No Telnyx credentials, outbound faxing, listening ports or production volumes were used.'
