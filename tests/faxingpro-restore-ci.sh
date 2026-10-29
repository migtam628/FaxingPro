#!/usr/bin/env bash
# CI-only recovery rehearsal. No ports, sending, or production data.
set -Eeuo pipefail
umask 077
[[ "$GITHUB_ACTIONS" == true && "$CI" == true ]] ||
  { echo "Refusing restore outside disposable GitHub Actions runner" >&2; exit 2; }
[[ $# -ge 2 ]] || { echo "Usage: $0 seed WORKDIR | restore WORKDIR ARCHIVE AGE_IDENTITY" >&2; exit 2; }
mode="$1"
work="$2"
[[ "$mode" == seed || "$mode" == restore ]] || exit 2
[[ "$work" == /* && "$work" != "/" ]] || exit 2
repo="$(cd "$(dirname "$0")/.." && pwd)"
envfile="$repo/deployment/telnyx/.env"
[[ -f "$envfile" ]] || { echo "CI environment file missing" >&2; exit 2; }
for cmd in docker node age sha256sum; do
  command -v "$cmd" >/dev/null || { echo "Missing command: $cmd" >&2; exit 2; }
done
dc(){ docker compose -f "$repo/deployment/telnyx/compose.yaml" --env-file "$envfile" "$@"; }

if [[ "$mode" == seed ]]; then
  [[ $# == 2 && ! -e "$work" ]] || exit 2
  mkdir -m 700 "$work"
  FAXINGPRO_CI_FIXTURE_DIR="$work" FAXINGPRO_CI_ENV_FILE="$envfile" node --input-type=module <<'JS'
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {encryptPdf,pdfValid} from './server/telnyx-utils.mjs';
const contents=readFileSync(process.env.FAXINGPRO_CI_ENV_FILE,'utf8');
const key=contents.match(/^STORAGE_ENCRYPTION_KEY=([0-9a-f]{64})$/m)?.[1];
if(!key)throw Error('CI storage key missing');
const id=randomUUID();
const pdf=Buffer.from('%PDF-1.4\n1 0 obj\n<</Type/Catalog>>\nendobj\n%%EOF\n');
if(!pdfValid(pdf))throw Error('CI PDF format fixture rejected');
const dir=process.env.FAXINGPRO_CI_FIXTURE_DIR;
writeFileSync(join(dir,'fixture-id'),id,{mode:0o600});
writeFileSync(join(dir,'fixture-sha256'),createHash('sha256').update(pdf).digest('hex'),{mode:0o600});
writeFileSync(join(dir,id+'.pdf'),encryptPdf(pdf,key),{mode:0o600});
JS
  id="$(cat "$work/fixture-id")"
  [[ "$id" =~ ^[a-f0-9-]{36}$ ]] || exit 2
  container="$(dc ps -q api)"
  [[ -n "$container" ]] || { echo "CI API unavailable" >&2; exit 2; }
  docker cp "$work/$id.pdf" "$container:/data/files/$id.pdf"
  docker exec -u root "$container" chown node:node "/data/files/$id.pdf"
  docker exec -u root "$container" chmod 600 "/data/files/$id.pdf"
  dc exec -T db psql -U faxingpro -d faxingpro -v ON_ERROR_STOP=1 \
    -c "INSERT INTO faxes(id,direction,status,from_number,to_number,title,filename,file_name,pages) VALUES('$id','inbound','received','+13055551234','+13055559876','CI restore fixture','fixture.pdf','$id.pdf',1)" >/dev/null
  rm -f "$work/$id.pdf"
  echo "Prepared synthetic encrypted fax in disposable test database and document volume."
  exit 0
fi

[[ $# == 4 ]] || { echo "Expected: restore WORKDIR ARCHIVE AGE_IDENTITY" >&2; exit 2; }
archive="$3"
identity="$4"
[[ -f "$work/fixture-id" && -f "$work/fixture-sha256" &&
   -f "$archive/database.dump.age" && -f "$archive/documents.tar.age" &&
   -f "$archive/config.env.age" && -f "$archive/SHA256SUMS" && -f "$identity" ]] || exit 2
id="$(cat "$work/fixture-id")"
expected="$(cat "$work/fixture-sha256")"
[[ "$id" =~ ^[a-f0-9-]{36}$ && "$expected" =~ ^[a-f0-9]{64}$ ]] || exit 2
(cd "$archive" && sha256sum --status -c SHA256SUMS)
key="$(age -d -i "$identity" "$archive/config.env.age" |
  sed -n 's/^STORAGE_ENCRYPTION_KEY=//p' | head -1)"
[[ "$key" =~ ^[a-f0-9]{64}$ ]] || { echo "Backup storage key missing" >&2; exit 1; }

suffix="$(node -e "process.stdout.write(require('node:crypto').randomBytes(6).toString('hex'))")"
pgname="faxingpro-restore-ci-db-$suffix"
dbvol="faxingpro-restore-ci-pg-$suffix"
filevol="faxingpro-restore-ci-files-$suffix"
made_db=false
made_files=false
cleanup(){
  docker rm -f "$pgname" >/dev/null 2>&1 || true
  if $made_db; then docker volume rm "$dbvol" >/dev/null 2>&1 || true; fi
  if $made_files; then docker volume rm "$filevol" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT
docker volume create "$dbvol" >/dev/null; made_db=true
docker volume create "$filevol" >/dev/null; made_files=true
docker run -d --rm --name "$pgname" --network none \
  -e POSTGRES_USER=faxingpro -e POSTGRES_PASSWORD=ci-disposable-only \
  -e POSTGRES_DB=faxingpro -v "$dbvol:/var/lib/postgresql/data" \
  postgres:17-alpine >/dev/null
ready=false
for ((i=0;i<45;i++)); do
  if docker exec "$pgname" psql -U faxingpro -d faxingpro -tAc 'SELECT 1' >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
$ready || { echo "Isolated restore DB did not become ready" >&2; exit 1; }
# Restore only into the new uniquely named, network-disconnected PostgreSQL.
age -d -i "$identity" "$archive/database.dump.age" |
  docker exec -i "$pgname" pg_restore -U faxingpro -d faxingpro --no-owner \
    --no-privileges --exit-on-error
age -d -i "$identity" "$archive/documents.tar.age" |
  docker run --rm -i --network none -v "$filevol:/data" \
    --entrypoint tar postgres:17-alpine -C /data -xf -
count="$(docker exec "$pgname" psql -U faxingpro -d faxingpro -tAc \
  "SELECT count(*) FROM faxes WHERE id='$id' AND file_name='$id.pdf' AND status='received'")"
[[ "$count" == 1 ]] || { echo "Restored fax record missing" >&2; exit 1; }
# Recover and decrypt original PDF from the restored encrypted document volume.
docker run --rm --network none -v "$filevol:/data:ro" \
  --entrypoint cat postgres:17-alpine "/data/files/$id.pdf" |
  FAXINGPRO_CI_KEY="$key" FAXINGPRO_CI_SHA256="$expected" node --input-type=module -e '
    import {createHash} from "node:crypto";
    import {decryptPdf,pdfValid} from "./server/telnyx-utils.mjs";
    const chunks=[];
    for await(const chunk of process.stdin)chunks.push(chunk);
    const pdf=decryptPdf(Buffer.concat(chunks),process.env.FAXINGPRO_CI_KEY);
    if(!pdfValid(pdf)||createHash("sha256").update(pdf).digest("hex")!==process.env.FAXINGPRO_CI_SHA256)
      throw Error("Restored PDF failed decryption or content integrity");
    console.log("Restored original fax PDF matches its recorded digest.");
  '
echo "PASS: isolated PostgreSQL restoration, encrypted document volume and fax PDF decryption."
