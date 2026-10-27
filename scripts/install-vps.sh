#!/usr/bin/env bash
# FaxingPro ATLAS Ubuntu installer. No deletion or overwrite of data volumes/secrets.
set -Eeuo pipefail
umask 077
REPO=https://github.com/migtam628/FaxingPro.git
DIR=/opt/faxingpro
DOMAIN=''
PROXY=auto
PORT=8092
MODE=install
YES=false
fail(){ echo "ERROR: $*" >&2; exit 1; }
help_text(){
cat <<'USAGE'
FaxingPro ATLAS guided Ubuntu VPS installer
  sudo bash install-vps.sh
  sudo bash install-vps.sh --domain fax.example.com --proxy existing
  sudo bash install-vps.sh --update --dir /opt/faxingpro
Options: --domain HOST --proxy auto|existing|none --port PORT --dir ABS_PATH
         --yes --check --status --update --self-test --help
Noninteractive: --yes --domain ... and FAXINGPRO_TELNYX_PUBLIC_KEY must be set.
Optional variables: FAXINGPRO_TELNYX_API_KEY, FAXINGPRO_TELNYX_APP_ID,
FAXINGPRO_TELNYX_FROM_NUMBER. Outbound sending is ALWAYS disabled on install.
USAGE
}
ok_domain(){ [[ $1 == *.* && $1 != *..* && $1 != *.-* && $1 != *-.* && $1 =~ ^[A-Za-z0-9][A-Za-z0-9.-]*[A-Za-z0-9]$ ]] && (( $(printf %s "$1" | wc -c) <= 253 )); }
ok_port(){ [[ $1 =~ ^[1-9][0-9]{3,4}$ ]] && ((10#$1 >= 1024 && 10#$1 <= 65535)); }
ok_key(){ [[ $1 =~ ^[0-9a-fA-F]{64}$ || $1 =~ ^[A-Za-z0-9+/]{43}=$ ]]; }
ok_value(){ [[ -z $1 || $1 =~ ^[A-Za-z0-9._~+/=-]+$ ]]; }
ok_path(){ [[ $1 == /* && $1 != / && $1 != *..* && $1 =~ ^/[A-Za-z0-9._/-]+$ ]]; }
selftest(){
 ok_domain fax.example.com || fail domain
 ! ok_domain example..com || fail domain-guard
 ok_port 8092 || fail port
 ! ok_port 80 || fail port-guard
 ok_key 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef || fail key
 ! ok_key fake || fail key-guard
 ! ok_value 'bad$(id)' || fail env-guard
 ok_path /opt/faxingpro || fail path
 ! ok_path /tmp/../etc || fail path-guard
 echo 'PASS installer input checks'
}
while (( $# > 0 )); do
 case "$1" in
  --help|-h) help_text;exit 0;; --self-test) selftest;exit 0;;
  --check) MODE=check;shift;; --status) MODE=status;shift;;
  --update) MODE=update;shift;; --yes) YES=true;shift;;
  --domain|--proxy|--port|--dir)
   (( $# >= 2 )) || fail "Missing value for $1"
   case "$1" in
    --domain) DOMAIN="$2";; --proxy) PROXY="$2";;
    --port) PORT="$2";; --dir) DIR="$2";;
   esac
   shift 2;;
  *) fail "Unknown flag: $1";;
 esac
done
ok_path "$DIR" || fail 'Use a safe absolute installation directory'
ok_port "$PORT" || fail 'Port must be non-privileged (1024-65535)'
[[ $PROXY == auto || $PROXY == existing || $PROXY == none ]] || fail 'Unknown proxy mode'
[[ -z $DOMAIN ]] || ok_domain "$DOMAIN" || fail 'Invalid DNS hostname'
ENVFILE="$DIR/deployment/telnyx/.env"
PROFILE="$DIR/deployment/telnyx/.install-profile"
ready(){ command -v docker >/dev/null && docker compose version >/dev/null 2>&1 && docker info >/dev/null 2>&1; }
port_busy(){
 command -v ss >/dev/null || fail 'iproute2 is required for port checks'
 ss -Hlnt | awk '{print $4}' | grep -Eq '(^|[:.])(80|443)$'
}
dc(){
 if [[ -f $PROFILE ]] && grep -qx 'PROXY_MODE=auto' "$PROFILE"; then
  docker compose -f "$DIR/deployment/telnyx/compose.yaml" --env-file "$ENVFILE" -f "$DIR/deployment/telnyx/compose.caddy.yaml" "$@"
 else
  docker compose -f "$DIR/deployment/telnyx/compose.yaml" --env-file "$ENVFILE" "$@"
 fi
}
health(){
 [[ -f $ENVFILE ]] || fail "Missing installation: $DIR"
 ready || fail 'Docker/Compose not available'
 dc ps
 local portnow
 portnow="$(sed -n 's/^FAXINGPRO_HTTP_PORT=//p' "$ENVFILE" | head -1)"
 ok_port "$portnow" || fail 'Bad installed HTTP port'
 curl -fsS --max-time 12 "http://127.0.0.1:$portnow/healthz"
 echo
}
if [[ $MODE == status ]];then health;exit 0;fi
if [[ $MODE == check ]];then
 selftest
 ready && echo 'Docker available' || echo 'Docker setup required'
 if command -v ss >/dev/null;then port_busy && echo 'Ports 80/443 occupied' || echo 'Ports 80/443 free';fi
 exit 0
fi
(( EUID == 0 )) || fail 'Run as root: sudo bash install-vps.sh'
[[ -r /etc/os-release ]] || fail 'Unknown OS'
. /etc/os-release
[[ $ID == ubuntu ]] || fail 'Automated installation is supported on Ubuntu only'
if [[ $MODE == update ]];then
 [[ -f $ENVFILE && -d $DIR/.git ]] || fail "Existing checkout not found at $DIR"
 ready || fail 'Docker/Compose missing'
 git -C "$DIR" pull --ff-only
 dc config --quiet
 dc up -d --no-deps --build api web
 dc restart web
 health
 echo 'Update complete; .env, PostgreSQL, PDF volumes, TLS and backups preserved.'
 exit 0
fi
for prog in git curl openssl;do
 if ! command -v "$prog" >/dev/null;then
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y git curl openssl ca-certificates
  break
 fi
done
if [[ -z $DOMAIN ]];then
 $YES && fail '--yes requires --domain'
 read -r -p 'Fax hostname (fax.example.com): ' DOMAIN </dev/tty
fi
ok_domain "$DOMAIN" || fail 'Invalid hostname'
if ! $YES;then
 echo 'Proxy: auto (new dedicated VPS), existing (preserve Caddy/Nginx), none (loopback-only).'
 read -r -p "Proxy mode [$PROXY]: " choice </dev/tty
 if [[ -n $choice ]];then PROXY="$choice";fi
fi
[[ $PROXY == auto || $PROXY == existing || $PROXY == none ]] || fail 'Invalid proxy mode'
if [[ $PROXY == auto ]];then
 command -v ss >/dev/null || DEBIAN_FRONTEND=noninteractive apt-get install -y iproute2
 port_busy && fail '80/443 occupied; choose --proxy existing. No existing proxy will be changed.'
fi
[[ ! -e $DIR && ! -L $DIR ]] || fail "Target $DIR already exists. Use --update."
if command -v docker >/dev/null && docker info >/dev/null 2>&1;then
 for v in faxingpro-telnyx_fax_database faxingpro-telnyx_fax_documents;do
  if docker volume inspect "$v" >/dev/null 2>&1;then fail "Existing FaxingPro volume $v detected";fi
 done
 [[ -z "$(docker ps -aq --filter label=com.docker.compose.project=faxingpro-telnyx)" ]] || fail 'Existing FaxingPro containers found. Update instead.'
fi
key="$(printenv FAXINGPRO_TELNYX_PUBLIC_KEY || true)"
if [[ -z $key ]];then
 $YES && fail 'Set FAXINGPRO_TELNYX_PUBLIC_KEY with --yes'
 echo 'Get the real 32-byte webhook public key from Telnyx Mission Control.'
 read -r -p 'Telnyx webhook public key (Base64/hex): ' key </dev/tty
fi
ok_key "$key" || fail 'Invalid Telnyx webhook public key'
apikey="$(printenv FAXINGPRO_TELNYX_API_KEY || true)"
app_id="$(printenv FAXINGPRO_TELNYX_APP_ID || true)"
did="$(printenv FAXINGPRO_TELNYX_FROM_NUMBER || true)"
if ! $YES;then
 read -r -s -p 'Telnyx v2 API key (optional; hidden): ' choice </dev/tty;echo >/dev/tty
 if [[ -n $choice ]];then apikey="$choice";fi
 read -r -p 'Fax application ID (optional): ' choice </dev/tty
 if [[ -n $choice ]];then app_id="$choice";fi
 read -r -p 'Purchased fax DID (+1..., optional): ' choice </dev/tty
 if [[ -n $choice ]];then did="$choice";fi
fi
for v in "$apikey" "$app_id" "$did";do ok_value "$v" || fail 'Unsafe Telnyx field characters';done
[[ -z $did || $did =~ ^\+1[2-9][0-9]{9}$ ]] || fail 'Fax DID must be US E.164'
echo "Installing to $DIR for https://$DOMAIN ($PROXY, local 127.0.0.1:$PORT)"
echo 'Generate four independent secrets; leave SEND_ENABLED=false and TEST_DESTINATION empty.'
if ! $YES;then
 read -r -p 'Proceed? [y/N] ' choice </dev/tty
 [[ $choice == y || $choice == yes ]] || fail 'Cancelled'
fi
if ! ready;then
 if command -v docker >/dev/null;then fail 'Existing Docker is broken or missing Compose; repair manually to avoid disrupting containers.';fi
 echo 'Installing Docker from its official Ubuntu apt repository'
 apt-get update -qq
 DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl git openssl
 install -m 0755 -d /etc/apt/keyrings
 curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
 chmod a+r /etc/apt/keyrings/docker.asc
 cat >/etc/apt/sources.list.d/docker.sources <<APT
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $VERSION_CODENAME
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
APT
 apt-get update -qq
 DEBIAN_FRONTEND=noninteractive apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
 systemctl enable --now docker
fi
ready || fail 'Docker Engine/Compose not ready'
for v in faxingpro-telnyx_fax_database faxingpro-telnyx_fax_documents;do
 if docker volume inspect "$v" >/dev/null 2>&1;then fail "Existing volume $v detected";fi
done
git clone --depth 1 --branch main "$REPO" "$DIR"
tmp="$(mktemp "$DIR/deployment/telnyx/.env.XXXXXXXX")"
trap 'rm -f "$tmp"' EXIT
{
 printf 'FAXINGPRO_HTTP_PORT=%s\n' "$PORT"
 printf 'DB_PASSWORD=%s\n' "$(openssl rand -hex 32)"
 printf 'API_TOKEN=%s\n' "$(openssl rand -hex 32)"
 printf 'MEDIA_SIGNING_SECRET=%s\n' "$(openssl rand -hex 32)"
 printf 'STORAGE_ENCRYPTION_KEY=%s\n' "$(openssl rand -hex 32)"
 printf 'TELNYX_API_KEY=%s\n' "$apikey"
 printf 'TELNYX_FAX_APP_ID=%s\n' "$app_id"
 printf 'TELNYX_FROM_NUMBER=%s\n' "$did"
 printf 'TELNYX_PUBLIC_KEY=%s\n' "$key"
 printf 'TELNYX_PUBLIC_BASE_URL=https://%s\n' "$DOMAIN"
 printf 'FAXINGPRO_DOMAIN=%s\n' "$DOMAIN"
 printf 'SEND_ENABLED=false\nTEST_DESTINATION=\n'
} > "$tmp"
chmod 0600 "$tmp"
[[ ! -f $ENVFILE ]] || fail 'Refusing to overwrite existing secrets'
mv "$tmp" "$ENVFILE"
trap - EXIT
printf 'PROXY_MODE=%s\n' "$PROXY" > "$PROFILE";chmod 0600 "$PROFILE"
dc config --quiet
dc up -d --build
healthy=false
for (( i=0;i<36;i++ ));do
 if curl -fsS --max-time 3 "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1;then healthy=true;break;fi
 sleep 5
done
if ! $healthy;then dc logs --tail=30 api >&2 || true;fail 'API not healthy. Secrets and data remain intact. Repair then --update.';fi
health
echo "Installation complete. Directory: $DIR"
echo "Read your login token only on the server: sudo grep '^API_TOKEN=' '$ENVFILE'"
if [[ $PROXY == auto ]];then
 echo "Public site: https://$DOMAIN (DNS A must point here; ports 80/443 must be open)"
else
 echo "Configure your existing HTTPS proxy to route $DOMAIN to host loopback 127.0.0.1:$PORT"
 echo 'Docker-based proxies require a shared network or explicitly configured host gateway.'
fi
echo "Telnyx webhook AFTER HTTPS works: https://$DOMAIN/webhooks/telnyx"
echo 'Outbound remains DISABLED. Configure backups/Google Drive independently.'
echo "Update later: sudo bash $DIR/scripts/install-vps.sh --update --dir $DIR"
