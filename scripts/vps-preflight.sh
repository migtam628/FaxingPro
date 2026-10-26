#!/usr/bin/env bash
# FaxingPro VPS preflight: read-only. Does not install packages or open ports.
set -u
section() { printf "\n=== %s ===\n" "$1"; }
has() { command -v "$1" >/dev/null 2>&1; }
echo "FaxingPro / Telnyx VPS readiness check (READ ONLY)"
echo "Never share SIP passwords, API tokens, or .env file contents."
section "OS and architecture"
if [[ -r /etc/os-release ]]; then grep -E '^(PRETTY_NAME|VERSION_ID)=' /etc/os-release || true; fi
uname -m
section "Resources"
if has nproc; then printf "CPU cores: "; nproc; fi
if has free; then free -h; fi
if has df; then df -h /; fi
section "Network identity"
if has curl; then
  printf "Public IPv4: "
  curl -4fsS --connect-timeout 3 --max-time 7 https://api.ipify.org || printf "unavailable"
  printf "\n"
fi
if has hostname; then printf "Local addresses: "; hostname -I 2>/dev/null || true; fi
if has getent; then
  printf "sip.telnyx.com IPv4 answers:\n"
  getent ahostsv4 sip.telnyx.com 2>/dev/null | awk '{print $1}' | sort -u || true
fi
section "Local listeners for SIP and management"
if has ss; then
  ss -H -lntup 2>/dev/null | awk '$5 ~ /:(5060|5061|5080|8021|8080|5432|6379)$/ {print}' || true
else echo "ss unavailable"; fi
section "FreeSWITCH"
if has systemctl; then printf "Service: "; systemctl is-active freeswitch 2>/dev/null || true; fi
if has fs_cli; then
  fs_cli -x 'status' 2>/dev/null | head -n 8 || true
  fs_cli -x 'show modules' 2>/dev/null | grep -i mod_spandsp || printf "mod_spandsp not listed\n"
  fs_cli -x 'sofia status' 2>/dev/null | head -n 18 || true
else echo "fs_cli not installed or not in PATH"; fi
section "Docker"
if has docker; then docker --version; docker compose version 2>/dev/null || true; else echo "Docker unavailable"; fi
section "Firewall"
if has ufw; then
  if has sudo; then sudo -n ufw status 2>/dev/null || ufw status 2>/dev/null || echo "Firewall status requires privileges"
  else ufw status 2>/dev/null || echo "Firewall status requires privileges"; fi
else echo "Check cloud firewall and nftables/iptables independently"; fi
section "End"
echo "Do not apply firewall rules, install FreeSWITCH or enable outbound fax solely from this diagnostic."
