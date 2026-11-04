#!/usr/bin/env bash
# Existing-host only: guarded, non-destructive FaxingPro API/web update.
# No installs, no Docker volume deletion, no credentials printed.
set -Eeuo pipefail
umask 077

mode="--check"
dir="/root/FaxingPro"
yes=false
usage(){
  cat <<'HELP'
FaxingPro guarded existing-VPS update:
  sudo bash scripts/faxingpro-deploy-guard.sh --check [--dir /root/FaxingPro]
  sudo bash scripts/faxingpro-deploy-guard.sh --apply [--dir /root/FaxingPro]
  sudo bash scripts/faxingpro-deploy-guard.sh --self-test
Only --apply changes the running API/web containers; confirmation required
unless explicit --yes. No deletion, backup pruning, DB reset, or Telnyx changes.
HELP
}
fail(){ echo "BLOCKED: $*" >&2; exit 1; }
good_port(){ [[ "$1" =~ ^[1-9][0-9]{3,4}$ ]] && ((10#$1 >= 1024 && 10#$1 <= 65535)); }
good_path(){ [[ "$1" == /* && "$1" != / && "$1" != *..* && "$1" =~ ^/[A-Za-z0-9._/-]+$ ]]; }
self_test(){
  good_port 8092 || fail 'Port validation rejected 8092'
  ! good_port 80 || fail 'Port validation accepted 80'
  ! good_port 00080 || fail 'Port validation accepted zero-padded port'
  good_path /root/FaxingPro || fail 'Path validation rejected checkout'
  ! good_path /root/../etc || fail 'Path traversal accepted'
  echo 'PASS: guarded update input validation'
}
while (( $# )); do
  case "$1" in
    --help|-h) usage;exit 0;;
    --self-test) self_test;exit 0;;
    --check|--apply) mode="$1";shift;;
    --yes) yes=true;shift;;
    --dir) (( $# >= 2 )) || fail 'Missing --dir value';dir="$2";shift 2;;
    *) fail "Unknown option: $1";;
  esac
done
good_path "$dir" || fail 'Unsafe installation directory'
(( EUID == 0 )) || fail 'Run as root: sudo bash scripts/faxingpro-deploy-guard.sh --check'
[[ -d "$dir/.git" && ! -L "$dir" ]] || fail 'Existing Git checkout not found'
[[ -f "$dir/deployment/telnyx/.env" ]] || fail 'Existing secret file missing'
for command_name in git docker curl df awk sed; do
  command -v "$command_name" >/dev/null || fail "Missing command $command_name"
done
docker compose version >/dev/null 2>&1 || fail 'Docker Compose unavailable'
docker info >/dev/null 2>&1 || fail 'Docker daemon inaccessible'
compose="$dir/deployment/telnyx/compose.yaml"
envfile="$dir/deployment/telnyx/.env"
[[ -r "$compose" && -r "$envfile" ]] || fail 'Compose or env file unreadable'
dc(){ docker compose -f "$compose" --env-file "$envfile" "$@"; }
[[ "$(git -C "$dir" branch --show-current)" == main ]] || fail 'Checkout must be on main'
[[ -z "$(git -C "$dir" status --porcelain --untracked-files=no)" ]] ||
  fail 'Tracked local modifications detected; resolve manually'
# Remote fetch changes Git metadata only; never applies code or restarts services.
git -C "$dir" fetch --quiet origin main || fail 'Cannot fetch GitHub main; refusing blind deploy'
git -C "$dir" merge-base --is-ancestor HEAD origin/main ||
  fail 'Local Git checkout diverged; refusing merge/reset'
current="$(git -C "$dir" rev-parse --short HEAD)"
target="$(git -C "$dir" rev-parse --short origin/main)"
echo "GitHub: current=$current target=$target"
dc config --quiet || fail 'Existing Compose configuration invalid'
for volume in faxingpro-telnyx_fax_database faxingpro-telnyx_fax_documents; do
  docker volume inspect "$volume" >/dev/null 2>&1 ||
    fail "Persistent volume missing ($volume). Refusing deploy."
done
[[ -r "$dir/scripts/faxingpro-backup-health.sh" ]] || fail 'Backup monitor script missing'
bash "$dir/scripts/faxingpro-backup-health.sh" --check ||
  fail 'Verified local/Google Drive backup health is required before deploy'
port="$(sed -n 's/^FAXINGPRO_HTTP_PORT=//p' "$envfile" | tail -n 1)"
good_port "$port" || fail 'FAXINGPRO_HTTP_PORT missing/invalid'
curl --fail --silent --show-error --max-time 12 "http://127.0.0.1:$port/healthz" >/dev/null ||
  fail 'Existing local API/web health check failed'
# Fail closed unless database read is possible. Do not enumerate fax details.
active="$(dc exec -T db psql -U faxingpro -d faxingpro -Atq -v ON_ERROR_STOP=1 \
  -c "SELECT count(*) FROM faxes WHERE direction='outbound' AND status NOT IN ('delivered','failed','unknown') AND updated_at > now() - interval '20 minutes';" 2>/dev/null)" ||
  fail 'Unable to inspect recent outbound fax activity'
[[ "$active" =~ ^[0-9]+$ ]] || fail 'Invalid activity count'
(( active == 0 )) || fail "Found $active recent unfinished outbound fax(es); deploy deferred"
free_kb="$(df -Pk /var/lib/docker 2>/dev/null | awk 'END{print $4}')"
[[ "$free_kb" =~ ^[0-9]+$ ]] || fail 'Unable to inspect Docker disk space'
(( free_kb >= 2*1024*1024 )) || fail 'Less than 2 GB available on Docker filesystem'
echo 'PASS: existing services, persistent volumes, backup health, no recent active outbound jobs, disk space'
if [[ "$mode" == --check ]]; then
  echo 'READ-ONLY PREFLIGHT COMPLETE. No containers, credentials, or fax records changed.'
  echo 'For a maintenance-window update, run this script with --apply.'
  exit 0
fi
if ! $yes; then
  [[ -r /dev/tty ]] || fail 'Interactive confirmation unavailable; use --yes only when explicitly approved'
  read -r -p "Type DEPLOY to update API/web from $current to $target: " answer </dev/tty
  [[ "$answer" == DEPLOY ]] || fail 'Deployment not confirmed'
fi
echo 'Applying fast-forward GitHub main update (no data volume changes)...'
git -C "$dir" pull --ff-only origin main || fail 'Fast-forward update failed; containers unchanged'
dc config --quiet || fail 'Updated Compose invalid; containers unchanged'
echo 'Building API and web images without restarting PostgreSQL...'
dc build api web || fail 'Build failed; live containers should remain on previous image'
echo 'Recreating API and web only; brief service interruption possible...'
dc up -d --no-deps api web || fail 'Container update failed; inspect Compose logs'
healthy=false
for attempt in {1..18}; do
  if curl --fail --silent --max-time 5 "http://127.0.0.1:$port/healthz" >/dev/null 2>&1 &&
     curl --fail --silent --max-time 5 "http://127.0.0.1:$port/api/session" >/dev/null 2>&1; then
    healthy=true
    break
  fi
  sleep 5
done
if ! $healthy; then
  echo "FAILED: post-update health check. Previous Git commit: $current." >&2
  echo 'Do NOT reset or delete DB/doc volumes. Review API/web logs and recovery guide.' >&2
  exit 1
fi
bash "$dir/scripts/faxingpro-backup-health.sh" --check ||
  fail 'Application updated, but backup monitoring degraded; investigate before closing deployment'
echo "DEPLOYED: $(git -C "$dir" rev-parse --short HEAD) — local API/session and backup health verified."
echo 'Manually verify the public HTTPS site, owner login, Team Members and Security audit.'
