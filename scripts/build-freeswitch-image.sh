#!/usr/bin/env bash
# Builds a staged FreeSWITCH/SpanDSP image WITHOUT starting or exposing it.
set -euo pipefail

if [[ ! -t 0 ]]; then
  echo "Run interactively over SSH; PAT input must not be passed as a CLI argument." >&2
  exit 1
fi
if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required. No changes made." >&2
  exit 1
fi
if [[ -n "${SIGNALWIRE_PAT:-}" || -n "${TOKEN:-}" ]]; then
  echo "Avoid exporting secrets in environment variables; use the interactive prompt." >&2
  exit 1
fi
project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
dockerfile="${project_root}/deployment/freeswitch/Dockerfile"
if [[ ! -f "$dockerfile" ]]; then
  echo "Cannot find the FaxingPro FreeSWITCH Dockerfile." >&2
  exit 1
fi

umask 077
secret_file="$(mktemp)"
cleanup() { rm -f "$secret_file"; }
trap cleanup EXIT INT TERM

echo "SignalWire PAT is required for the official FreeSWITCH Debian package repository."
echo "The prompt hides the token; it is temporarily stored in a 0600 file and removed after the build."
echo "This builds an image only. It will NOT launch a SIP server or modify your firewall."
IFS= read -r -s -p "SignalWire Personal Access Token: " sw_pat
printf '\n'
if [[ -z "$sw_pat" ]]; then
  echo "No token entered; exiting without building." >&2
  exit 1
fi
printf '%s' "$sw_pat" > "$secret_file"
unset sw_pat

DOCKER_BUILDKIT=1 docker build \
  --secret "id=signalwire_pat,src=${secret_file}" \
  --tag faxingpro-freeswitch:bookworm \
  --file "$dockerfile" \
  "${project_root}/deployment/freeswitch"

echo ""
echo "Image built. FreeSWITCH is NOT running."
echo "Check installed package:"
echo "  docker run --rm --network none faxingpro-freeswitch:bookworm dpkg-query -W freeswitch-mod-spandsp"
