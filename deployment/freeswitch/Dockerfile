# syntax=docker/dockerfile:1.7
# Staging-only FreeSWITCH image, Debian 12 Bookworm.
# Requires a SignalWire PAT passed as a BuildKit secret; never a build argument.
# Build with: bash scripts/build-freeswitch-image.sh
FROM debian:bookworm

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       ca-certificates curl gnupg2 \
    && rm -rf /var/lib/apt/lists/*

# A single RUN ensures the temporary apt authentication file is not included
# in an intermediate image layer. A BuildKit secret is not embedded in metadata.
RUN --mount=type=secret,id=signalwire_pat,required=true \
    set -eu; \
    test -s /run/secrets/signalwire_pat; \
    sw_token="$(cat /run/secrets/signalwire_pat)"; \
    curl --fail --silent --show-error --location \
       --user "signalwire:${sw_token}" \
       --output /usr/share/keyrings/signalwire-freeswitch-repo.gpg \
       https://freeswitch.signalwire.com/repo/deb/debian-release/signalwire-freeswitch-repo.gpg; \
    printf 'machine freeswitch.signalwire.com login signalwire password %s\n' "${sw_token}" > /etc/apt/auth.conf; \
    chmod 600 /etc/apt/auth.conf; \
    trap 'rm -f /etc/apt/auth.conf' EXIT; \
    printf '%s\n' \
       'deb [signed-by=/usr/share/keyrings/signalwire-freeswitch-repo.gpg] https://freeswitch.signalwire.com/repo/deb/debian-release/ bookworm main' \
       > /etc/apt/sources.list.d/freeswitch.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
       freeswitch-meta-vanilla freeswitch-mod-spandsp; \
    dpkg-query -W freeswitch-mod-spandsp; \
    apt-get clean; \
    rm -rf /var/lib/apt/lists/*

# Deliberately does NOT start FreeSWITCH or expose SIP sockets.
# Default PBX configurations are unsafe to connect publicly until hardened.
CMD ["/bin/bash"]
