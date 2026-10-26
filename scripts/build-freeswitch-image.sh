#!/usr/bin/env bash
# Stage an official FreeSWITCH image; never start SIP, route a DID or change firewall.
set -euo pipefail
if [[ ! -t 0 ]]; then
  echo "Run interactively over SSH; do not put a token in a command." >&2
  exit 1
fi
for cmd in docker curl mktemp; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "Missing $cmd" >&2; exit 1; }
done
if [[ -n "${SIGNALWIRE_PAT:-}" || -n "${TOKEN:-}" ]]; then
  echo "Do not export tokens in your shell. Use the hidden prompt." >&2
  exit 1
fi

project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
dockerfile="$project_root/deployment/freeswitch/Dockerfile"
test -f "$dockerfile" || { echo "Dockerfile missing." >&2; exit 1; }

umask 077
secret_file="$(mktemp)"
netrc_file="$(mktemp)"
cleanup() { rm -f -- "$secret_file" "$netrc_file"; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

echo "Use your SignalWire Personal Access Token, NOT a Telnyx API key."
echo "The builder verifies repository authorization before running Docker."
IFS= read -r -s -p "SignalWire PAT (hidden): " sw_pat
printf '\n'
if [[ -z "$sw_pat" || "$sw_pat" == *[[:space:]]* ]]; then
  echo "Empty token or whitespace detected; nothing was changed." >&2
  exit 1
fi
printf '%s' "$sw_pat" > "$secret_file"
printf 'machine freeswitch.signalwire.com login signalwire password %s\n' "$sw_pat" > "$netrc_file"
unset sw_pat

key_url="https://freeswitch.signalwire.com/repo/deb/debian-release/signalwire-freeswitch-repo.gpg"
echo "Checking official FreeSWITCH package access..."
if ! status="$(curl --silent --show-error --location --netrc-file "$netrc_file" \
  --output /dev/null --write-out '%{http_code}' --connect-timeout 10 --max-time 30 "$key_url")"; then
  echo "Network/TLS error while checking package access. No Docker build started." >&2
  exit 1
fi
case "$status" in
  200) echo "HTTP 200: package key accessible. Building image..." ;;
  401)
    echo "HTTP 401: SignalWire did not authorize this PAT." >&2
    echo "Create a SignalWire Space Personal Access Token, not a Telnyx token." >&2
    echo "If a new PAT also fails, ask SignalWire support to check FreeSWITCH community repository access." >&2
    echo "No Docker build started." >&2
    exit 1 ;;
  403)
    echo "HTTP 403: check package repository entitlement with SignalWire." >&2
    echo "No Docker build started." >&2
    exit 1 ;;
  *)
    echo "HTTP $status (expected 200). No Docker build started." >&2
    exit 1 ;;
esac
rm -f -- "$netrc_file"

DOCKER_BUILDKIT=1 docker build \
  --secret "id=signalwire_pat,src=${secret_file}" \
  --tag faxingpro-freeswitch:bookworm \
  --file "$dockerfile" \
  "$project_root/deployment/freeswitch"

echo "Image built; no SIP service started."
echo "Verify: docker run --rm --network none faxingpro-freeswitch:bookworm dpkg-query -W freeswitch-mod-spandsp"
